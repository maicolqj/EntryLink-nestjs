import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { PetIncident } from '../entities/pet-incident.entity';
import { PetIncidentsService } from '../services/pet-incidents.service';
import { FilterPetIncidentsInput } from '../dto/inputs/filter-pet-incidents.input';
import { ValidatePetIncidentInput } from '../dto/inputs/validate-pet-incident.input';
import { SanctionPetIncidentInput } from '../dto/inputs/sanction-pet-incident.input';
import { CreatePetIncidentStatementInput } from '../dto/inputs/create-pet-incident-statement.input';
import { PaginatedPetIncidentsResponse } from '../dto/responses/paginated-pet-incidents.response';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
/**
 * La radicación del reporte NO está aquí: va por REST
 * (POST /api/v1/pets/incidents) porque la evidencia fotográfica viaja en la
 * misma petición y el servidor le pone el sello de hora y el hash.
 */
@RequireModule(ComplexModule.MASCOTAS)
@Resolver(() => PetIncident)
export class PetIncidentsResolver {
  constructor(private readonly incidentsService: PetIncidentsService) {}

  // ================================================================
  // MUTATIONS — trámite de la administración
  // ================================================================

  /** Da curso al reporte: lo atribuye, avisa a la unidad y abre los descargos. */
  @Mutation(() => PetIncident, { name: 'validatePetIncident' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.MANAGE_PET_INCIDENTS],
  })
  validatePetIncident(
    @Args('input') input: ValidatePetIncidentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    return this.incidentsService.validate(input, currentUser);
  }

  @Mutation(() => PetIncident, { name: 'dismissPetIncident' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.MANAGE_PET_INCIDENTS],
  })
  dismissPetIncident(
    @Args('incidentId') incidentId: string,
    @Args('reason') reason: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    return this.incidentsService.dismiss(incidentId, reason, currentUser);
  }

  /** Cierra el caso con llamado de atención o con multa a la unidad. */
  @Mutation(() => PetIncident, { name: 'sanctionPetIncident' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.MANAGE_PET_INCIDENTS],
  })
  sanctionPetIncident(
    @Args('input') input: SanctionPetIncidentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    return this.incidentsService.sanction(input, currentUser);
  }

  // ================================================================
  // MUTATIONS — defensa de la unidad
  // ================================================================

  @Mutation(() => PetIncident, { name: 'addPetIncidentStatement' })
  @Auth({
    roles: [ValidRoles.RESIDENT_ROL, ValidRoles.COUNCIL_ROL],
    permissions: [ValidPermissions.VIEW_PET_INCIDENTS],
  })
  addPetIncidentStatement(
    @Args('input') input: CreatePetIncidentStatementInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    return this.incidentsService.addStatement(input, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  @Query(() => PaginatedPetIncidentsResponse, { name: 'petIncidents' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PET_INCIDENTS],
  })
  findPetIncidents(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true })
    pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters', { nullable: true }) filters: FilterPetIncidentsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedPetIncidentsResponse> {
    return this.incidentsService.findByComplex(
      complexId,
      pagination,
      filters,
      currentUser,
    );
  }

  @Query(() => PetIncident, { name: 'petIncident' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PET_INCIDENTS],
  })
  findOnePetIncident(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PetIncident> {
    return this.incidentsService.findById(id, currentUser);
  }

  /** Historial de una mascota: es lo que sostiene la escalada por reincidencia. */
  @Query(() => [PetIncident], { name: 'petIncidentsByPet' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
      ValidRoles.COUNCIL_ROL,
    ],
    permissions: [ValidPermissions.VIEW_PET_INCIDENTS],
  })
  findPetIncidentsByPet(
    @Args('petId') petId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PetIncident[]> {
    return this.incidentsService.findByPet(petId, currentUser);
  }
}
