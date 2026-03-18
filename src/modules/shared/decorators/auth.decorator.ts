import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { RoleProtected } from './rol-protected.decorator';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { RequirePermissions } from './require-permissions.decorator';
import { JwtAuthGuard, UniversalRolePermissionGuard } from '../guards';

// Nueva clave de metadata para la estrategia
export const AUTH_STRATEGY_KEY = 'auth_strategy';

export function Auth(options?: { roles?: ValidRoles[]; permissions?: string[] }) {
  const decorators = [
    UseGuards(JwtAuthGuard, UniversalRolePermissionGuard),
  ];

  const hasRoles = !!options?.roles?.length;
  const hasPermissions = !!options?.permissions?.length;

  // Cuando hay AMBOS configurados → lógica OR
  if (hasRoles && hasPermissions) {
    decorators.push(SetMetadata(AUTH_STRATEGY_KEY, 'OR'));
  }

  if (hasRoles) {
    decorators.push(RoleProtected(...options.roles));
  }

  if (hasPermissions) {
    decorators.push(RequirePermissions(...options.permissions));
  }

  return applyDecorators(...decorators);
}