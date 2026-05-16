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

@Injectable()
export class UniversalRolePermissionGuard implements CanActivate {
  private readonly logger = new Logger(UniversalRolePermissionGuard.name);

  constructor(private readonly reflector: Reflector) {}

  async canActivate(context: ExecutionContext): Promise<boolean> {
    const ctx = GqlExecutionContext.create(context);
    const gqlCtx = ctx.getContext();

    // 🔹 Detectar el tipo de conexión (HTTP o WebSocket)
    const request = gqlCtx.req;
    const connection = gqlCtx.connection;

    // 🔹 Obtener el usuario desde el contexto correcto
    const user =
      request?.user ||
      connection?.context?.user ||
      gqlCtx.user ||
      null;

    if (!user) {
      this.logger.error('User not found in request or connection context');
      throw new ForbiddenException('No autenticado');
    }

    // 🔹 Super Admin bypass (sin cambios)
    if (
      Array.isArray(user.roles) &&
      user.roles.includes(ValidRoles.SUPER_ADMIN_ROL)
    ) {
      this.logger.debug(`SUPER_USER access granted for user: ${user.email}`);
      return true;
    }

    // 🔹 Leer metadata
    const requiredRoles = this.reflector.getAllAndOverride<ValidRoles[]>(
      'roles',
      [context.getHandler(), context.getClass()],
    );

    const requiredPermissions =
      this.reflector.getAllAndOverride<ValidPermissions[]>(
        'permissions',
        [context.getHandler(), context.getClass()],
      );

    // 🔹 NUEVO: Leer la estrategia de validación
    const strategy = this.reflector.getAllAndOverride<string>(
      AUTH_STRATEGY_KEY,
      [context.getHandler(), context.getClass()],
    ) ?? 'AND';

    // 🔹 Si no hay restricciones, acceso libre
    if (!requiredRoles?.length && !requiredPermissions?.length) {
      return true;
    }

    // 🔹 Evaluar cada condición por separado
    const hasValidRole = requiredRoles?.length
      ? requiredRoles.some((role) => user.roles?.includes(role))
      : null; // null = no se configuró, no se evalúa

    const hasValidPermission = requiredPermissions?.length
      ? requiredPermissions.every((perm) => user.permissions?.includes(perm))
      : null; // null = no se configuró, no se evalúa

    // 🔹 Aplicar estrategia
    let granted: boolean;

    if (strategy === 'OR') {
      // OR: basta con cumplir UNA de las dos condiciones
      granted = (hasValidRole === true) || (hasValidPermission === true);
    } else {
      // AND (comportamiento original): debe cumplir TODAS las configuradas
      const roleCheck = hasValidRole === null || hasValidRole === true;
      const permCheck = hasValidPermission === null || hasValidPermission === true;
      granted = roleCheck && permCheck;
    }

    // 🔹 Log en caso de denegación
    if (!granted) {
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