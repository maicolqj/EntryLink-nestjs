import { InputType, Field } from '@nestjs/graphql';
import {
  IsEnum,
  IsNotEmpty,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { UnitAssetType } from '../../enums/unit-asset-type.enum';

@InputType()
export class CreateUnitAssetInput {
  @Field(() => String)
  @IsUUID()
  unitId: string;

  @Field(() => UnitAssetType)
  @IsEnum(UnitAssetType)
  type: UnitAssetType;

  @Field(() => String, { description: 'Número o código. Ej: "S1-14"' })
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  location?: string;
}

@InputType()
export class UpdateUnitAssetInput {
  @Field(() => String)
  @IsUUID()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(50)
  code?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(150)
  location?: string;
}
