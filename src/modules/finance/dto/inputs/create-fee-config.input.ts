import { InputType, Field, Float, Int } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsEnum,
  IsNumber, Min, Max, IsPositive, MaxLength,
} from 'class-validator';

import { FeeFrequency } from '../../enums/fee-frequency.enum';
import { UnitType }     from '../../../residential-complex/enums/unit-type.enum';

@InputType()
export class CreateFeeConfigInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @Field(() => Float)
  @IsNumber()
  @IsPositive()
  amount: number;

  @Field(() => FeeFrequency, { defaultValue: FeeFrequency.MONTHLY })
  @IsEnum(FeeFrequency)
  frequency: FeeFrequency;

  @Field(() => Int, { defaultValue: 5 })
  @IsNumber()
  @Min(1)
  @Max(28)
  dueDayOfMonth: number;

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  /** Si se especifica, esta cuota aplica solo a esa unidad */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  unitId?: string;

  /** Si se especifica, aplica a todas las unidades de este tipo */
  @Field(() => UnitType, { nullable: true })
  @IsOptional()
  @IsEnum(UnitType)
  unitType?: UnitType;
}
