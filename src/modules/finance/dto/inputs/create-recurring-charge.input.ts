import { InputType, Field, Float, Int } from '@nestjs/graphql';
import {
  IsUUID, IsPositive, IsNotEmpty, IsOptional, IsString,
  MaxLength, IsEnum, IsInt, Min, Max, IsBoolean, IsArray,
} from 'class-validator';

import { Type } from 'class-transformer';
import { ValidateNested, ArrayUnique } from 'class-validator';

import { RecurringChargeType } from '../../enums/recurring-charge-type.enum';
import { FeeConfigBillingMode } from '../../enums/fee-config-billing-mode.enum';
import { RecurringChargeDistribution } from '../../enums/recurring-charge-distribution.enum';
import { RecurringChargeTrigger } from '../../enums/recurring-charge-trigger.enum';
import { FeeConfigTargetRulesInput } from './fee-config-target-rules.input';

@InputType()
export class CreateRecurringChargeInput {

  @Field()
  @IsUUID()
  complexId: string;

  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(200)
  concept: string;

  @Field(() => RecurringChargeType)
  @IsEnum(RecurringChargeType)
  type: RecurringChargeType;

  @Field(() => Float)
  @IsPositive()
  amount: number;

  /** Solo diferidos: nº total de cuotas. */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  totalInstallments?: number;

  /** Día del mes en que se causa (1-31). 31 = último día; la causación lo ajusta
   *  al último día real del mes (28/30/31) vía Math.min en buildPeriodDate. */
  @Field(() => Int, { defaultValue: 1 })
  @IsInt()
  @Min(1)
  @Max(31)
  billingDay: number;

  /**
   * Modo de facturación. ARREARS (mes vencido) por defecto: vence el `billingDay`
   * del mes siguiente al causado, así un cargo causado hoy no nace vencido.
   */
  @Field(() => FeeConfigBillingMode, { nullable: true, defaultValue: FeeConfigBillingMode.ARREARS })
  @IsOptional()
  @IsEnum(FeeConfigBillingMode)
  billingMode?: FeeConfigBillingMode;

  /** Cuenta de ingreso PUC a acreditar (ej. 4225). */
  @Field()
  @IsUUID()
  incomeAccountId: string;

  /** Null = aplica a todas las unidades del complejo. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  /** @deprecated Usar `distribution`. Si se envía, COEFFICIENT cuando es true. */
  @Field({ nullable: true, defaultValue: false })
  @IsOptional()
  @IsBoolean()
  prorateByCoefficient?: boolean;

  /** Método de reparto. Default FIXED_PER_UNIT (el monto es por cada unidad). */
  @Field(() => RecurringChargeDistribution, { nullable: true, defaultValue: RecurringChargeDistribution.FIXED_PER_UNIT })
  @IsOptional()
  @IsEnum(RecurringChargeDistribution)
  distribution?: RecurringChargeDistribution;

  /** Asignación: MANUAL (segmentada) o VEHICLE (por cada vehículo activo). */
  @Field(() => RecurringChargeTrigger, { nullable: true, defaultValue: RecurringChargeTrigger.MANUAL })
  @IsOptional()
  @IsEnum(RecurringChargeTrigger)
  triggerType?: RecurringChargeTrigger;

  /** Solo VEHICLE: tipos de vehículo a los que aplica (vacío = todos). */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  vehicleTypes?: string[];

  /** Segmentación: a quién se cobra (excluir piso 1, rango de pisos, torres, tipos). */
  @Field(() => FeeConfigTargetRulesInput, { nullable: true })
  @IsOptional()
  @ValidateNested()
  @Type(() => FeeConfigTargetRulesInput)
  targetRules?: FeeConfigTargetRulesInput;

  /** Selección manual de unidades (prioridad sobre unitId y targetRules). */
  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayUnique()
  @IsUUID('4', { each: true })
  targetUnitIds?: string[];

  /** % descuento pronto pago de este concepto. Null/omitido = usar el global. */
  @Field(() => Float, { nullable: true })
  @IsOptional()
  @Min(0)
  @Max(100)
  earlyDiscountPct?: number;

  /** Día del mes (1-31) límite del pronto pago. Null/omitido = usar el global.
   *  31 = último día; la causación lo ajusta al último día real del mes. */
  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(31)
  earlyDiscountDay?: number;
}
