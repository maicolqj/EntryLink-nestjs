import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsNotEmpty, Matches, IsOptional } from 'class-validator';

@InputType()
export class GenerateChargesInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  /**
   * Período de facturación en formato YYYY-MM (ej. "2025-03").
   * Se generarán cargos para todas las configuraciones activas del complejo.
   */
  @Field()
  @IsString()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, {
    message: 'El período debe tener el formato YYYY-MM (ej. 2025-03)',
  })
  period: string;

  /**
   * Si se especifica, solo genera cargos para esa configuración.
   * Útil para cuotas extraordinarias.
   */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  feeConfigId?: string;
}
