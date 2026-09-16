import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsInt,
  IsUUID,
  Min,
  Max,
  Matches,
  IsArray,
  ValidateNested,
  ArrayMaxSize,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Formato HH:mm en 24 h (00:00 – 23:59). */
const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;

@InputType()
export class AmenityScheduleInput {
  @Field(() => Int, { description: '0=domingo, 1=lunes … 6=sábado' })
  @IsInt()
  @Min(0)
  @Max(6)
  dayOfWeek: number;

  @Field(() => String, { description: 'Hora de apertura HH:mm' })
  @Matches(HHMM, { message: 'openTime debe tener formato HH:mm' })
  openTime: string;

  @Field(() => String, { description: 'Hora de cierre HH:mm' })
  @Matches(HHMM, { message: 'closeTime debe tener formato HH:mm' })
  closeTime: string;
}

/**
 * Reemplaza por completo el horario semanal de la zona. Es un set, no un patch:
 * enviar una lista vacía deja la zona sin días de apertura, que es la forma de
 * cerrarla sin borrarla.
 */
@InputType()
export class SetAmenitySchedulesInput {
  @Field()
  @IsUUID()
  amenityId: string;

  @Field(() => [AmenityScheduleInput])
  @IsArray()
  @ArrayMaxSize(21)
  @ValidateNested({ each: true })
  @Type(() => AmenityScheduleInput)
  schedules: AmenityScheduleInput[];
}
