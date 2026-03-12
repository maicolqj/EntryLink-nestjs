import { Resolver, Query, Mutation, Args, Int } from '@nestjs/graphql';
import { UseGuards, Logger } from '@nestjs/common';

import { UsersService } from './users.service';
import { User } from './entities/user.entity';
import { UpdateUserInput } from './dto/update-user.input';
import { ChangePasswordResponse } from './dto/responses/change-password.response';
import { ChangePasswordInput } from './dto/inputs/change-password.input';
import { UserInfoCompleteResponse } from './dto/responses/user-info-complete.response';
import { CreateAdminUserInput } from './dto/inputs/create-admin-user.input';
import { CreateResidentUserInput } from './dto/inputs/create-resident-user.input';
import { CreateSecurityGuardInput } from './dto/inputs/create-security-guard.input';

import { Auth } from '../shared/decorators/auth.decorator';
import { CurrentUser, CurrentUserId } from '../shared/decorators/current-user.decorator';
import { ValidRoles } from '../roles/enums/valid-roles';
import { JwtAccessPayload } from '../auth/interfaces/jwt-payload.interface';

@Resolver(() => User)
export class UsersResolver {
  private readonly logger = new Logger(UsersResolver.name);

  constructor(private readonly usersService: UsersService) {}

  // ── Consultas ──────────────────────────────────────────────────────────

  @Query(() => [User], { name: 'users' })
  findAll() {
    return this.usersService.findAll();
  }

  @Query(() => UserInfoCompleteResponse, { name: 'user', nullable: true })
  findOne(@Args('id', { type: () => String }) id: string): Promise<UserInfoCompleteResponse> {
    return this.usersService.findOne(id);
  }

  @Query(() => UserInfoCompleteResponse, {
    name: 'me',
    description: 'Perfil completo del usuario autenticado',
  })
  @Auth()
  async me(@CurrentUserId() userId: string): Promise<UserInfoCompleteResponse> {
    return this.usersService.getMyProfile(userId);
  }

  // ── Mutaciones de creación ─────────────────────────────────────────────

  @Mutation(() => User, {
    name: 'createAdminUser',
    description:
      'Crea un usuario administrativo (COMPLIANCE_OFFICER, COMPLEX, ACCOUNTANT, SUPERVISOR). ' +
      'Requiere rol SUPER_ADMIN_ROL.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  async createAdminUser(
    @Args('input') input: CreateAdminUserInput,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<User> {
    return this.usersService.createAdminUser(input, payload.sub);
  }

  @Mutation(() => User, {
    name: 'registerResident',
    description:
      'Registra un nuevo residente en el complejo. ' +
      'Requiere rol COMPLEX_ROL. El residente recibirá su código de acceso.',
  })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  async registerResident(
    @Args('input') input: CreateResidentUserInput,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<User> {
    return this.usersService.createResidentUser(input, payload.sub);
  }

  @Mutation(() => User, {
    name: 'createSecurityGuard',
    description:
      'Crea una cuenta de guardia de seguridad asignado al complejo. ' +
      'Requiere rol COMPLEX_ROL.',
  })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  async createSecurityGuard(
    @Args('input') input: CreateSecurityGuardInput,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<User> {
    return this.usersService.createSecurityGuard(input, payload.sub);
  }

  // ── Cambio de contraseña ─────────────────────────────────────────────────

  @Mutation(() => ChangePasswordResponse, {
    name: 'changePassword',
    description: 'Cambiar la contraseña del usuario autenticado',
  })
  @Auth()
  async changePassword(
    @CurrentUserId() userId: string,
    @Args('input') input: ChangePasswordInput,
  ): Promise<ChangePasswordResponse> {
    return this.usersService.changePassword(userId, input);
  }

  // ── Otras mutaciones ──────────────────────────────────────────────────────

  @Mutation(() => User)
  updateUser(@Args('updateUserInput') updateUserInput: UpdateUserInput) {
    return this.usersService.update(updateUserInput.id, updateUserInput);
  }

  @Mutation(() => User)
  removeUser(@Args('id', { type: () => Int }) id: number) {
    return this.usersService.remove(id);
  }
}
