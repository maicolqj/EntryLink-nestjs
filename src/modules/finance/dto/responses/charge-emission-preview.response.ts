import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

/** Desglose calculado de un cargo para una unidad (sin persistir). */
@ObjectType()
export class ChargeEmissionPreviewLine {

  @Field()
  unitId: string;

  @Field()
  unitNumber: string;

  @Field(() => Int)
  ruleIndex: number;

  @Field(() => Float)
  amount: number;
}

/** Solapamiento: una unidad cubierta por más de una regla. */
@ObjectType()
export class ChargeRuleConflict {

  @Field()
  unitId: string;

  @Field()
  unitNumber: string;

  @Field(() => [Int])
  ruleIndexes: number[];
}

/** Resultado de previewChargeEmission: desglose por unidad sin persistir. */
@ObjectType()
export class ChargeEmissionPreviewResponse {

  @Field()
  emissionId: string;

  @Field()
  period: string;

  @Field()
  conceptName: string;

  @Field(() => [ChargeEmissionPreviewLine])
  lines: ChargeEmissionPreviewLine[];

  @Field(() => Int)
  unitsCharged: number;

  @Field(() => Float)
  total: number;

  /** Unidades cubiertas por más de una regla (bloquea la confirmación). */
  @Field(() => [ChargeRuleConflict])
  conflicts: ChargeRuleConflict[];

  /** Números de unidades del complejo no cubiertas por ninguna regla. */
  @Field(() => [String])
  uncoveredUnits: string[];

  /** Avisos no bloqueantes (unidades sin área/coeficiente, etc.). */
  @Field(() => [String])
  warnings: string[];
}
