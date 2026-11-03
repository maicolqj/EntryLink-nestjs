import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { AUTH_CONSTANTS } from '../../auth/constants/auth.constants';
import { ValidRoles } from '../../roles/enums/valid-roles';
import {
  inactivePermissions,
  inactivePermissionsLoaded,
  inactivePermissionsLoadedAt,
  markInactivePermissionsStale,
  setInactivePermissions,
  touchInactivePermissions,
} from '../../shared/permission-status/permission-status.registry';

/** Cada cuánto se vuelve a leer el estado de los permisos (por proceso). */
export const PERMISSION_STATUS_TTL_MS = 30_000;

/**
 * Estado vigente (activo o inactivo) de los permisos.
 *
 * - El guard lo consulta en cada operación: un permiso inactivo no autoriza
 *   aunque venga en un token emitido antes de desactivarlo.
 * - Se lee de `public.permissions` y se guarda 30 s por proceso; un cambio
 *   hecho con PermissionsService invalida la caché al momento, y uno hecho
 *   por SQL se ve, como mucho, a los 30 s.
 * - Si la base falla al refrescar, se sigue con el último estado conocido;
 *   si nunca se pudo leer, falla cerrado (la operación no se autoriza).
 */
@Injectable()
export class PermissionStatusService {
  private readonly logger = new Logger(PermissionStatusService.name);
  private loading: Promise<ReadonlySet<string>> | null = null;

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly cache: CacheService,
  ) {}

  /** Nombres de los permisos inactivos, al día dentro del TTL. */
  async inactive(now = Date.now()): Promise<ReadonlySet<string>> {
    const loadedAt = inactivePermissionsLoadedAt();
    if (loadedAt && now - loadedAt < PERMISSION_STATUS_TTL_MS) {
      return inactivePermissions();
    }
    // Una sola lectura a la vez aunque lleguen muchas peticiones juntas.
    this.loading ??= this.load(now).finally(() => {
      this.loading = null;
    });
    return this.loading;
  }

  /** Olvida lo cargado: la próxima consulta lee la base. */
  invalidate(): void {
    markInactivePermissionsStale();
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

  private async load(now: number): Promise<ReadonlySet<string>> {
    try {
      const result: Array<{ name: string }> = await this.dataSource.query(
        `SELECT name::text AS name FROM public.permissions WHERE status = false`,
      );
      setInactivePermissions(
        result.map((r) => r.name),
        now,
      );
    } catch (error) {
      if (!inactivePermissionsLoaded()) {
        // Sin ningún dato no se puede saber qué está inactivo: falla cerrado.
        throw error;
      }
      // Se reintenta al vencer el TTL, no en cada petición.
      touchInactivePermissions(now);
      this.logger.error(
        `No se pudo leer el estado de los permisos; sigue el último conocido: ${String(error)}`,
      );
    }
    return inactivePermissions();
  }
}

/** `UPDATE ... RETURNING` con `query()` de TypeORM devuelve [filas, conteo]. */
function rows(result: unknown): Array<{ id: string }> {
  if (Array.isArray(result) && Array.isArray(result[0])) {
    return result[0] as Array<{ id: string }>;
  }
  return (result as Array<{ id: string }>) ?? [];
}
