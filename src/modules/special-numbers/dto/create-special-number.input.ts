import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { SpecialNumberCategory } from '../enums/special-number-category.enum';

@InputType()
export class CreateSpecialNumberInput {

  @Field(() => String, { nullable: true, description: 'Requerido para números de complejo; omitir para números globales (solo SUPER_ADMIN)' })
  @IsOptional()
  @IsUUID()
  complexId?: string;

  @Field(() => Boolean, { nullable: true, defaultValue: false, description: 'true = número global visible en todos los complejos (solo SUPER_ADMIN)' })
  @IsOptional()
  @IsBoolean()
  isGlobal?: boolean;

  @Field(() => String)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @Field(() => String)
  @IsString()
  @MinLength(1)
  @MaxLength(50)
  phoneNumber: string;

  @Field(() => SpecialNumberCategory)
  @IsEnum(SpecialNumberCategory)
  category: SpecialNumberCategory;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  order?: number;
}
