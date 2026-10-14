import { registerEnumType } from '@nestjs/graphql';

/** Qué hace una excepción de permiso sobre lo que el usuario recibe de sus roles. */
export enum PermissionOverrideEffect {
  /** Le da el permiso aunque ninguno de sus roles lo tenga. */
  GRANT = 'GRANT',
  /** Le quita el permiso aunque alguno de sus roles lo tenga. */
  DENY = 'DENY',
}

registerEnumType(PermissionOverrideEffect, {
  name: 'PermissionOverrideEffect',
  description: 'GRANT da un permiso extra; DENY quita uno de los de sus roles',
});
