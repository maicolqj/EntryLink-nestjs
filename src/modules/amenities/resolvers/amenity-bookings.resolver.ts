import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { AmenityBooking } from '../entities/amenity-booking.entity';
import { AmenityBookingsService } from '../services/amenity-bookings.service';

import { CreateAmenityBookingInput } from '../dto/inputs/create-amenity-booking.input';
import { CancelAmenityBookingInput } from '../dto/inputs/cancel-amenity-booking.input';
import { RejectAmenityBookingInput } from '../dto/inputs/reject-amenity-booking.input';
import { ChargeAmenityDamageInput } from '../dto/inputs/charge-amenity-damage.input';
import { UpdateAmenityBookingCleaningInput } from '../dto/inputs/update-amenity-booking-cleaning.input';
import { RegisterAmenityBookingPaymentInput } from '../dto/inputs/register-amenity-booking-payment.input';
import { RegisterAmenityBookingRefundInput } from '../dto/inputs/register-amenity-booking-refund.input';
import { FilterAmenityBookingsInput } from '../dto/inputs/filter-amenity-bookings.input';
import { PaginatedAmenityBookingsResponse } from '../dto/responses/paginated-amenity-bookings.response';
import { AmenityCouncilQuotaResponse } from '../dto/responses/council-quota.response';
import { AmenityAccessCodeValidation } from '../dto/responses/access-code-validation.response';
import { PaginationInput } from '../../shared/dto/inputs/pagination.input';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
/** Quien administra las reservas de todo el complejo. */
const STAFF_ROLES = [
  ValidRoles.SUPER_ADMIN_ROL,
  ValidRoles.COMPLEX_ROL,
  // ValidRoles.SUPERVISOR_ROL,
];

@RequireModule(ComplexModule.ZONAS_COMUNES)
@Resolver(() => AmenityBooking)
export class AmenityBookingsResolver {
  constructor(private readonly bookingsService: AmenityBookingsService) {}

  // ================================================================
  // MUTATIONS — Ciclo de vida de la reserva
  // ================================================================

  /**
   * Crea una reserva. El residente reserva para su unidad; el staff puede
   * hacerlo a nombre de otra pasando `unitId` en el input.
   */
  @Mutation(() => AmenityBooking, { name: 'createAmenityBooking' })
  @Auth({
    roles: [...STAFF_ROLES, ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.CREATE_AMENITY_BOOKING],
  })
  create(
    @Args('input') input: CreateAmenityBookingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.create(input, currentUser);
  }

  @Mutation(() => AmenityBooking, { name: 'approveAmenityBooking' })
  @Auth({
    roles: STAFF_ROLES,
    permissions: [ValidPermissions.APPROVE_AMENITY_BOOKING],
  })
  approve(
    @Args('bookingId') bookingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.approve(bookingId, currentUser);
  }

  @Mutation(() => AmenityBooking, { name: 'rejectAmenityBooking' })
  @Auth({
    roles: STAFF_ROLES,
    permissions: [ValidPermissions.APPROVE_AMENITY_BOOKING],
  })
  reject(
    @Args('input') input: RejectAmenityBookingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.reject(input, currentUser);
  }

  /** Cancela la reserva. El residente solo puede cancelar las de su unidad. */
  @Mutation(() => AmenityBooking, { name: 'cancelAmenityBooking' })
  @Auth({
    roles: [...STAFF_ROLES, ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.CREATE_AMENITY_BOOKING],
  })
  cancel(
    @Args('input') input: CancelAmenityBookingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.cancel(input, currentUser);
  }

  // ================================================================
  // MUTATIONS — Portería
  // ================================================================

  /**
   * Muestra a quién pertenece el código y si el ingreso procede, sin registrar
   * nada. Portería valida primero y confirma después.
   */
  @Query(() => AmenityAccessCodeValidation, {
    name: 'validateAmenityAccessCode',
  })
  @Auth({
    roles: [...STAFF_ROLES, ValidRoles.SECURITY_ROL],
    permissions: [ValidPermissions.CHECK_IN_AMENITY_BOOKING],
  })
  validateAccessCode(
    @Args('complexId') complexId: string,
    @Args('accessCode') accessCode: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityAccessCodeValidation> {
    return this.bookingsService.validateAccessCode(
      complexId,
      accessCode,
      currentUser,
    );
  }

  /** Valida el código que muestra el residente y registra el ingreso. */
  @Mutation(() => AmenityBooking, { name: 'checkInAmenityBooking' })
  @Auth({
    roles: [...STAFF_ROLES, ValidRoles.SECURITY_ROL],
    permissions: [ValidPermissions.CHECK_IN_AMENITY_BOOKING],
  })
  checkIn(
    @Args('complexId') complexId: string,
    @Args('accessCode') accessCode: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.checkIn(complexId, accessCode, currentUser);
  }

  @Mutation(() => AmenityBooking, { name: 'checkOutAmenityBooking' })
  @Auth({
    roles: [...STAFF_ROLES, ValidRoles.SECURITY_ROL],
    permissions: [ValidPermissions.CHECK_IN_AMENITY_BOOKING],
  })
  checkOut(
    @Args('bookingId') bookingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.checkOut(bookingId, currentUser);
  }

  // ================================================================
  // MUTATIONS — Pago del alquiler
  // ================================================================

  /**
   * Registra que el residente pago el alquiler en la administracion. El dinero
   * entra como ingreso del complejo y el cargo deja de colgar de la unidad.
   */
  @Mutation(() => AmenityBooking, { name: 'registerAmenityBookingPayment' })
  @Auth({
    roles: STAFF_ROLES,
    permissions: [ValidPermissions.APPROVE_AMENITY_BOOKING],
  })
  registerPayment(
    @Args('input') input: RegisterAmenityBookingPaymentInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.registerDirectPayment(input, currentUser);
  }

  /**
   * Entrega la devolucion pendiente de una reserva cancelada. Emite el
   * comprobante de egreso: es el momento en que la plata sale de la caja.
   */
  @Mutation(() => AmenityBooking, { name: 'registerAmenityBookingRefund' })
  @Auth({
    roles: STAFF_ROLES,
    permissions: [ValidPermissions.APPROVE_AMENITY_BOOKING],
  })
  registerRefund(
    @Args('input') input: RegisterAmenityBookingRefundInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.registerRefund(input, currentUser);
  }

  // ================================================================
  // MUTATIONS — Aseo de la zona
  // ================================================================

  /**
   * Ajusta la franja de aseo de una reserva y quien se encarga de hacerlo.
   * Solo la administracion: la franja bloquea la agenda de todo el complejo y
   * el servicio le cuesta plata a una unidad.
   */
  @Mutation(() => AmenityBooking, { name: 'updateAmenityBookingCleaning' })
  @Auth({
    roles: STAFF_ROLES,
    permissions: [ValidPermissions.APPROVE_AMENITY_BOOKING],
  })
  updateCleaning(
    @Args('input') input: UpdateAmenityBookingCleaningInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.updateCleaning(input, currentUser);
  }

  // ================================================================
  // MUTATIONS — Cobro por daños
  // ================================================================

  /**
   * Carga a la unidad el valor de un daño detectado al recibir la zona. Solo la
   * administración: portería cierra la reserva, pero cobrarle a una unidad es
   * una decisión que impacta su cartera.
   */
  @Mutation(() => AmenityBooking, { name: 'chargeAmenityDamage' })
  @Auth({
    roles: STAFF_ROLES,
    permissions: [ValidPermissions.APPROVE_AMENITY_BOOKING],
  })
  chargeDamage(
    @Args('input') input: ChargeAmenityDamageInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.chargeDamage(input, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  /** Agenda completa del complejo, con filtros por zona, unidad, estado y fecha. */
  @Query(() => PaginatedAmenityBookingsResponse, { name: 'amenityBookings' })
  @Auth({
    roles: [...STAFF_ROLES, ValidRoles.SECURITY_ROL, ValidRoles.ACCOUNTANT_ROL],
    permissions: [ValidPermissions.VIEW_AMENITY_BOOKINGS],
  })
  findByComplex(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true })
    pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters', { nullable: true })
    filters: FilterAmenityBookingsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedAmenityBookingsResponse> {
    return this.bookingsService.findByComplex(
      complexId,
      pagination,
      filters,
      currentUser,
    );
  }

  /** Reservas de la unidad del residente autenticado. */
  @Query(() => PaginatedAmenityBookingsResponse, {
    name: 'myUnitAmenityBookings',
  })
  @Auth({
    roles: [ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.VIEW_AMENITY_BOOKINGS],
  })
  findMyUnitBookings(
    @Args('complexId') complexId: string,
    @Args('pagination', { nullable: true })
    pagination: PaginationInput = { page: 1, limit: 20 },
    @Args('filters', { nullable: true })
    filters: FilterAmenityBookingsInput = {},
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<PaginatedAmenityBookingsResponse> {
    return this.bookingsService.findMyUnitBookings(
      complexId,
      pagination,
      filters,
      currentUser,
    );
  }

  /**
   * Cupo del consejo que le queda a quien pregunta en esta zona. La app lo
   * consulta para ofrecerle usarlo —o no— antes de reservar, en vez de
   * aplicarlo por detrás sin decírselo.
   */
  @Query(() => AmenityCouncilQuotaResponse, { name: 'myAmenityCouncilQuota' })
  @Auth({
    roles: [ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.CREATE_AMENITY_BOOKING],
  })
  myCouncilQuota(
    @Args('amenityId') amenityId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityCouncilQuotaResponse> {
    return this.bookingsService.councilQuotaFor(amenityId, currentUser);
  }

  @Query(() => AmenityBooking, { name: 'amenityBooking' })
  @Auth({
    roles: [...STAFF_ROLES, ValidRoles.SECURITY_ROL, ValidRoles.RESIDENT_ROL],
    permissions: [ValidPermissions.VIEW_AMENITY_BOOKINGS],
  })
  findOne(
    @Args('bookingId') bookingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<AmenityBooking> {
    return this.bookingsService.findById(bookingId, currentUser);
  }
}
