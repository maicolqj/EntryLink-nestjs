import { Type } from 'class-transformer';
import {
  IsDate,
  IsNumber,
  IsOptional,
  IsPositive,
  IsString,
  MaxLength,
} from 'class-validator';

/**
 * Lo que declara el conjunto al enviar el soporte. Llega como campos del POST
 * multipart junto al comprobante (`receipt`), por eso no es un InputType.
 */
export class SubmitSubscriptionPaymentDto {
  @Type(() => Number)
  @IsNumber({ maxDecimalPlaces: 2 })
  @IsPositive()
  amountPaid: number;

  @Type(() => Date)
  @IsDate()
  paidAt: Date;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  reference?: string;
}
