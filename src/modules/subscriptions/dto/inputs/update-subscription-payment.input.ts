import { Field, Float, ID, InputType } from '@nestjs/graphql';
import {
  IsBoolean,
  IsDate,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

@InputType({
  description:
    'Corregir un pago registrado. Solo cambia lo que se envía; el motivo queda en el historial.',
})
export class UpdateSubscriptionPaymentInput {
  @Field(() => ID)
  @IsUUID()
  periodId: string;

  @Field(() => Float, {
    nullable: true,
    description: 'Valor que pagó el conjunto, ya descontadas sus retenciones',
  })
  @IsOptional()
  @IsNumber()
  @Min(0)
  amount?: number;

  @Field(() => Boolean, {
    nullable: true,
    description:
      'true = desglosar con los impuestos vigentes del conjunto (globales y locales) en vez de las tarifas guardadas al pagar. Sirve cuando el pago se registró antes de configurar una retención.',
  })
  @IsOptional()
  @IsBoolean()
  useCurrentTaxes?: boolean;

  @Field(() => Date, { nullable: true })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  paidAt?: Date;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  paymentReference?: string;

  @Field(() => String, { description: 'Motivo de la corrección' })
  @IsString()
  @MinLength(3)
  @MaxLength(1000)
  reason: string;
}
