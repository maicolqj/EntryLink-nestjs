import { Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { SubscriptionTaxKind } from '../../enums/subscription-tax-kind.enum';

@InputType({ description: 'Crear o editar un impuesto de la suscripción' })
export class SaveSubscriptionTaxInput {
  @Field(() => ID, { nullable: true, description: 'Vacío = crear uno nuevo' })
  @IsOptional()
  @IsUUID()
  id?: string;

  @Field(() => ID, {
    nullable: true,
    description:
      'Conjunto al que aplica (impuesto local). Vacío = global. Solo al crear: un impuesto no cambia de alcance.',
  })
  @IsOptional()
  @IsUUID()
  complexId?: string;

  @Field(() => SubscriptionTaxKind, {
    nullable: true,
    description: 'Vacío al crear = CHARGE (se suma)',
  })
  @IsOptional()
  @IsEnum(SubscriptionTaxKind)
  kind?: SubscriptionTaxKind;

  @Field(() => String)
  @IsString()
  @MinLength(2)
  @MaxLength(60)
  name: string;

  @Field(() => Float, { description: 'Tarifa en porcentaje (19 = 19 %)' })
  @IsNumber()
  @Min(0)
  @Max(100)
  rate: number;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  sortOrder?: number;
}
