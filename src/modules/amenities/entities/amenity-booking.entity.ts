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
import { Amenity }              from './amenity.entity';
import { Unit }                 from '../../residential-complex/entities/unit.entity';
import { ResidentialComplex }   from '../../residential-complex/entities/residential-complex.entity';
import { moneyColumn }          from '../../finance/utils/numeric.transformer';

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
// se cruzan con una ventana. Sin este índice es un scan por zona.
@Index(['amenityId', 'startAt', 'endAt'])
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
  @Column({ name: 'requested_by_name', type: 'varchar', length: 180, nullable: true })
  requestedByName?: string | null;

  // ─── Estado ───────────────────────────────────────────────────────────────

  @Field(() => AmenityBookingStatus)
  @Column({ type: 'varchar', length: 20, default: AmenityBookingStatus.PENDING })
  status: AmenityBookingStatus;

  @Field(() => String, { nullable: true })
  @Column({ name: 'approved_by_user_id', type: 'uuid', nullable: true })
  approvedByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'approved_at', type: 'timestamptz', nullable: true })
  approvedAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'rejection_reason', type: 'varchar', length: 300, nullable: true })
  rejectionReason?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'cancelled_by_user_id', type: 'uuid', nullable: true })
  cancelledByUserId?: string | null;

  @Field(() => Date, { nullable: true })
  @Column({ name: 'cancelled_at', type: 'timestamptz', nullable: true })
  cancelledAt?: Date | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'cancellation_reason', type: 'varchar', length: 300, nullable: true })
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

  // ─── Cobro ────────────────────────────────────────────────────────────────

  /** Tarifa calculada al momento de reservar (congelada: la zona puede cambiarla después). */
  @Field(() => Float)
  @Column({ name: 'fee_amount', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: moneyColumn })
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
  @Field(() => Boolean, { description: 'Nació gratis por el cupo anual del consejo de administración' })
  @Column({ name: 'is_council_free_booking', type: 'boolean', default: false })
  isCouncilFreeBooking: boolean;

  /** Penalización efectivamente cobrada por cancelar fuera del plazo. 0 si no hubo. */
  @Field(() => Float)
  @Column({ name: 'late_cancellation_amount', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: moneyColumn })
  lateCancellationAmount: number;

  /**
   * Cargo de la penalización. Es uno nuevo y no el de la tarifa: cuando la
   * retención es parcial hay que anular el cargo original y emitir el del valor
   * retenido, porque los asientos del ledger son inmutables.
   */
  @Field(() => String, { nullable: true })
  @Column({ name: 'late_cancellation_charge_id', type: 'uuid', nullable: true })
  lateCancellationChargeId?: string | null;

  // ─── Cobro por daños ──────────────────────────────────────────────────────
  //
  // No hay depósito: la unidad no adelanta dinero. Si al recibir la zona se
  // evidencia un daño, el valor se carga a la CxC de la unidad y queda escrito
  // por qué. Sin daño, la reserva no genera ningún cobro extra.

  /** Valor cargado a la unidad por daños. 0 si no hubo. */
  @Field(() => Float)
  @Column({ name: 'damage_amount', type: 'numeric', precision: 12, scale: 2, default: 0, transformer: moneyColumn })
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
