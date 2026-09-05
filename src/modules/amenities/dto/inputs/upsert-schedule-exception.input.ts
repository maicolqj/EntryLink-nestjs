import { InputType, Field } from '@nestjs/graphql';
import {
  IsUUID, IsBoolean, IsOptional, IsString, MaxLength, Matches,
} from 'class-validator';

const HHMM = /^([01]\d|2[0-3]):([0-5]\d)$/;
const YYYYMMDD = /^\d{4}-(0[1-9]|1[0-2])-(0[1-9]|[12]\d|3[01])$/;

/**
 * Crea o reemplaza el horario especial de una fecha. Es un upsert por
 * (zona, fecha): el calendario del admin edita un día, no crea filas sueltas.
 */
@InputType()
export class UpsertScheduleExceptionInput {

  @Field()
  @IsUUID()
  amenityId: string;

  @Field(() => String, { description: 'Fecha en formato YYYY-MM-DD' })
  @Matches(YYYYMMDD, { message: 'La fecha debe tener formato YYYY-MM-DD' })
  date: string;

  @Field(() => Boolean, { defaultValue: false, description: 'true: la zona no abre ese día' })
  @IsBoolean()
  isClosed: boolean = false;

  @Field(() => String, { nullable: true, description: 'Requerido si isClosed=false. Formato HH:mm' })
  @IsOptional()
  @Matches(HHMM, { message: 'openTime debe tener formato HH:mm' })
  openTime?: string;

  @Field(() => String, { nullable: true, description: 'Requerido si isClosed=false. Un cierre anterior a la apertura termina al día siguiente' })
  @IsOptional()
  @Matches(HHMM, { message: 'closeTime debe tener formato HH:mm' })
  closeTime?: string;

  @Field(() => String, { nullable: true, description: 'Motivo; el residente lo ve cuando el día queda cerrado' })
  @IsOptional()
  @IsString()
  @MaxLength(200)
  reason?: string;
}
