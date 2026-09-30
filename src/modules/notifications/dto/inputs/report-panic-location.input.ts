import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsDateString,
  IsNumber,
  IsOptional,
  IsUUID,
  Max,
  Min,
} from 'class-validator';

/**
 * Una lectura de GPS de quien activó el pánico.
 *
 * Llega DESPUÉS del disparo: la alarma nunca espera al GPS, que en frío tarda
 * de 2 a 15 segundos y bajo techo más. La app puede mandar varias —la primera
 * y otra más precisa—; gana la última.
 */
@InputType()
export class ReportPanicLocationInput {
  @Field(() => String)
  @IsUUID()
  panicAlertId: string;

  @Field(() => Float)
  @IsNumber()
  @Min(-90)
  @Max(90)
  latitude: number;

  @Field(() => Float)
  @IsNumber()
  @Min(-180)
  @Max(180)
  longitude: number;

  /** Radio de error reportado por el GPS, en metros. */
  @Field(() => Float)
  @IsNumber()
  @Min(0)
  @Max(100_000)
  accuracy: number;

  /**
   * Cuándo tomó el equipo la lectura. Sin ella se usa la hora del servidor.
   * Sirve para distinguir una lectura fresca de una guardada en caché.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  capturedAt?: string;
}
