import {
  HttpStatus,
  Injectable,
  Logger,
  OnModuleDestroy,
  OnModuleInit,
} from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { AUTH_CONSTANTS } from '../../auth/constants/auth.constants';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { PermissionErrorCode } from '../../shared/constans/error-codes.constants';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  inactivePermissions,
  inactiveRoles,
  permissionStatusCheckedAt,
  permissionStatusRefreshRequested,
  permissionStatusTrusted,
  permissionStatusVerifiedAt,
  PERMISSION_STATUS_MAX_STALE_MS,
  recordFailedCheck,
  requestPermissionStatusRefresh,
  setInactivePermissions,
} from '../../shared/permission-status/permission-status.registry';

/** Edad máxima del estado antes de volver a leerlo (por proceso). */
export const PERMISSION_STATUS_TTL_MS = 30_000;
/** Tras un fallo, cuánto esperar antes de reintentar (no en cada petición). */
export const PERMISSION_STATUS_RETRY_MS = 5_000;
/** Una lectura que tarda más que esto cuenta como fallo (base sin responder). */
export const PERMISSION_STATUS_QUERY_TIMEOUT_MS = 5_000;
export { PERMISSION_STATUS_MAX_STALE_MS };

/**
 * Estado vigente (activo o inactivo) de los permisos.
 *
 * - El guard lo consulta en cada operación con permisos: uno inactivo no
 *   autoriza aunque venga en un token emitido antes de desactivarlo.
 * - Se lee de `public.permissions`; vale 30 s por proceso. Un cambio hecho
 *   con PermissionsService pide releer al momento (en ese proceso); uno
 *   hecho por SQL, o en otra réplica, se ve como mucho a los 30 s. Un
 *   temporizador lo relee cada 30 s aunque no haya peticiones (trabajos en
 *   cola y crons también usan `actorHas`).
 * - **Antigüedad máxima.** Si la base falla o no responde en 5 s, se sigue
 *   con el último estado verificado solo mientras tenga menos de 120 s;
 *   pasado eso (o si nunca se pudo leer), toda operación con permisos se
 *   niega con 503 `PERMISSION_STATUS_UNAVAILABLE`, también para SUPER_ADMIN.
 *   No hay ventana indefinida con datos viejos. Mientras falla, se reintenta
 *   cada 5 s, no en cada petición.
 */
@Injectable()
export class PermissionStatusService implements OnModuleInit, OnModuleDestroy {
  private readonly logger = new Logger(PermissionStatusService.name);
  private loading: Promise<void> | null = null;
  private timer: NodeJS.Timeout | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cache: CacheService,
  ) {}

  onModuleInit(): void {
    // Primera lectura al arrancar: el estado existe antes de la primera petición.
    void this.refresh(Date.now()).catch(() => undefined);
    this.timer = setInterval(() => {
      void this.refresh(Date.now()).catch(() => undefined);
    }, PERMISSION_STATUS_TTL_MS);
    this.timer.unref?.();
  }

  onModuleDestroy(): void {
    if (this.timer) clearInterval(this.timer);
  }

  /**
   * Nombres de los permisos inactivos, verificados hace menos de 120 s.
   * Lanza PERMISSION_STATUS_UNAVAILABLE si no hay un estado confiable.
   */
  async inactive(now = Date.now()): Promise<ReadonlySet<string>> {
    const verifiedAt = permissionStatusVerifiedAt();
    const fresh =
      verifiedAt > 0 &&
      now - verifiedAt < PERMISSION_STATUS_TTL_MS &&
      !permissionStatusRefreshRequested();
    if (!fresh) {
      const recentlyFailed =
        permissionStatusCheckedAt() > verifiedAt &&
        now - permissionStatusCheckedAt() < PERMISSION_STATUS_RETRY_MS;
      if (!recentlyFailed) await this.refresh(now);
    }
    if (!permissionStatusTrusted(now)) {
      throw new CustomError({
        message:
          'No se pudo verificar el estado de los permisos. Intenta de nuevo en unos minutos.',
        statusCode: HttpStatus.SERVICE_UNAVAILABLE,
        errorCode: PermissionErrorCode.PERMISSION_STATUS_UNAVAILABLE,
      });
    }
    return inactivePermissions();
  }

  /**
   * Nombres de los roles inactivos, con la misma frescura y el mismo fallo
   * cerrado que `inactive()` (una sola lectura trae los dos).
   */
  async inactiveRoleNames(now = Date.now()): Promise<ReadonlySet<string>> {
    await this.inactive(now);
    return inactiveRoles();
  }

  /** Pide releer: la próxima consulta va a la base (sin perder lo conocido). */
  invalidate(): void {
    requestPermissionStatusRefresh();
  }

  /**
   * Tras activar o desactivar un permiso, dentro de la misma transacción:
   * sube `tokenVersion` a quien lo tiene (por rol o por excepción, y a las
   * cuentas de complejo si lo tiene COMPLEX_ROL). Sus tokens vigentes dejan
   * de servir y el cliente renueva sin cerrar sesión; el token nuevo ya trae
   * los permisos recalculados (mismo mecanismo que las excepciones de
   * permiso por usuario). Devuelve a quién afectó, para `afterCommit`.
   */
  async bumpHolders(
    permissionId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<string[]> {
    const users = rows(
      await manager.query(
        `UPDATE public.users u SET "tokenVersion" = u."tokenVersion" + 1
          WHERE u.id IN (
            SELECT uhr.user_id FROM public.user_has_roles uhr
              JOIN public.role_permissions rp ON rp.role_id = uhr.role_id
             WHERE rp.permission_id = $1
            UNION
            SELECT upo.user_id FROM public.user_permission_overrides upo
             WHERE upo.permission_id = $1)
          RETURNING u.id`,
        [permissionId],
      ),
    );
    const complexes = rows(
      await manager.query(
        `UPDATE public.residential_complexes c SET "tokenVersion" = c."tokenVersion" + 1
          WHERE EXISTS (
            SELECT 1 FROM public.role_permissions rp
              JOIN public.roles r ON r.id = rp.role_id
             WHERE rp.permission_id = $1 AND r.name::text = $2)
          RETURNING c.id`,
        [permissionId, ValidRoles.COMPLEX_ROL],
      ),
    );
    return [...users, ...complexes].map((r) => r.id);
  }

  /**
   * Tras activar o desactivar un rol, dentro de la misma transacción: sube
   * `tokenVersion` a quien lo tiene asignado (y a las cuentas de complejo si
   * es COMPLEX_ROL). El token siguiente sale sin el rol, o con él.
   */
  async bumpRoleHolders(
    roleId: string,
    manager: EntityManager = this.dataSource.manager,
  ): Promise<string[]> {
    const users = rows(
      await manager.query(
        `UPDATE public.users u SET "tokenVersion" = u."tokenVersion" + 1
          WHERE u.id IN (SELECT uhr.user_id FROM public.user_has_roles uhr
                          WHERE uhr.role_id = $1)
          RETURNING u.id`,
        [roleId],
      ),
    );
    const complexes = rows(
      await manager.query(
        `UPDATE public.residential_complexes c SET "tokenVersion" = c."tokenVersion" + 1
          WHERE EXISTS (SELECT 1 FROM public.roles r
                         WHERE r.id = $1 AND r.name::text = $2)
          RETURNING c.id`,
        [roleId, ValidRoles.COMPLEX_ROL],
      ),
    );
    return [...users, ...complexes].map((r) => r.id);
  }

  /**
   * Después del commit: borra la versión en caché (vive 5 min) para que los
   * tokens viejos mueran ya, y vence el estado de los permisos. Antes del
   * commit, otra petición podría volver a guardar la versión vieja.
   */
  async afterCommit(holderIds: string[]): Promise<void> {
    for (const id of holderIds) {
      await this.cache.delete({
        key: { prefix: AUTH_CONSTANTS.CACHE_PREFIX.TOKEN_VERSION, key: id },
      });
    }
    this.invalidate();
  }

  /** Una sola lectura a la vez; nunca lanza (el resultado va al registro). */
  private refresh(now: number): Promise<void> {
    this.loading ??= this.read(now).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  private async read(now: number): Promise<void> {
    let timeout: NodeJS.Timeout | undefined;
    try {
      const result = await Promise.race([
        this.dataSource.query<{ name: string; kind?: string }[]>(
          `SELECT name::text AS name, 'permission' AS kind
             FROM public.permissions WHERE status = false
           UNION ALL
           SELECT name::text AS name, 'role' AS kind
             FROM public.roles WHERE status = false`,
        ),
        new Promise<never>((_, reject) => {
          timeout = setTimeout(
            () => reject(new Error('la base no respondió a tiempo')),
            PERMISSION_STATUS_QUERY_TIMEOUT_MS,
          );
        }),
      ]);
      setInactivePermissions(
        result.filter((r) => r.kind !== 'role').map((r) => r.name),
        now,
        result.filter((r) => r.kind === 'role').map((r) => r.name),
      );
    } catch (error) {
      recordFailedCheck(now);
      const age = permissionStatusVerifiedAt()
        ? `${Math.round((now - permissionStatusVerifiedAt()) / 1000)} s`
        : 'nunca verificado';
      this.logger.error(
        `No se pudo leer el estado de los permisos (último estado verificado: ${age}; ` +
          `pasados ${PERMISSION_STATUS_MAX_STALE_MS / 1000} s se niega todo): ${String(error)}`,
      );
    } finally {
      if (timeout) clearTimeout(timeout);
    }
  }
}

/** `UPDATE ... RETURNING` con `query()` de TypeORM devuelve [filas, conteo]. */
function rows(result: unknown): Array<{ id: string }> {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Array<{ id: string }>;
  }
  return (result as Array<{ id: string }>) ?? [];
}
