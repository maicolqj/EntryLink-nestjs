import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { SpecialNumber }              from './entities/special-number.entity';
import { SpecialNumbersService }      from './special-numbers.service';
import { CreateSpecialNumberInput }   from './dto/create-special-number.input';
import { UpdateSpecialNumberInput }   from './dto/update-special-number.input';

import { Auth }             from '../shared/decorators/auth.decorator';
import { CurrentUser }      from '../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../roles/enums/valid-roles';

@Resolver(() => SpecialNumber)
export class SpecialNumbersResolver {

  constructor(private readonly service: SpecialNumbersService) {}

  // ================================================================
  // QUERIES
  // ================================================================

  @Query(() => [SpecialNumber], { name: 'specialNumbers' })
  @Auth({ roles: [ValidRoles.SECURITY_ROL, ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  specialNumbers(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SpecialNumber[]> {
    return this.service.findByComplex(complexId, currentUser);
  }

  // ================================================================
  // MUTATIONS — SUPER_ADMIN: globales y de cualquier complejo
  //             COMPLEX_ROL: solo los suyos propios
  // ================================================================

  @Mutation(() => SpecialNumber, { name: 'createSpecialNumber' })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  createSpecialNumber(
    @Args('input') input: CreateSpecialNumberInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SpecialNumber> {
    return this.service.create(input, currentUser);
  }

  @Mutation(() => SpecialNumber, { name: 'updateSpecialNumber' })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  updateSpecialNumber(
    @Args('input') input: UpdateSpecialNumberInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SpecialNumber> {
    return this.service.update(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'removeSpecialNumber' })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  removeSpecialNumber(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.service.remove(id, currentUser);
  }

  @Mutation(() => [SpecialNumber], { name: 'reorderSpecialNumbers' })
  @Auth({ roles: [ValidRoles.COMPLEX_ROL, ValidRoles.SUPER_ADMIN_ROL] })
  reorderSpecialNumbers(
    @Args('complexId') complexId: string,
    @Args('ids', { type: () => [String] }) ids: string[],
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SpecialNumber[]> {
    return this.service.reorder(complexId, ids, currentUser);
  }

  @Mutation(() => [SpecialNumber], { name: 'reorderGlobalSpecialNumbers', description: 'Reordena los números especiales globales. Solo SUPER_ADMIN.' })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  reorderGlobalSpecialNumbers(
    @Args('ids', { type: () => [String] }) ids: string[],
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SpecialNumber[]> {
    return this.service.reorderGlobal(ids, currentUser);
  }
}
