import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

import { AmenityBookingStatus } from '../enums/amenity-booking-status.enum';
import { Amenity } from './amenity.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { moneyColumn } from '../../finance/utils/numeric.transformer';

/**
 * Reserva de una zona común por parte de una unidad.
 *
 * El intervalo [startAt, endAt) es semiabierto: una reserva de 10:00–12:00 y
 * otra de 12:00–14:00 no se solapan. Toda la aritmética de disponibilidad
 * depende de esa convención.
 *
 * `feeChargeId` apunta al cargo de la tarifa. Al cancelar dentro del plazo ese
 * cargo se exonera; fuera del plazo se conserva, que es el efecto que la
 * política de cancelación busca.
 *
 * `damageChargeId` es independiente: no hay depósito, así que la unidad solo
 * paga si al recibir la zona se evidencia un daño.
 */
@ObjectType({ description: 'Reserva de zona común hecha por una unidad' })
@Entity({ name: 'amenity_bookings' })
@Index(['complexId', 'status'])
@Index(['complexId', 'startAt'])
@Index(['unitId', 'status'])
// La consulta caliente del motor de disponibilidad: reservas de una zona que
// se cruzan con una ventana. Sin este índice es un scan por zona. La ocupación
// se mide contra `blockedUntilAt` —el fin del aseo—, no contra `endAt`.
@Index(['amenityId', 'startAt', 'blockedUntilAt'])
@Index(['accessCode'])
export class AmenityBooking {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Qué se reservó ───────────────────────────────────────────────────────

  @Field()
  @Column({ name: 'amenity_id', type: 'uuid' })
  amenityId: string;

  @Field(() => Amenity, { nullable: true })
  @ManyToOne(() => Amenity, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'amenity_id' })
  amenity?: Amenity;

  @Field()
  @Column({ name: 'start_at', type: 'timestamptz' })
  startAt: Date;

  @Field()
  @Column({ name: 'end_at', type: 'timestamptz' })
  endAt: Date;

  /** Número de asistentes declarado. Se valida contra `amenity.capacity`. */
  @Field(() => Int)
  @Column({ type: 'int', default: 1 })
  attendees: number;

  /** Motivo o evento declarado por el residente (ej. cumpleaños). */
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  purpose?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  notes?: string | null;

  // ─── Quién reservó ────────────────────────────────────────────────────────

  @Field()
  @Column({ name: 'unit_id', type: 'uuid' })
  unitId: string;

  @Field(() => Unit, { nullable: true })
  @ManyToOne(() => Unit, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'unit_id' })
  unit?: Unit;

  /** Ficha de residente que originó la reserva. Null si la creó la administración. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'resident_id', type: 'uuid', nullable: true })
  residentId?: string | null;

  /** Usuario autenticado que disparó la creación (residente o staff). */
  @Field(() => String, { nullable: true })
  @Column({ name: 'requested_by_user_id', type: 'uuid', nullable: true })
  requestedByUserId?: string | null;

  /** Nombre congelado de quien reservó, para el listado de portería. */
  @Field(() => String, { nullable: true })
  @Column({
    name: 'requested_by_name',
    type: 'varchar',
    length: 180,
    nullable: true,
  })
  requestedByName?: string | null;

  // ─── Estado ───────────────────────────────────────────────────────────────

  @Field(() => AmenityBookingStatus)
  @Column({
    type: 'varchar',
    length: 20,
    default: AmenityBookingStatus.PENDING,
  })
  status: AmenityBookingStatus;

  @Field(() => String, { nullable: true })
  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'rejection_reason',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  rejectionReason?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true })
  cancelledByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'cancellation_reason',
    type: 'varchar',
    length: 300,
    nullable: true,
  })
  cancellationReason?: string | null;

  // ─── Control de acceso en portería ────────────────────────────────────────

  /**
   * Código corto que el residente muestra al guarda. Se emite solo cuando la
   * reserva queda APPROVED: un código de una reserva pendiente daría acceso a
   * algo que aún no está autorizado.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'access_code', type: 'varchar', length: 20, nullable: true })
  accessCode?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'check_in_at', type: 'timestamptz', nullable: true })
  checkInAt?: Date | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'check_out_at', type: 'timestamptz', nullable: true })
  checkOutAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'checked_in_by_user_id', type: 'uuid', nullable: true })
  checkedInByUserId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'checked_out_by_user_id', type: 'uuid', nullable: true })
  checkedOutByUserId?: string | null;

  // ─── Cobro ────────────────────────────────────────────────────────────────

  /** Tarifa calculada al momento de reservar (congelada: la zona puede cambiarla después). */
  @Field(() => Float)
  @Column({
    name: 'fee_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: moneyColumn,
  })
  feeAmount: number;

  /** Cargo de la TARIFA en finanzas. Null cuando la reserva es gratuita. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'fee_charge_id', type: 'uuid', nullable: true })
  feeChargeId?: string | null;

  /**
   * La reserva consumió el cupo anual del consejo de administración, así que
   * nació sin tarifa. Se guarda en la reserva y no se recalcula: el cupo se
   * cuenta sobre lo ya reservado, y apagar el beneficio en la zona no puede
   * reescribir lo que el residente ya usó.
   */
  @Field(() => Boolean, {
    description: 'Nació gratis por el cupo anual del consejo de administración',
  })
  @Column({ name: 'is_council_free_booking', type: 'boolean', default: false })
  isCouncilFreeBooking: boolean;

  /** Penalización efectivamente cobrada por cancelar fuera del plazo. 0 si no hubo. */
  @Field(() => Float)
  @Column({
    name: 'late_cancellation_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: moneyColumn,
  })
  lateCancellationAmount: number;

  /**
   * Cargo de la penalización. Es uno nuevo y no el de la tarifa: cuando la
   * retención es parcial hay que anular el cargo original y emitir el del valor
   * retenido, porque los asientos del ledger son inmutables.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'late_cancellation_charge_id', type: 'uuid', nullable: true })
  lateCancellationChargeId?: string | null;

  // ─── Pago recibido en la administración ───────────────────────────────────
  //
  // El alquiler puede cobrarse por la cartera de la unidad —lo que pasa por
  // defecto— o recibirse en efectivo en la administración. No son acumulables:
  // el resumen financiero suma `totalCollected + directIncome`, así que dejar
  // el cargo colgando de la unidad Y registrar el ingreso contaría el mismo
  // dinero dos veces. Registrar el pago anula el cargo y mueve la plata a caja.

  /** Ingreso directo a caja generado al recibir el pago. Null = va por cartera. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'direct_income_id', type: 'uuid', nullable: true })
  directIncomeId?: string | null;

  /** Lo que efectivamente se recibió en la administración. */
  @Field(() => Float)
  @Column({
    name: 'direct_payment_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: moneyColumn,
  })
  directPaymentAmount: number;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'direct_payment_at', type: 'timestamptz', nullable: true })
  directPaymentAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'direct_payment_by_user_id',
    type: 'uuid',
    nullable: true,
  })
  directPaymentByUserId?: string | null;

  /**
   * Plata que hay que devolverle a la unidad por cancelar una reserva pagada.
   *
   * Se anota al CANCELAR, pero el dinero no sale de la caja en ese momento:
   * sale cuando el residente se acerca a reclamarlo, que pueden ser días
   * después o nunca. Por eso este campo es una obligación pendiente y el
   * comprobante de egreso se emite aparte —si no, los libros dirían que la
   * plata ya salió mientras sigue en el cajón, y el arqueo no cuadraría—.
   *
   * No hay saldo a favor: se devuelve en efectivo. Si la cancelación llegó
   * fuera de plazo, lo retenido se descuenta antes.
   */
  @Field(() => Float)
  @Column({
    name: 'refund_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: moneyColumn,
  })
  refundAmount: number;

  /**
   * Comprobante de egreso, emitido al ENTREGAR la plata. Null mientras la
   * devolución siga pendiente, o si el complejo no tiene PUC configurado.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'refund_voucher_id', type: 'uuid', nullable: true })
  refundVoucherId?: string | null;

  /** Cuándo se entregó el dinero. Null = todavía está por reclamar. */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'refunded_at', type: 'timestamptz', nullable: true })
  refundedAt?: Date | null;

  // ─── Aseo de la zona ──────────────────────────────────────────────────────
  //
  // La zona no queda libre en el instante en que el residente sale: hay que
  // recogerla. Esa franja la decide la administración reserva por reserva
  // —dos horas de reunión no ensucian como una fiesta de veinticuatro— y
  // bloquea la agenda haga el aseo quien lo haga, porque la zona no está
  // disponible igual.

  /**
   * Minutos que la zona queda bloqueada DESPUÉS de `endAt` para el aseo.
   * No se le cobran al residente como tiempo de uso: la tarifa se calcula
   * sobre [startAt, endAt).
   */
  @Field(() => Int, { description: 'Franja de aseo tras la reserva, en minutos' })
  @Column({ name: 'cleaning_minutes', type: 'int', default: 0 })
  cleaningMinutes: number;

  /**
   * Hasta cuándo la zona está OCUPADA: `endAt` más la franja de aseo.
   *
   * Es el instante contra el que mide el motor de disponibilidad, mientras
   * `endAt` sigue siendo lo que el residente reservó. Se guarda ya calculado en
   * vez de sumarse en cada consulta para que los índices y los solapamientos en
   * SQL sigan siendo comparaciones directas.
   */
  @Field(() => Date, {
    description: 'Fin de la ocupación real: endAt más la franja de aseo',
  })
  @Column({ name: 'blocked_until_at', type: 'timestamptz' })
  blockedUntilAt: Date;

  /**
   * true = el aseo lo hace el conjunto y se cobra; false = lo hace la unidad.
   * Lo elige el residente al reservar y la administración puede corregirlo,
   * avisándole.
   */
  @Field(() => Boolean, {
    description: 'El aseo lo hace el conjunto (se cobra) en vez de la unidad',
  })
  @Column({ name: 'cleaning_by_complex', type: 'boolean', default: false })
  cleaningByComplex: boolean;

  /** Tarifa del aseo congelada al momento de elegirlo. 0 si asea la unidad. */
  @Field(() => Float)
  @Column({
    name: 'cleaning_fee_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: moneyColumn,
  })
  cleaningFeeAmount: number;

  /**
   * Cargo del aseo en finanzas. Va aparte del de la tarifa: así se puede
   * exonerar solo el aseo, y el estado de cuenta dice qué se cobró por qué.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'cleaning_charge_id', type: 'uuid', nullable: true })
  cleaningChargeId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'cleaning_updated_at', type: 'timestamptz', nullable: true })
  cleaningUpdatedAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({
    name: 'cleaning_updated_by_user_id',
    type: 'uuid',
    nullable: true,
  })
  cleaningUpdatedByUserId?: string | null;

  // ─── Cobro por daños ──────────────────────────────────────────────────────
  //
  // No hay depósito: la unidad no adelanta dinero. Si al recibir la zona se
  // evidencia un daño, el valor se carga a la CxC de la unidad y queda escrito
  // por qué. Sin daño, la reserva no genera ningún cobro extra.

  /** Valor cargado a la unidad por daños. 0 si no hubo. */
  @Field(() => Float)
  @Column({
    name: 'damage_amount',
    type: 'numeric',
    precision: 12,
    scale: 2,
    default: 0,
    transformer: moneyColumn,
  })
  damageAmount: number;

  /** Explicación del cobro. Es lo que el residente ve junto al cargo. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'damage_description', type: 'text', nullable: true })
  damageDescription?: string | null;

  /** Cargo generado en finanzas por el daño. */
  @Field(() => String, { nullable: true })
  @Column({ name: 'damage_charge_id', type: 'uuid', nullable: true })
  damageChargeId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'damage_charged_at', type: 'timestamptz', nullable: true })
  damageChargedAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'damage_charged_by_user_id', type: 'uuid', nullable: true })
  damageChargedByUserId?: string | null;

  // ─── Novedades de portería (calculadas, no son columnas) ─────────────────

  /**
   * Cuántas novedades registró portería sobre la reserva. Solo se llena en la
   * lista de la administración (`amenityBookings`): sin este número la reserva
   * con daño reportado se ve igual que las demás y el aviso lleva a una fila
   * que no dice nada. Nulo en cualquier otra consulta (no se calculó).
   */
  @Field(() => Int, { nullable: true })
  noveltyCount?: number;

  /** Alguna de esas novedades reporta daño: insumo para el cobro. */
  @Field(() => Boolean, { nullable: true })
  hasDamageNovelty?: boolean;

  // ─── Multi-tenant ─────────────────────────────────────────────────────────

  @Field()
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  // ─── Auditoría ────────────────────────────────────────────────────────────

  /** Marca que el recordatorio previo ya se envió, para que el cron no lo repita. */
  @Field(() => Date, { nullable: true })
  @Column({ name: 'reminder_sent_at', type: 'timestamptz', nullable: true })
  reminderSentAt?: Date | null;

  @Field()
  @CreateDateColumn({ name: 'created_at', type: 'timestamptz' })
  createdAt: Date;

  @Field()
  @UpdateDateColumn({ name: 'updated_at', type: 'timestamptz' })
  updatedAt: Date;

  @Field(() => Date, { nullable: true })
  @DeleteDateColumn({ name: 'deleted_at', type: 'timestamptz' })
  deletedAt?: Date | null;
}
