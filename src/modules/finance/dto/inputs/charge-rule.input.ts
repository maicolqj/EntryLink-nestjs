import { InputType, ObjectType, Field, Float } from '@nestjs/graphql';
import {
  IsEnum, IsOptional, IsNumber, IsPositive, IsString, MaxLength, ValidateIf,
} from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

import { ChargeRuleTargetType }    from '../../enums/charge-rule-target-type.enum';
import { ChargeCalculationMethod } from '../../enums/charge-calculation-method.enum';

/**
 * Regla de cálculo dentro de una emisión. `targetValue` es un objeto libre cuya
 * forma depende de `targetType`:
 *   - UNIT_TYPE      → { unitType: "APARTMENT" }
 *   - SPECIFIC_UNITS → { unitIds: ["uuid", ...] }
 *   - TARGET_RULES   → { excludeFloor1, floorMin, floorMax, buildingIds, unitTypes }
 *   - ALL            → null / {}
 */
@InputType()
export class ChargeRuleInput {

  @Field(() => ChargeRuleTargetType)
  @IsEnum(ChargeRuleTargetType)
  targetType: ChargeRuleTargetType;

  @Field(() => GraphQLJSON, { nullable: true })
  @IsOptional()
  targetValue?: Record<string, any> | null;

  @Field(() => ChargeCalculationMethod)
  @IsEnum(ChargeCalculationMethod)
  calculationMethod: ChargeCalculationMethod;

  /** FIXED / PER_ATTRIBUTE: monto por unidad (o por unidad de atributo). */
  @Field(() => Float, { nullable: true })
  @ValidateIf(o =>
    o.calculationMethod === ChargeCalculationMethod.FIXED ||
    o.calculationMethod === ChargeCalculationMethod.PER_ATTRIBUTE)
  @IsNumber()
  @IsPositive()
  amount?: number | null;

  /** BY_COEFFICIENT: monto total a prorratear entre el target. */
  @Field(() => Float, { nullable: true })
  @ValidateIf(o => o.calculationMethod === ChargeCalculationMethod.BY_COEFFICIENT)
  @IsNumber()
  @IsPositive()
  totalAmount?: number | null;

  /** BY_AREA: tarifa por m². */
  @Field(() => Float, { nullable: true })
  @ValidateIf(o => o.calculationMethod === ChargeCalculationMethod.BY_AREA)
  @IsNumber()
  @IsPositive()
  ratePerSqm?: number | null;

  /** PER_ATTRIBUTE: atributo de la unidad a multiplicar (parkingSpots | storageRooms | bedrooms | bathrooms). */
  @Field(() => String, { nullable: true })
  @ValidateIf(o => o.calculationMethod === ChargeCalculationMethod.PER_ATTRIBUTE)
  @IsString()
  @MaxLength(40)
  attributeKey?: string | null;
}

/** Espejo ObjectType para devolver las reglas persistidas en la emisión. */
@ObjectType()
export class ChargeRule {

  @Field(() => ChargeRuleTargetType)
  targetType: ChargeRuleTargetType;

  @Field(() => GraphQLJSON, { nullable: true })
  targetValue?: Record<string, any> | null;

  @Field(() => ChargeCalculationMethod)
  calculationMethod: ChargeCalculationMethod;

  @Field(() => Float, { nullable: true })
  amount?: number | null;

  @Field(() => Float, { nullable: true })
  totalAmount?: number | null;

  @Field(() => Float, { nullable: true })
  ratePerSqm?: number | null;

  @Field(() => String, { nullable: true })
  attributeKey?: string | null;
}
