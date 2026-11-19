import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsArray,
  IsBoolean,
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
  GrowthBogotaLocality,
  GrowthBuildingKind,
  GrowthInfoStatus,
  GrowthInterestSignal,
  GrowthPhType,
  GrowthPriority,
  GrowthValidationStatus,
} from '../../prospects.enums';
import { GrowthSourceReferenceInput } from './source-reference.input';

// ── Empresas ────────────────────────────────────────────────────────────────

@InputType()
export class GrowthOrganizationFieldsInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  legalName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  tradeName?: string;

  @Field({
    nullable: true,
    description: 'Con o sin puntos y dígito de verificación',
  })
  @IsOptional()
  @IsString()
  @Length(6, 16)
  nit?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsUrl({ require_protocol: false })
  website?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(3, 300)
  address?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  city?: string;

  @Field(() => GrowthBogotaLocality, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthBogotaLocality)
  locality?: GrowthBogotaLocality;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedProperties?: number;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  estimatedUnits?: number;

  @Field(() => GrowthInterestSignal, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthInterestSignal)
  interestSignal?: GrowthInterestSignal;
}

@InputType()
export class GrowthCreateOrganizationInput extends GrowthOrganizationFieldsInput {
  @Field()
  @IsString()
  @Length(2, 200)
  declare legalName: string;

  @Field(() => GrowthSourceReferenceInput)
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

@InputType()
export class GrowthUpdateOrganizationInput extends GrowthOrganizationFieldsInput {
  @Field(() => GrowthSourceReferenceInput, {
    description: 'Fuente de los datos que cambian (obligatoria)',
  })
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

// ── Personas ────────────────────────────────────────────────────────────────

@InputType()
export class GrowthCreatePersonInput {
  @Field()
  @IsString()
  @Length(2, 160)
  fullName: string;

  @Field({ defaultValue: false })
  @IsBoolean()
  isIndependentAdmin: boolean = false;

  @Field({
    nullable: true,
    description: 'Finalidad del tratamiento. Vacío = la de la fuente.',
  })
  @IsOptional()
  @IsString()
  @Length(10, 2000)
  processingPurpose?: string;

  @Field(() => GrowthSourceReferenceInput)
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

@InputType()
export class GrowthUpdatePersonInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 160)
  fullName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsBoolean()
  isIndependentAdmin?: boolean;

  @Field(() => GrowthSourceReferenceInput)
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

// ── Copropiedades ───────────────────────────────────────────────────────────

@InputType()
export class GrowthPropertyFieldsInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 200)
  name?: string;

  @Field(() => GrowthPhType, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthPhType)
  phType?: GrowthPhType;

  @Field(() => GrowthBuildingKind, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthBuildingKind)
  buildingKind?: GrowthBuildingKind;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(3, 300)
  address?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 60)
  city?: string;

  @Field(() => GrowthBogotaLocality, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthBogotaLocality)
  locality?: GrowthBogotaLocality;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  neighborhood?: string;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  estimatedUnits?: number;

  @Field({ nullable: true, description: 'Matrícula inmobiliaria' })
  @IsOptional()
  @IsString()
  @Length(3, 40)
  realEstateRegistration?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(6, 16)
  nit?: string;

  @Field(() => GrowthInfoStatus, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthInfoStatus)
  infoStatus?: GrowthInfoStatus;
}

@InputType()
export class GrowthCreatePropertyInput extends GrowthPropertyFieldsInput {
  @Field()
  @IsString()
  @Length(2, 200)
  declare name: string;

  @Field(() => GrowthSourceReferenceInput)
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

@InputType()
export class GrowthUpdatePropertyInput extends GrowthPropertyFieldsInput {
  @Field(() => GrowthSourceReferenceInput)
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

// ── Filtros ─────────────────────────────────────────────────────────────────

@InputType()
export class GrowthProspectFilterInput {
  @Field({
    nullable: true,
    description: 'Texto libre (nombre, NIT, dirección)',
  })
  @IsOptional()
  @IsString()
  @Length(1, 100)
  search?: string;

  @Field(() => [GrowthValidationStatus], { nullable: true })
  @IsOptional()
  @IsArray()
  @IsEnum(GrowthValidationStatus, { each: true })
  statuses?: GrowthValidationStatus[];

  @Field(() => GrowthBogotaLocality, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthBogotaLocality)
  locality?: GrowthBogotaLocality;

  @Field(() => ID, { nullable: true, description: 'Responsable vigente' })
  @IsOptional()
  @IsUUID()
  assignedTeamMemberId?: string;

  @Field({
    nullable: true,
    description: 'Solo personas: administradores independientes',
  })
  @IsOptional()
  @IsBoolean()
  independentOnly?: boolean;

  @Field(() => GrowthPriority, {
    nullable: true,
    description:
      'Solo empresas y administradores independientes con esta prioridad',
  })
  @IsOptional()
  @IsEnum(GrowthPriority)
  priority?: GrowthPriority;

  @Field({ nullable: true, description: 'Ordenar por puntaje (mayor primero)' })
  @IsOptional()
  @IsBoolean()
  orderByScore?: boolean;
}
