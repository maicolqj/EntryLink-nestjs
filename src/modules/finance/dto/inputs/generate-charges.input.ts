import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsNotEmpty, Matches } from 'class-validator';

@InputType()
export class GenerateChargesInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  /**
   * Período de facturación en formato YYYY-MM (ej. "2025-03").
   * Genera cargos para TODAS las FeeConfigs activas del complejo que correspondan
   * a este período según su frecuencia.
   */
  @Field()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'El período debe tener el formato YYYY-MM (ej. 2025-03)',
  })
  period: string;
}
