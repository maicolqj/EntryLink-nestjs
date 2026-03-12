import { applyDecorators, UseGuards } from '@nestjs/common';
import { AuthGuard } from '@nestjs/passport';


import { RoleProtected } from './rol-protected.decorator';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { RequirePermissions } from './require-permissions.decorator';
import { JwtAuthGuard, UniversalRolePermissionGuard } from '../guards';

export function Auth(options?: { roles?: ValidRoles[]; permissions?: string[] }) {
  const guards = [
    JwtAuthGuard, // Usamos el guard personalizado para GraphQL
    UniversalRolePermissionGuard,
  ];

  const decorators = [
    UseGuards(...guards),
  ];
  

  if (options?.roles?.length) {
    decorators.push(RoleProtected(...options.roles));
  }

  if (options?.permissions?.length) {
    decorators.push(RequirePermissions(...options.permissions));
  }

  return applyDecorators(...decorators);
}