import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsUUID,
  IsOptional,
  IsPositive,
  IsDateString,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Entrega de la devolución que quedó pendiente al cancelar una reserva pagada.
 *
 * Va aparte de la cancelación porque son dos hechos distintos: cancelar crea la
 * obligación, y el dinero sale de la caja el día que el residente se acerca a
 * reclamarlo. Contabilizar la salida antes dejaría el arqueo descuadrado.
 */
@InputType()
export class RegisterAmenityBookingRefundInput {
  @Field()
  @IsUUID()
  bookingId: string;

  /** Lo que se entregó. Por defecto, la devolución pendiente completa. */
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsPositive()
  amount?: number;

  /** Fecha real en que salió el dinero. Por defecto, hoy. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  paidAt?: string;

  /** Número de recibo, quién lo recibió, lo que la administración necesite. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
