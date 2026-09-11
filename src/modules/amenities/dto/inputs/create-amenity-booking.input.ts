import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsUUID, IsDateString, IsOptional, IsInt, Min, IsString, MaxLength, IsBoolean,
} from 'class-validator';

@InputType()
export class CreateAmenityBookingInput {

  @Field()
  @IsUUID()
  amenityId: string;

  @Field(() => String, { description: 'Inicio de la reserva (ISO 8601)' })
  @IsDateString()
  startAt: string;

  @Field(() => String, { description: 'Fin de la reserva (ISO 8601). Exclusivo: 12:00 no choca con una reserva que empieza a las 12:00' })
  @IsDateString()
  endAt: string;

  @Field(() => Int, { defaultValue: 1 })
  @IsInt()
  @Min(1)
  attendees: number = 1;

  @Field(() => String, { nullable: true, description: 'Motivo del evento (ej. cumpleaños)' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  purpose?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  /**
   * Consumir la reserva gratuita anual del consejo, si a quien reserva le
   * queda alguna. Llega en true por defecto para que quien no conozca el
   * beneficio no tenga que pedirlo; ponerlo en false guarda el cupo del año
   * para otra ocasión y esta reserva se cobra normal.
   */
  @Field(() => Boolean, { defaultValue: true, description: 'Usar el cupo anual del consejo si aplica' })
  @IsOptional()
  @IsBoolean()
  useCouncilFreeQuota?: boolean = true;

  /**
   * Solo para staff que reserva a nombre de una unidad. Cuando reserva un
   * residente se ignora: la unidad sale de su ficha, no del cliente.
   */
  @Field(() => String, { nullable: true, description: 'Unidad a nombre de la cual se reserva (solo staff)' })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
