import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { Transform, Type } from 'class-transformer';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsBoolean,
  IsDate,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
  Min,
  ValidateNested,
} from 'class-validator';
import {
  GrowthChannelClass,
  GrowthEvidenceReliability,
} from '../../../prospects/prospects.enums';
import {
  GrowthImportDecision,
  GrowthImportField,
  GrowthImportRowResult,
  GrowthImportStatus,
  GrowthImportTarget,
  GrowthImportTemplateScope,
} from '../../imports.enums';

/**
 * Campos del formulario multipart de `POST /growth/imports`. Llegan como
 * texto: la fecha se convierte aquí.
 */
export class GrowthUploadImportDto {
  @IsEnum(GrowthImportTarget)
  target: GrowthImportTarget;

  @IsUUID()
  sourceId: string;

  @Transform(({ value }: { value: unknown }) =>
    typeof value === 'string' && value ? new Date(value) : value,
  )
  @IsDate()
  consultedAt: Date;

  @IsOptional()
  @IsEnum(GrowthEvidenceReliability)
  reliability?: GrowthEvidenceReliability;

  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  url?: string;

  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}

@InputType()
export class GrowthImportColumnMappingInput {
  @Field(() => Int, { description: 'Posición de la columna (desde 0)' })
  @IsInt()
  @Min(0)
  column: number;

  @Field(() => GrowthImportField)
  @IsEnum(GrowthImportField)
  field: GrowthImportField;
}

@InputType()
export class GrowthMapImportInput {
  @Field(() => ID)
  @IsUUID()
  batchId: string;

  @Field(() => [GrowthImportColumnMappingInput])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GrowthImportColumnMappingInput)
  mapping: GrowthImportColumnMappingInput[];

  @Field(() => GrowthChannelClass, {
    nullable: true,
    description:
      'Solo personas, obligatorio si se importa correo o teléfono: PROFESSIONAL (publicado como canal de trabajo) o DIRECT',
  })
  @IsOptional()
  @IsEnum(GrowthChannelClass)
  personChannelClass?: GrowthChannelClass;

  @Field({
    nullable: true,
    description:
      'Guardar este mapeo como plantilla PERSONAL con este nombre. Un nombre que ya tienes es un error: nunca sobrescribe',
  })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  saveAsTemplate?: string;
}

@InputType()
export class GrowthImportRowDecisionInput {
  @Field(() => ID)
  @IsUUID()
  rowId: string;

  @Field(() => GrowthImportDecision)
  @IsEnum(GrowthImportDecision)
  decision: GrowthImportDecision;

  @Field(() => ID, {
    nullable: true,
    description: 'Obligatorio con LINK_EXISTING: el registro existente',
  })
  @IsOptional()
  @IsUUID()
  linkEntityId?: string;
}

@InputType()
export class GrowthImportBatchFilterInput {
  @Field(() => [GrowthImportStatus], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(GrowthImportStatus, { each: true })
  statuses?: GrowthImportStatus[];

  @Field(() => GrowthImportTarget, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthImportTarget)
  target?: GrowthImportTarget;
}

@InputType()
export class GrowthImportRowFilterInput {
  @Field({ nullable: true, description: 'Solo filas con errores' })
  @IsOptional()
  @IsBoolean()
  withErrors?: boolean;

  @Field({ nullable: true, description: 'Solo filas con avisos' })
  @IsOptional()
  @IsBoolean()
  withWarnings?: boolean;

  @Field(() => GrowthImportDecision, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthImportDecision)
  decision?: GrowthImportDecision;

  @Field(() => GrowthImportRowResult, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthImportRowResult)
  result?: GrowthImportRowResult;
}

@InputType()
export class GrowthImportHeaderMappingInput {
  @Field({ description: 'Encabezado de la columna (nunca un valor)' })
  @IsString()
  @Length(1, 200)
  header: string;

  @Field(() => GrowthImportField)
  @IsEnum(GrowthImportField)
  field: GrowthImportField;
}

@InputType()
export class GrowthCreateImportTemplateInput {
  @Field(() => GrowthImportTarget)
  @IsEnum(GrowthImportTarget)
  target: GrowthImportTarget;

  @Field()
  @IsString()
  @Length(2, 80)
  name: string;

  @Field(() => GrowthImportTemplateScope, {
    nullable: true,
    description:
      'PERSONAL por defecto; TEAM exige MANAGE_GROWTH_IMPORT_TEMPLATES',
  })
  @IsOptional()
  @IsEnum(GrowthImportTemplateScope)
  scope?: GrowthImportTemplateScope;

  @Field(() => [GrowthImportHeaderMappingInput])
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GrowthImportHeaderMappingInput)
  columnMapping: GrowthImportHeaderMappingInput[];
}

@InputType()
export class GrowthUpdateImportTemplateInput {
  @Field(() => ID)
  @IsUUID()
  id: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  name?: string;

  @Field(() => [GrowthImportHeaderMappingInput], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(1)
  @ArrayMaxSize(100)
  @ValidateNested({ each: true })
  @Type(() => GrowthImportHeaderMappingInput)
  columnMapping?: GrowthImportHeaderMappingInput[];
}
