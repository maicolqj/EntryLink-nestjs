import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { Amenity }         from '../entities/amenity.entity';
import { AmenityBlackout } from '../entities/amenity-blackout.entity';
import { AmenityScheduleException } from '../entities/amenity-schedule-exception.entity';
import { AmenitiesService } from '../services/amenities.service';

import { CreateAmenityInput }          from '../dto/inputs/create-amenity.input';
import { UpdateAmenityInput }          from '../dto/inputs/update-amenity.input';
import { FilterAmenitiesInput }        from '../dto/inputs/filter-amenities.input';
import { SetAmenitySchedulesInput }    from '../dto/inputs/amenity-schedule.input';
import { CreateAmenityBlackoutInput }  from '../dto/inputs/create-amenity-blackout.input';
import { UpsertScheduleExceptionInput } from '../dto/inputs/upsert-schedule-exception.input';
import { AmenityAvailabilityInput }    from '../dto/inputs/amenity-availability.input';
import { PaginatedAmenitiesResponse }  from '../dto/responses/paginated-amenities.response';
import { AmenityAvailabilityResponse } from '../dto/responses/amenity-availability.response';
import { PaginationInput }             from '../../shared/dto/inputs/pagination.input';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

/** Roles que pueden consultar el catálogo de zonas y su disponibilidad. */
const READ_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL,
  ValidRoles.SUPERVISOR_ROL,  ValidRoles.SECURITY_ROL,
  ValidRoles.ACCOUNTANT_ROL,  ValidRoles.RESIDENT_ROL,
];

/** Roles que administran la configuración de las zonas. */
const ADMIN_ROLES = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL];

@Resolver(() => Amenity)
export class AmenitiesResolver {

  constructor(private readonly amenitiesService: AmenitiesService) {}

  // ================================================================
  // MUTATIONS — Configuración de zonas
  // ================================================================

  /** Crea una zona común. La configura el administrador del complejo. */
  @Mutation(() => Amenity, { name: 'createAmenity' })
  @Auth({ roles: ADMIN_ROLES, permissions: [ValidPermissions.MANAGE_AMENITIES] })
  create(
    @Args('input') input: CreateAmenityInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Amenity> {
    return this.amenitiesService.create(input, currentUser);
  }

  @Mutation(() => Amenity, { name: 'updateAmenity' })
  @Auth({ roles: ADMIN_ROLES, permissions: [ValidPermissions.MANAGE_AMENITIES] })
  update(
    @Args('input') input: UpdateAmenityInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Amenity> {
    return this.amenitiesService.update(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'deleteAmenity' })
  @Auth({ roles: ADMIN_ROLES, permissions: [ValidPermissions.MANAGE_AMENITIES] })
  remove(
    @Args('amenityId') amenityId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.amenitiesService.remove(amenityId, currentUser);
  }

  /** Reemplaza el horario semanal completo de la zona. */
  @Mutation(() => Amenity, { name: 'setAmenitySchedules' })
  @Auth({ roles: ADMIN_ROLES, permissions: [ValidPermissions.MANAGE_AMENITIES] })
  setSchedules(
    @Args('input') input: SetAmenitySchedulesInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Amenity> {
    return this.amenitiesService.setSchedules(input, currentUser);
  }

  /** Bloquea la zona en un rango y cancela las reservas que caigan dentro. */
  @Mutation(() => AmenityBlackout, { name: 'createAmenityBlackout' })
  @Auth({ roles: ADMIN_ROLES, permissions: [ValidPermissions.MANAGE_AMENITIES] })
  createBlackout(
    @Args('input') input: CreateAmenityBlackoutInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBlackout> {
    return this.amenitiesService.createBlackout(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'deleteAmenityBlackout' })
  @Auth({ roles: ADMIN_ROLES, permissions: [ValidPermissions.MANAGE_AMENITIES] })
  removeBlackout(
    @Args('blackoutId') blackoutId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.amenitiesService.removeBlackout(blackoutId, currentUser);
  }

  /**
   * Crea o reemplaza el horario de una fecha puntual. Es lo que usa el
   * calendario del admin para el festivo en que el salón se presta hasta la
   * madrugada del lunes, o para cerrar un día suelto.
   */
  @Mutation(() => AmenityScheduleException, { name: 'upsertAmenityScheduleException' })
  @Auth({ roles: ADMIN_ROLES, permissions: [ValidPermissions.MANAGE_AMENITIES] })
  upsertScheduleException(
    @Args('input') input: UpsertScheduleExceptionInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityScheduleException> {
    return this.amenitiesService.upsertScheduleException(input, currentUser);
  }

  /** Quita la excepción: esa fecha vuelve al horario semanal. */
  @Mutation(() => Boolean, { name: 'deleteAmenityScheduleException' })
  @Auth({ roles: ADMIN_ROLES, permissions: [ValidPermissions.MANAGE_AMENITIES] })
  deleteScheduleException(
    @Args('exceptionId') exceptionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.amenitiesService.deleteScheduleException(exceptionId, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /** Excepciones de la zona en un rango, para pintar el calendario del admin. */
  @Query(() => [AmenityScheduleException], { name: 'amenityScheduleExceptions' })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_AMENITIES] })
  scheduleExceptions(
    @Args('amenityId') amenityId: string,
    @Args('from') from: string,
    @Args('to')   to: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityScheduleException[]> {
    return this.amenitiesService.findScheduleExceptions(amenityId, from, to, currentUser);
  }


  /** Catálogo de zonas comunes del complejo. */
  @Query(() => PaginatedAmenitiesResponse, { name: 'amenities' })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_AMENITIES] })
  findByComplex(
    @Args('complexId')                      complexId: string,
    @Args('pagination', { nullable: true }) pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters',    { nullable: true }) filters: FilterAmenitiesInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedAmenitiesResponse> {
    return this.amenitiesService.findByComplex(complexId, pagination, filters, currentUser);
  }

  @Query(() => Amenity, { name: 'amenity' })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_AMENITIES] })
  findOne(
    @Args('amenityId') amenityId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<Amenity> {
    return this.amenitiesService.findById(amenityId, currentUser);
  }

  /**
   * Disponibilidad día a día: horario menos bloqueos menos reservas activas.
   * Es la consulta que alimenta el calendario de la app.
   */
  @Query(() => AmenityAvailabilityResponse, { name: 'amenityAvailability' })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_AMENITIES] })
  availability(
    @Args('input') input: AmenityAvailabilityInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityAvailabilityResponse> {
    return this.amenitiesService.getAvailability(input, currentUser);
  }

  @Query(() => [AmenityBlackout], { name: 'amenityBlackouts' })
  @Auth({ roles: READ_ROLES, permissions: [ValidPermissions.VIEW_AMENITIES] })
  blackouts(
    @Args('amenityId') amenityId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBlackout[]> {
    return this.amenitiesService.findBlackouts(amenityId, currentUser);
  }
}
