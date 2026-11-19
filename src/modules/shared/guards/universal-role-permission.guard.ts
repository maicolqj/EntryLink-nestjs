import {
  CanActivate,
  ExecutionContext,
  ForbiddenException,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { AUTH_STRATEGY_KEY } from '../decorators/auth.decorator';
import { PermissionStatusService } from '../../permissions/services/permission-status.service';

/**
 * Roles y permisos de cada operación (GraphQL, REST y WebSocket).
 *
 * Los permisos del token no bastan: un permiso **inactivo** no autoriza
 * aunque venga en un token emitido antes de desactivarlo (estado vigente en
 * PermissionStatusService, 30 s de caché), tampoco para SUPER_ADMIN, que
 * conserva su paso solo con permisos activos. Un rol inactivo no cuenta.
 * Este guard no salta ninguna otra verificación (sesión, cuenta activa y
 * versión del token se validan antes, en la estrategia JWT, y los demás
 * guards siguen aplicando). Política completa: docs/SUPER-ADMIN-POLITICA.md.
 */
@Injectable()
export class UniversalRolePermissionGuard implements CanActivate {
  private readonly logger = new Logger(UniversalRolePermissionGuard.name);

  constructor(
    private readonly reflector: Reflector,
    private readonly permissionStatus: PermissionStatusService,
  ) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = GqlExecutionContext.create(context);
    const gqlCtx = ctx.getContext();

    // 🔹 Detectar el tipo de conexión (HTTP o WebSocket)
    const request = gqlCtx.req;
    const connection = gqlCtx.connection;

    // 🔹 Obtener el usuario desde el contexto correcto
    const user =
      request?.user || connection?.context?.user || gqlCtx.user || null;

    if (!user) {
      this.logger.error('User not found in request or connection context');
      throw new ForbiddenException('No autenticado');
    }

    // 🔹 Leer metadata
    const requiredRoles = this.reflector.getAllAndOverride<ValidRoles[]>(
      'roles',
      [context.getHandler(), context.getClass()],
    );

    const requiredPermissions = this.reflector.getAllAndOverride<
      ValidPermissions[]
    >('permissions', [context.getHandler(), context.getClass()]);

    // 🔹 Estado vigente: solo se consulta si la operación exige roles o
    // permisos (una sola lectura trae los dos; 30 s de caché por proceso).
    const restricted = !!(requiredPermissions?.length || requiredRoles?.length);
    const inactive = restricted
      ? await this.permissionStatus.inactive()
      : new Set<string>();
    const inactiveRoles = restricted
      ? await this.permissionStatus.inactiveRoleNames()
      : new Set<string>();
    const inactiveRequired = (requiredPermissions ?? []).filter((p) =>
      inactive.has(p),
    );
    // Un rol inactivo no cuenta aunque venga en un token emitido antes.
    const activeRoles: string[] = (
      Array.isArray(user.roles) ? (user.roles as string[]) : []
    ).filter((r) => !inactiveRoles.has(r));

    // 🔹 SUPER_ADMIN: pasa sin tener los roles ni los permisos exigidos,
    // pero solo si todos esos permisos están activos. Un permiso inactivo
    // está apagado para todos: si lo necesita, primero se activa (queda
    // registrado al activarlo). Ya no hay paso «con traza».
    if (
      activeRoles.includes(ValidRoles.SUPER_ADMIN_ROL) &&
      !inactiveRequired.length
    ) {
      this.logger.debug(`SUPER_USER access granted for user: ${user.email}`);
      return true;
    }

    // 🔹 NUEVO: Leer la estrategia de validación
    const strategy =
      this.reflector.getAllAndOverride<string>(AUTH_STRATEGY_KEY, [
        context.getHandler(),
        context.getClass(),
      ]) ?? 'AND';

    // 🔹 Si no hay restricciones, acceso libre
    if (!requiredRoles?.length && !requiredPermissions?.length) {
      return true;
    }

    // 🔹 Evaluar cada condición por separado
    const hasValidRole = requiredRoles?.length
      ? requiredRoles.some((role) => activeRoles.includes(role))
      : null; // null = no se configuró, no se evalúa

    // Un permiso inactivo no cuenta aunque el token lo traiga.
    const hasValidPermission = requiredPermissions?.length
      ? requiredPermissions.every(
          (perm) => user.permissions?.includes(perm) && !inactive.has(perm),
        )
      : null; // null = no se configuró, no se evalúa

    // 🔹 Aplicar estrategia
    let granted: boolean;

    if (strategy === 'OR') {
      // OR: basta con cumplir UNA de las dos condiciones
      granted = hasValidRole === true || hasValidPermission === true;
    } else {
      // AND (comportamiento original): debe cumplir TODAS las configuradas
      const roleCheck = hasValidRole === null || hasValidRole === true;
      const permCheck =
        hasValidPermission === null || hasValidPermission === true;
      granted = roleCheck && permCheck;
    }

    // 🔹 Log en caso de denegación
    if (!granted) {
      if (inactiveRequired.length) {
        this.logger.warn(
          `Permisos inactivos requeridos por ${context.getHandler().name}: [${inactiveRequired.join(', ')}]`,
        );
      }
      this.logger.warn(
        `Access denied (${strategy}): User ${user.email} | ` +
          `Roles required: [${requiredRoles?.join(', ') ?? 'none'}], has: [${user.roles?.join(', ')}] → ${hasValidRole} | ` +
          `Permissions required: [${requiredPermissions?.join(', ') ?? 'none'}], has: [${user.permissions?.join(', ')}] → ${hasValidPermission}`,
      );
    } else {
      this.logger.debug(
        `Access granted (${strategy}): User ${user.email} | ` +
          `Role match: ${hasValidRole}, Permission match: ${hasValidPermission}`,
      );
    }

    return granted;
  }
}
