import {
  CanActivate,
  ExecutionContext,
  Injectable,
  Logger,
  UnauthorizedException,
} from '@nestjs/common';
import { Reflector } from '@nestjs/core';
import { GqlExecutionContext } from '@nestjs/graphql';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

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
      gqlCtx.user || // fallback adicional
      null;

    if (!user) {
      this.logger.error('User not found in request or connection context');
      throw new UnauthorizedException('User not authenticated');
    }

    // 🔹 Super Admin bypass
    if (
      Array.isArray(user.roles) &&
      user.roles.includes(ValidRoles.SUPER_ADMIN_ROL)
    ) { 
      this.logger.debug(`SUPER_USER access granted for user: ${user.email}`);
      return true;
    }

    // 🔹 Roles y permisos requeridos
    const requiredRoles = this.reflector.getAllAndOverride<ValidRoles[]>(
      'roles',
      [context.getHandler(), context.getClass()],
    );

    const requiredPermissions =
      this.reflector.getAllAndOverride<ValidPermissions[]>(
        'permissions',
        [context.getHandler(), context.getClass()],
      );

    // 🔹 Validar roles
    if (
      requiredRoles &&
      !requiredRoles.some((role) => user.roles?.includes(role))
    ) {
      this.logger.warn(
        `Access denied: User ${user.email} lacks required role(s). Required: ${requiredRoles.join(', ')}, Has: ${user.roles?.join(', ')}`,
      );
      return false;
    }

    // 🔹 Validar permisos
    if (
      requiredPermissions &&
      !requiredPermissions.every((perm) =>
        user.permissions?.includes(perm),
      )
    ) {
      this.logger.warn(
        `Access denied: User ${user.email} lacks required permission(s). Required: ${requiredPermissions.join(', ')}, Has: ${user.permissions?.join(', ')}`,
      );
      return false;
    }

    return true;
  }
}