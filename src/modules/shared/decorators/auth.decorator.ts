import { applyDecorators, SetMetadata, UseGuards } from '@nestjs/common';
import { RoleProtected } from './rol-protected.decorator';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { RequirePermissions } from './require-permissions.decorator';
import {
  ComplexModuleGuard,
  JwtAuthGuard,
  UniversalRolePermissionGuard,
} from '../guards';

// Nueva clave de metadata para la estrategia
export const AUTH_STRATEGY_KEY = 'auth_strategy';

export function Auth(options?: {
  roles?: ValidRoles[];
  permissions?: string[];
}) {
  // El orden importa y es el motivo de que ComplexModuleGuard esté aquí:
  // `@RequireModule` lo pone sobre la CLASE, y Nest corre los guards de clase
  // ANTES que los del método, así que cuando llegaba a preguntar por el módulo
  // todavía no había usuario en la petición —lo pone JwtAuthGuard, que es de
  // método— y el guard se retiraba sin opinar. Resultado: el interruptor de
  // módulos no bloqueaba nada en las operaciones protegidas con `@Auth`.
  //
  // Va de último a propósito: a quien no puede ejecutar la operación por rol o
  // permiso se le responde eso, sin contarle de paso qué módulos tiene
  // contratado el conjunto.
  const decorators = [
    UseGuards(JwtAuthGuard, UniversalRolePermissionGuard, ComplexModuleGuard),
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
