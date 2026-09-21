import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsUUID,
  IsOptional,
  IsPositive,
  IsDateString,
  IsString,
  MaxLength,
  IsUrl,
} from 'class-validator';

/**
 * Pago del alquiler recibido en la administración, no en la cartera.
 *
 * El residente se acerca y paga; el dinero entra a caja del complejo y el
 * cargo deja de colgar de la unidad. Los daños no van por aquí: se constatan
 * al recibir la zona, cuando el residente ya no está en la ventanilla, y
 * siempre se cargan a la unidad.
 */
@InputType()
export class RegisterAmenityBookingPaymentInput {
  @Field()
  @IsUUID()
  bookingId: string;

  /**
   * Lo que efectivamente se recibió. Si no se envía, se toma el total de la
   * reserva (tarifa más aseo). Se permite distinto para el caso real de una
   * administración que redondea o aplica un descuento acordado.
   */
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @IsPositive()
  amount?: number;

  /** Fecha real en que se recibió el dinero. Por defecto, hoy. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  incomeDate?: string;

  /** Número de recibo, forma de pago, lo que la administración quiera dejar. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  receiptUrl?: string;
}
