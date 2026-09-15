import { InputType, Field, Int, Float } from '@nestjs/graphql';
import {
  IsString,
  IsNotEmpty,
  IsOptional,
  IsEnum,
  IsUUID,
  IsBoolean,
  IsInt,
  IsNumber,
  Min,
  Max,
  MaxLength,
  IsArray,
  IsUrl,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

import { AmenityType } from '../../enums/amenity-type.enum';
import { AmenityStatus } from '../../enums/amenity-status.enum';
import { AmenityBookingMode } from '../../enums/amenity-booking-mode.enum';
import { AmenityFeeType } from '../../enums/amenity-fee-type.enum';
import { AmenityDurationUnit } from '../../enums/amenity-duration-unit.enum';
import { AmenityScheduleInput } from './amenity-schedule.input';

/**
 * Cota amplia: el rango real depende de la unidad de la zona (1–24 h para las
 * que se prestan por horas, 1–30 días para las de jornada) y se valida en el
 * servicio, donde sí se conoce `durationUnit`.
 */
export const MIN_DURATION_MINUTES = 60;
export const MAX_DURATION_MINUTES = 30 * 24 * 60;

@InputType()
export class CreateAmenityInput {
  @Field()
  @IsUUID()
  complexId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(150)
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Field(() => AmenityType, { defaultValue: AmenityType.OTRO })
  @IsEnum(AmenityType)
  type: AmenityType = AmenityType.OTRO;

  @Field(() => AmenityStatus, { defaultValue: AmenityStatus.ACTIVE })
  @IsEnum(AmenityStatus)
  status: AmenityStatus = AmenityStatus.ACTIVE;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  location?: string;

  @Field(() => String, {
    nullable: true,
    description: 'Reglamento de uso que ve el residente al reservar',
  })
  @IsOptional()
  @IsString()
  @MaxLength(5000)
  rules?: string;

  /** URLs ya subidas a R2 vía POST /api/v1/amenities/images */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(10)
  @IsUrl({}, { each: true })
  imageUrls?: string[];

  // ─── Reglas de reserva ────────────────────────────────────────────────────

  @Field(() => AmenityBookingMode, { defaultValue: AmenityBookingMode.SLOT })
  @IsEnum(AmenityBookingMode)
  bookingMode: AmenityBookingMode = AmenityBookingMode.SLOT;

  /**
   * HOURS: la zona se resuelve dentro del horario de un día.
   * DAYS:  la zona se alquila por jornadas completas y la reserva puede
   *        abarcar varios días calendario.
   */
  @Field(() => AmenityDurationUnit, { defaultValue: AmenityDurationUnit.HOURS })
  @IsEnum(AmenityDurationUnit)
  durationUnit: AmenityDurationUnit = AmenityDurationUnit.HOURS;

  /**
   * Las duraciones se guardan siempre en minutos —es la unidad con la que
   * trabaja el motor de disponibilidad—, pero el administrador las expresa en
   * la unidad de la zona. La coherencia con `durationUnit` la valida el servicio.
   */
  @Field(() => Int, {
    defaultValue: 120,
    description:
      'Solo SLOT: minutos de cada bloque. El rango válido depende de durationUnit',
  })
  @IsInt()
  @Min(MIN_DURATION_MINUTES)
  @Max(MAX_DURATION_MINUTES)
  slotDurationMinutes: number = 120;

  @Field(() => Int, {
    defaultValue: 60,
    description:
      'Solo RANGE: duración mínima en minutos. El rango válido depende de durationUnit',
  })
  @IsInt()
  @Min(MIN_DURATION_MINUTES)
  @Max(MAX_DURATION_MINUTES)
  minDurationMinutes: number = 60;

  @Field(() => Int, {
    defaultValue: 480,
    description:
      'Solo RANGE: duración máxima en minutos. El rango válido depende de durationUnit',
  })
  @IsInt()
  @Min(MIN_DURATION_MINUTES)
  @Max(MAX_DURATION_MINUTES)
  maxDurationMinutes: number = 480;

  @Field(() => Int, {
    defaultValue: 0,
    description: 'Aforo por reserva. 0 = sin control',
  })
  @IsInt()
  @Min(0)
  capacity: number = 0;

  @Field(() => Int, {
    defaultValue: 1,
    description: 'Reservas que caben a la misma hora (ej. 4 asadores)',
  })
  @IsInt()
  @Min(1)
  @Max(100)
  maxSimultaneousBookings: number = 1;

  @Field(() => Int, { defaultValue: 30 })
  @IsInt()
  @Min(1)
  @Max(365)
  advanceBookingDays: number = 30;

  @Field(() => Int, {
    defaultValue: 1,
    description: 'Anticipación mínima en días. 0 = se puede reservar para hoy',
  })
  @IsInt()
  @Min(0)
  @Max(365)
  minAdvanceDays: number = 1;

  @Field(() => Int, {
    defaultValue: 1,
    description:
      'Días antes del inicio en que aún se puede cancelar sin quedar con el cobro',
  })
  @IsInt()
  @Min(0)
  @Max(365)
  cancellationDeadlineDays: number = 1;

  @Field(() => Int, {
    defaultValue: 0,
    description: 'Horas que se suman al plazo de cancelación en días',
  })
  @IsInt()
  @Min(0)
  @Max(168)
  cancellationDeadlineHours: number = 0;

  @Field(() => Int, {
    defaultValue: 100,
    description: '% de la tarifa que se retiene al cancelar fuera de plazo',
  })
  @IsInt()
  @Min(0)
  @Max(100)
  lateCancellationFeePercent: number = 100;

  @Field(() => Int, {
    defaultValue: 0,
    description:
      'Reservas gratis al año por miembro del consejo. 0 = sin beneficio',
  })
  @IsInt()
  @Min(0)
  @Max(12)
  councilFreeBookingsPerYear: number = 0;

  @Field(() => Int, { defaultValue: 2, description: '0 = sin límite' })
  @IsInt()
  @Min(0)
  maxActiveBookingsPerUnit: number = 2;

  @Field(() => Int, { defaultValue: 0, description: '0 = sin límite' })
  @IsInt()
  @Min(0)
  maxBookingsPerUnitPerMonth: number = 0;

  @Field(() => Boolean, { defaultValue: true })
  @IsBoolean()
  requiresApproval: boolean = true;

  @Field(() => Boolean, { defaultValue: true })
  @IsBoolean()
  blockBookingsOnDebt: boolean = true;

  // ─── Cobro ────────────────────────────────────────────────────────────────

  @Field(() => AmenityFeeType, { defaultValue: AmenityFeeType.FREE })
  @IsEnum(AmenityFeeType)
  feeType: AmenityFeeType = AmenityFeeType.FREE;

  @Field(() => Float, { defaultValue: 0 })
  @IsNumber()
  @Min(0)
  feeAmount: number = 0;

  // ─── Programación inicial ─────────────────────────────────────────────────

  /**
   * Horario semanal con el que nace la zona. Opcional: sin horario la zona
   * existe pero no admite reservas, y el motor de disponibilidad la reporta
   * cerrada todos los días.
   */
  @Field(() => [AmenityScheduleInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => AmenityScheduleInput)
  schedules?: AmenityScheduleInput[];
}
