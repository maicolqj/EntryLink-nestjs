import { Field, Float, InputType, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsIn,
  IsInt,
  IsNumber,
  IsOptional,
  IsString,
  IsUrl,
  Length,
  Matches,
  Max,
  Min,
} from 'class-validator';
import {
  GrowthLegalReviewStatus,
  GrowthSourceKind,
  GrowthSourceStatus,
} from '../../../shared/growth.enums';

@InputType()
export class GrowthCreateDataSourceInput {
  @Field({
    description: 'Código único en mayúsculas, p. ej. CAMARA_COMERCIO_BOGOTA',
  })
  @Matches(/^[A-Z][A-Z0-9_]{1,39}$/)
  code: string;

  @Field()
  @IsString()
  @Length(3, 120)
  name: string;

  @Field(() => GrowthSourceKind)
  @IsEnum(GrowthSourceKind)
  kind: GrowthSourceKind;

  @Field({ nullable: true })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  baseUrl?: string;

  @Field({ description: 'Qué permiten los términos de la fuente' })
  @IsString()
  @Length(20, 4000)
  termsSummary: string;

  @Field({ description: 'Finalidad del tratamiento para esta fuente' })
  @IsString()
  @Length(20, 4000)
  processingPurpose: string;

  @Field({
    defaultValue: false,
    description: 'Uso automatizado. Exige revisión jurídica.',
  })
  @IsBoolean()
  allowsAutomation: boolean = false;
}

/**
 * Editar lo que define a la fuente (términos, finalidad, tipo, automatización)
 * invalida la revisión jurídica y la aprobación de costo: vuelve a
 * PENDING_APPROVAL. El presupuesto solo cambia con `growthApproveSourceCost`.
 */
@InputType()
export class GrowthUpdateDataSourceInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(3, 120)
  name?: string;

  @Field(() => GrowthSourceKind, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthSourceKind)
  kind?: GrowthSourceKind;

  @Field({ nullable: true })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  baseUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(20, 4000)
  termsSummary?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(20, 4000)
  processingPurpose?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  allowsAutomation?: boolean;
}

@InputType()
export class GrowthReviewSourceLegalInput {
  @Field(() => GrowthLegalReviewStatus, { description: 'APPROVED o REJECTED' })
  @IsIn([GrowthLegalReviewStatus.APPROVED, GrowthLegalReviewStatus.REJECTED])
  decision: GrowthLegalReviewStatus;

  @Field({
    description: 'Concepto jurídico, documento o acta que respalda la decisión',
  })
  @IsString()
  @Length(5, 2000)
  reference: string;
}

@InputType()
export class GrowthApproveSourceCostInput {
  @Field(() => Float, { description: 'Presupuesto mensual máximo en COP' })
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(0)
  @Max(1_000_000_000)
  monthlyBudgetCop: number;

  @Field(() => Int, { description: 'Tope de consultas por mes' })
  @IsInt()
  @Min(1)
  monthlyRequestCap: number;

  @Field({ description: 'Costo estimado, límites y beneficio esperado' })
  @IsString()
  @Length(20, 4000)
  costEstimateNotes: string;
}

@InputType()
export class GrowthSetSourceStatusInput {
  @Field(() => GrowthSourceStatus, { description: 'ACTIVE o DISABLED' })
  @IsIn([GrowthSourceStatus.ACTIVE, GrowthSourceStatus.DISABLED])
  status: GrowthSourceStatus;
}
