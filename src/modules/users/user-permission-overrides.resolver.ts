import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { UserPermissionOverridesService } from './services/user-permission-overrides.service';
import { UserPermissionOverride } from './entities/user-permission-override.entity';
import { SetUserPermissionOverrideInput } from './dto/inputs/set-user-permission-override.input';
import { UserPermissionsSummary } from './dto/responses/user-permissions-summary.response';
import { Auth } from '../shared/decorators/auth.decorator';
import { CurrentUser } from '../shared/decorators/current-user.decorator';
import { ValidRoles } from '../roles/enums/valid-roles';
import { JwtAccessPayload } from '../auth/interfaces/jwt-payload.interface';

/** Excepciones de permisos por usuario. Solo las maneja el SUPER_ADMIN. */
@Resolver(() => UserPermissionOverride)
export class UserPermissionOverridesResolver {
  constructor(private readonly service: UserPermissionOverridesService) {}

  @Query(() => UserPermissionsSummary, {
    name: 'userPermissions',
    description:
      'Permisos de un usuario: los de sus roles, sus excepciones y con cuáles sale su sesión',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  userPermissions(
    @Args('userId', { type: () => String }) userId: string,
  ): Promise<UserPermissionsSummary> {
    return this.service.summary(userId);
  }

  @Mutation(() => UserPermissionOverride, {
    name: 'setUserPermissionOverride',
    description:
      'Da (GRANT) o quita (DENY) un permiso a un usuario por encima de sus roles. Aplica en su próxima renovación de sesión, sin cerrarla',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  setUserPermissionOverride(
    @Args('input') input: SetUserPermissionOverrideInput,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<UserPermissionOverride> {
    return this.service.set(input, actor);
  }

  @Mutation(() => Boolean, {
    name: 'removeUserPermissionOverride',
    description:
      'Quita la excepción: el usuario vuelve a tener exactamente los permisos de sus roles',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  removeUserPermissionOverride(
    @Args('userId', { type: () => String }) userId: string,
    @Args('permissionId', { type: () => String }) permissionId: string,
    @CurrentUser() actor: JwtAccessPayload,
  ): Promise<boolean> {
    return this.service.remove(userId, permissionId, actor);
  }
}
