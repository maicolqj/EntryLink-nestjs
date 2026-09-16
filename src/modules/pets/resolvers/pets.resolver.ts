import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Pet } from '../entities/pet.entity';
import { PetsService } from '../services/pets.service';
import { UpdatePetInput } from '../dto/inputs/update-pet.input';
import { FilterPetsInput } from '../dto/inputs/filter-pets.input';
import { ApprovePetInput } from '../dto/inputs/approve-pet.input';
import { PaginatedPetsResponse } from '../dto/responses/paginated-pets.response';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
/**
 * El registro de la ficha NO está aquí: va por REST (POST /api/v1/pets) porque
 * la foto es obligatoria y GraphQL en este proyecto no recibe multipart.
 */
@RequireModule(ComplexModule.MASCOTAS)
@Resolver(() => Pet)
export class PetsResolver {
  constructor(private readonly petsService: PetsService) {}

  // ================================================================
  // MUTATIONS
  // ================================================================

  @Mutation(() => Pet, { name: 'updatePet' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.EDIT_PET],
  })
  updatePet(
    @Args('input') input: UpdatePetInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    return this.petsService.update(input, currentUser);
  }

  @Mutation(() => Pet, { name: 'approvePet' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.APPROVE_PET],
  })
  approvePet(
    @Args('input') input: ApprovePetInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    return this.petsService.approve(input, currentUser);
  }

  @Mutation(() => Pet, { name: 'rejectPet' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.APPROVE_PET],
  })
  rejectPet(
    @Args('petId') petId: string,
    @Args('reason') reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    return this.petsService.reject(petId, reason, currentUser);
  }

  @Mutation(() => Pet, { name: 'suspendPet' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.APPROVE_PET],
  })
  suspendPet(
    @Args('petId') petId: string,
    @Args('reason') reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    return this.petsService.suspend(petId, reason, currentUser);
  }

  @Mutation(() => Pet, { name: 'reactivatePet' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.APPROVE_PET],
  })
  reactivatePet(
    @Args('petId') petId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    return this.petsService.reactivate(petId, currentUser);
  }

  /** Saca a la mascota del censo (se mudó, la entregaron, falleció). */
  @Mutation(() => Boolean, { name: 'removePet' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.REMOVE_PET],
  })
  removePet(
    @Args('petId') petId: string,
    @Args('reason', { nullable: true }) reason: string | undefined,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.petsService.remove(petId, reason, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /** Censo del complejo. El residente solo ve las mascotas de su unidad. */
  @Query(() => PaginatedPetsResponse, { name: 'pets' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PETS],
  })
  findPets(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true })
    pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters', { nullable: true }) filters: FilterPetsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedPetsResponse> {
    return this.petsService.findByComplex(
      complexId,
      pagination,
      filters,
      currentUser,
    );
  }

  @Query(() => [Pet], { name: 'myPets' })
  @Auth({
    roles: [ValidRoles.RESIDENT_ROL, ValidRoles.COUNCIL_ROL],
    permissions: [ValidPermissions.VIEW_PETS],
  })
  findMyPets(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pet[]> {
    return this.petsService.findMyPets(complexId, currentUser);
  }

  /** Mascotas de una unidad: la portería identifica al animal que ve suelto. */
  @Query(() => [Pet], { name: 'petsByUnit' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PETS],
  })
  findPetsByUnit(
    @Args('unitId') unitId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pet[]> {
    return this.petsService.findByUnit(unitId, currentUser);
  }

  @Query(() => Pet, { name: 'pet' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PETS],
  })
  findOnePet(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Pet> {
    return this.petsService.findById(id, currentUser);
  }
}
