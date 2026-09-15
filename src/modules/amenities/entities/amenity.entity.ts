import {
  Entity,
  PrimaryGeneratedColumn,
  Column,
  CreateDateColumn,
  UpdateDateColumn,
  DeleteDateColumn,
  ManyToOne,
  OneToMany,
  JoinColumn,
  Index,
} from 'typeorm';
import { ObjectType, Field, ID, Int, Float } from '@nestjs/graphql';

import { AmenityType } from '../enums/amenity-type.enum';
import { AmenityStatus } from '../enums/amenity-status.enum';
import { AmenityBookingMode } from '../enums/amenity-booking-mode.enum';
import { AmenityFeeType } from '../enums/amenity-fee-type.enum';
import { AmenityDurationUnit } from '../enums/amenity-duration-unit.enum';
import { AmenitySchedule } from './amenity-schedule.entity';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { moneyColumn } from '../../finance/utils/numeric.transformer';

/**
 * Zona común reservable del complejo (salón comunal, zona BBQ, gimnasio…).
 *
 * La disponibilidad no vive aquí: la define `AmenitySchedule` (horario semanal
 * recurrente) menos `AmenityBlackout` (bloqueos puntuales) menos las reservas
 * activas. Esta entidad guarda solo las reglas del cupo — cuántas reservas
 * simultáneas admite, con cuánta anticipación, cuánto cuesta y qué límites
 * tiene cada unidad.
 */
@ObjectType({ description: 'Zona común reservable del complejo residencial' })
@Entity({ name: 'amenities' })
@Index(['complexId', 'status'])
@Index(['complexId', 'type'])
export class Amenity {
  @Field(() => ID)
  @PrimaryGeneratedColumn('uuid')
  id: string;

  // ─── Identificación ───────────────────────────────────────────────────────

  @Field(() => String, {
    description: 'Nombre visible (ej. Salón Comunal Piso 1)',
  })
  @Column({ type: 'varchar', length: 150 })
  name: string;

  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  description?: string | null;

  @Field(() => AmenityType)
  @Column({ type: 'varchar', length: 40, default: AmenityType.OTRO })
  type: AmenityType;

  @Field(() => AmenityStatus)
  @Column({ type: 'varchar', length: 20, default: AmenityStatus.ACTIVE })
  status: AmenityStatus;

  /** Ubicación en texto libre dentro del complejo (ej. Torre B, sótano 1) */
  @Field(() => String, { nullable: true })
  @Column({ type: 'varchar', length: 200, nullable: true })
  location?: string | null;

  /** Reglamento de uso que el residente acepta al reservar */
  @Field(() => String, { nullable: true })
  @Column({ type: 'text', nullable: true })
  rules?: string | null;

  @Field(() => [String], {
    description: 'URLs de fotos de la zona (R2)',
    nullable: true,
  })
  @Column({
    name: 'image_urls',
    type: 'text',
    array: true,
    nullable: true,
    default: [],
    transformer: {
      to: (value: string[] | null) => value ?? [],
      from: (value: any): string[] => {
        if (!value) return [];
        if (Array.isArray(value)) return value;
        if (typeof value === 'string') {
          const stripped = value.replace(/^\{|\}$/g, '');
          if (!stripped) return [];
          return stripped
            .split(',')
            .map((s) => s.replace(/^"|"$/g, '').trim())
            .filter(Boolean);
        }
        return [];
      },
    },
  })
  imageUrls: string[];

  // ─── Reglas de reserva ────────────────────────────────────────────────────

  @Field(() => AmenityBookingMode)
  @Column({
    name: 'booking_mode',
    type: 'varchar',
    length: 10,
    default: AmenityBookingMode.SLOT,
  })
  bookingMode: AmenityBookingMode;

  /**
   * Unidad en que el administrador expresa las duraciones. No es cosmética: una
   * zona en DAYS reserva días calendario completos y su reserva puede abarcar
   * varios días, mientras que una en HOURS se resuelve dentro del horario de un
   * mismo día. Los campos de abajo siguen guardándose en minutos.
   */
  @Field(() => AmenityDurationUnit)
  @Column({
    name: 'duration_unit',
    type: 'varchar',
    length: 10,
    default: AmenityDurationUnit.HOURS,
  })
  durationUnit: AmenityDurationUnit;

  /** Solo SLOT: duración de cada franja generada a partir del horario. */
  @Field(() => Int)
  @Column({ name: 'slot_duration_minutes', type: 'int', default: 120 })
  slotDurationMinutes: number;

  /** Solo RANGE: duración mínima que puede pedir el residente. */
  @Field(() => Int)
  @Column({ name: 'min_duration_minutes', type: 'int', default: 60 })
  minDurationMinutes: number;

  /** Solo RANGE: duración máxima que puede pedir el residente. */
  @Field(() => Int)
  @Column({ name: 'max_duration_minutes', type: 'int', default: 480 })
  maxDurationMinutes: number;

  /** Aforo máximo de personas por reserva. 0 = sin control de aforo. */
  @Field(() => Int)
  @Column({ type: 'int', default: 0 })
  capacity: number;

  /**
   * Cuántas reservas pueden coexistir en la misma franja. Modela zonas con
   * varios puestos idénticos (4 asadores) sin crear 4 zonas separadas.
   */
  @Field(() => Int)
  @Column({ name: 'max_simultaneous_bookings', type: 'int', default: 1 })
  maxSimultaneousBookings: number;

  /** Con cuántos días de anticipación máxima se puede reservar. */
  @Field(() => Int)
  @Column({ name: 'advance_booking_days', type: 'int', default: 30 })
  advanceBookingDays: number;

  /** Anticipación mínima en días. 0 = se puede reservar para hoy mismo. */
  @Field(() => Int)
  @Column({ name: 'min_advance_days', type: 'int', default: 1 })
  minAdvanceDays: number;

  /**
   * Días antes del inicio en que aún se puede cancelar sin quedar con el cobro
   * de la tarifa. Pasado el plazo la reserva se cancela igual, pero el cargo
   * no se exonera.
   */
  @Field(() => Int)
  @Column({ name: 'cancellation_deadline_days', type: 'int', default: 1 })
  cancellationDeadlineDays: number;

  /**
   * Horas que se SUMAN a `cancellationDeadlineDays` para formar el plazo real.
   * Los dos campos conviven porque el reglamento de cada copropiedad se escribe
   * de las dos formas —"48 horas antes" o "2 días antes"— y sumarlos evita que
   * se contradigan: 1 día y 6 horas son 30 horas de plazo.
   */
  @Field(() => Int, {
    description:
      'Se suman a cancellationDeadlineDays para formar el plazo real',
  })
  @Column({ name: 'cancellation_deadline_hours', type: 'int', default: 0 })
  cancellationDeadlineHours: number;

  /**
   * Cuánto de la tarifa se retiene cuando la cancelación llega fuera del plazo.
   * 100 mantiene el cobro completo —el comportamiento histórico—, 0 deja el
   * plazo como informativo, y un valor intermedio cobra esa parte y exonera el
   * resto. No toca el cobro por daños: ese responde a un hecho, no a la
   * cancelación.
   */
  @Field(() => Int, {
    description:
      'Porcentaje de la tarifa que se retiene al cancelar fuera de plazo',
  })
  @Column({ name: 'late_cancellation_fee_percent', type: 'int', default: 100 })
  lateCancellationFeePercent: number;

  /**
   * Reservas gratuitas al año que tiene cada miembro del consejo de
   * administración en esta zona. 0 = la zona no reconoce el beneficio, que es
   * el caso de la mayoría de complejos, y por eso nace apagado.
   */
  @Field(() => Int, {
    description:
      'Reservas gratis al año por miembro del consejo. 0 = sin beneficio',
  })
  @Column({ name: 'council_free_bookings_per_year', type: 'int', default: 0 })
  councilFreeBookingsPerYear: number;

  /** Reservas activas simultáneas que puede tener una misma unidad. 0 = sin límite. */
  @Field(() => Int)
  @Column({ name: 'max_active_bookings_per_unit', type: 'int', default: 2 })
  maxActiveBookingsPerUnit: number;

  /** Reservas por unidad dentro del mismo mes calendario. 0 = sin límite. */
  @Field(() => Int)
  @Column({ name: 'max_bookings_per_unit_per_month', type: 'int', default: 0 })
  maxBookingsPerUnitPerMonth: number;

  @Field(() => Boolean, {
    description:
      'Si es true la reserva nace en PENDING y la administración debe aprobarla',
  })
  @Column({ name: 'requires_approval', type: 'boolean', default: true })
  requiresApproval: boolean;

  /**
   * Bloquea la reserva cuando la unidad tiene cartera vencida. Es la palanca de
   * cobro más usada en PH colombianas, pero no todos los complejos la aplican.
   */
  @Field(() => Boolean, {
    description: 'Si es true, una unidad con saldo vencido no puede reservar',
  })
  @Column({ name: 'block_bookings_on_debt', type: 'boolean', default: true })
  blockBookingsOnDebt: boolean;

  // ─── Cobro ────────────────────────────────────────────────────────────────

  @Field(() => AmenityFeeType)
  @Column({
    name: 'fee_type',
    type: 'varchar',
    length: 20,
    default: AmenityFeeType.FREE,
  })
  feeType: AmenityFeeType;

  /** Tarifa base. Se interpreta según `feeType`. */
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

  // ─── Multi-tenant ─────────────────────────────────────────────────────────

  @Field()
  @Column({ name: 'complex_id', type: 'uuid' })
  complexId: string;

  @Field(() => ResidentialComplex, { nullable: true })
  @ManyToOne(() => ResidentialComplex, { eager: false, onDelete: 'CASCADE' })
  @JoinColumn({ name: 'complex_id' })
  complex?: ResidentialComplex;

  @Field(() => [AmenitySchedule], { nullable: true })
  @OneToMany(() => AmenitySchedule, (schedule) => schedule.amenity)
  schedules?: AmenitySchedule[];

  // ─── Auditoría ────────────────────────────────────────────────────────────

  @Field(() => String, { nullable: true })
  @Column({ name: 'created_by_user_id', type: 'uuid', nullable: true })
  createdByUserId?: string | null;

  @Field(() => String, { nullable: true })
  @Column({ name: 'updated_by_user_id', type: 'uuid', nullable: true })
  updatedByUserId?: string | null;

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
