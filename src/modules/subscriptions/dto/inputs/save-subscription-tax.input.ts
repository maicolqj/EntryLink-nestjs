import { Field, Float, ID, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
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

@InputType({ description: 'Crear o editar un impuesto de la suscripción' })
export class SaveSubscriptionTaxInput {
  @Field(() => ID, { nullable: true, description: 'Vacío = crear uno nuevo' })
  @IsOptional()
  @IsUUID()
  id?: string;

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
