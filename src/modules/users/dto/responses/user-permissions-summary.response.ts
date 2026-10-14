import { ObjectType, Field } from '@nestjs/graphql';

import { Permission } from '../../../permissions/entities/permission.entity';
import { UserPermissionOverride } from '../../entities/user-permission-override.entity';

@ObjectType({ description: 'Permiso que el usuario recibe de sus roles' })
export class RolePermissionSource {
  @Field(() => Permission)
  permission: Permission;

  @Field(() => [String], { description: 'Roles que le dan este permiso' })
  roles: string[];
}

@ObjectType({
  description:
    'Permisos de un usuario: los de sus roles, sus excepciones y el resultado',
})
export class UserPermissionsSummary {
  @Field(() => String)
  userId: string;

  @Field(() => [RolePermissionSource])
  rolePermissions: RolePermissionSource[];

  @Field(() => [UserPermissionOverride])
  overrides: UserPermissionOverride[];

  @Field(() => [String], {
    description:
      'Nombres de los permisos con que sale su sesión: roles + GRANT − DENY',
  })
  effectivePermissions: string[];

  @Field(() => Boolean, {
    description:
      'true si es SUPER_ADMIN: pasa todos los controles y las excepciones no lo afectan',
  })
  isSuperAdmin: boolean;
}
