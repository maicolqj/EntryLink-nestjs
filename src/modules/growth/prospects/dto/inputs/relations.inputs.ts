import { Field, ID, InputType, Int } from '@nestjs/graphql';
import { Type } from 'class-transformer';
import {
  IsBoolean,
  IsEnum,
  IsInt,
  Max,
  Min,
  IsIn,
  IsISO8601,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  ValidateNested,
} from 'class-validator';
import {
  GrowthChannelClass,
  GrowthChannelKind,
  GrowthContactStatus,
  GrowthLegalBasis,
  GrowthManagerType,
  GrowthProspectKind,
  GrowthRelationStatus,
  GrowthValidationDecision,
} from '../../prospects.enums';
import { GrowthSourceReferenceInput } from './source-reference.input';

// ── Canales ─────────────────────────────────────────────────────────────────

@InputType()
export class GrowthChannelInput {
  @Field(() => GrowthChannelKind)
  @IsEnum(GrowthChannelKind)
  kind: GrowthChannelKind;

  @Field({ nullable: true, description: 'Solo para SOCIAL (p. ej. facebook)' })
  @IsOptional()
  @IsString()
  @Length(2, 30)
  socialNetwork?: string;

  @Field()
  @IsString()
  @Length(3, 320)
  value: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(1, 60)
  label?: string;

  @Field(() => GrowthSourceReferenceInput)
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

@InputType()
export class GrowthPersonChannelInput extends GrowthChannelInput {
  @Field(() => GrowthChannelClass, {
    description:
      'PROFESSIONAL: publicado como canal de trabajo. DIRECT: personal (solo usable con base jurídica válida).',
  })
  @IsEnum(GrowthChannelClass)
  channelClass: GrowthChannelClass;
}

// ── Relaciones ──────────────────────────────────────────────────────────────

@InputType()
export class GrowthLinkEmploymentInput {
  @Field(() => ID)
  @IsUUID()
  personId: string;

  @Field(() => ID)
  @IsUUID()
  organizationId: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  roleTitle?: string;

  @Field({ nullable: true, description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsISO8601({ strict: true })
  startedOn?: string;

  @Field(() => GrowthRelationStatus, {
    defaultValue: GrowthRelationStatus.UNCONFIRMED,
    description: 'CURRENT o UNCONFIRMED (PAST se registra al terminar)',
  })
  @IsIn([GrowthRelationStatus.CURRENT, GrowthRelationStatus.UNCONFIRMED])
  status: GrowthRelationStatus = GrowthRelationStatus.UNCONFIRMED;

  @Field(() => GrowthSourceReferenceInput)
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

@InputType()
export class GrowthEndRelationInput {
  @Field({ description: 'YYYY-MM-DD' })
  @IsISO8601({ strict: true })
  endedOn: string;
}

@InputType()
export class GrowthSetPropertyManagerInput {
  @Field(() => ID)
  @IsUUID()
  propertyId: string;

  @Field(() => GrowthManagerType)
  @IsEnum(GrowthManagerType)
  managerType: GrowthManagerType;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  organizationId?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Administrador independiente',
  })
  @IsOptional()
  @IsUUID()
  personId?: string;

  @Field(() => ID, {
    nullable: true,
    description: 'Responsable designado por la empresa (solo si está validado)',
  })
  @IsOptional()
  @IsUUID()
  responsiblePersonId?: string;

  @Field({ nullable: true, description: 'YYYY-MM-DD' })
  @IsOptional()
  @IsISO8601({ strict: true })
  startedOn?: string;

  @Field(() => GrowthRelationStatus, {
    defaultValue: GrowthRelationStatus.UNCONFIRMED,
    description: 'CURRENT cierra la administración vigente anterior',
  })
  @IsIn([GrowthRelationStatus.CURRENT, GrowthRelationStatus.UNCONFIRMED])
  status: GrowthRelationStatus = GrowthRelationStatus.UNCONFIRMED;

  @Field(() => GrowthSourceReferenceInput)
  @ValidateNested()
  @Type(() => GrowthSourceReferenceInput)
  source: GrowthSourceReferenceInput;
}

// ── Validación ──────────────────────────────────────────────────────────────

@InputType()
export class GrowthProspectRefInput {
  @Field(() => GrowthProspectKind)
  @IsEnum(GrowthProspectKind)
  kind: GrowthProspectKind;

  @Field(() => ID)
  @IsUUID()
  id: string;
}

@InputType()
export class GrowthDecideValidationInput {
  @Field(() => GrowthValidationDecision)
  @IsEnum(GrowthValidationDecision)
  decision: GrowthValidationDecision;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(3, 2000)
  note?: string;
}

@InputType()
export class GrowthReopenInput {
  @Field()
  @IsString()
  @Length(10, 2000)
  reason: string;
}

// ── Asignación ──────────────────────────────────────────────────────────────

@InputType()
export class GrowthAssignProspectInput {
  @Field(() => GrowthProspectRefInput)
  @ValidateNested()
  @Type(() => GrowthProspectRefInput)
  prospect: GrowthProspectRefInput;

  @Field(() => ID)
  @IsUUID()
  teamMemberId: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(3, 500)
  reason?: string;
}

// ── Base jurídica y contacto ────────────────────────────────────────────────

@InputType()
export class GrowthSetLegalBasisInput {
  @Field(() => GrowthLegalBasis)
  @IsEnum(GrowthLegalBasis)
  legalBasis: GrowthLegalBasis;

  @Field({
    nullable: true,
    description: 'Concepto o soporte (obligatorio salvo PENDING_LEGAL_REVIEW)',
  })
  @IsOptional()
  @IsString()
  @Length(5, 2000)
  reference?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(10, 2000)
  processingPurpose?: string;
}

@InputType()
export class GrowthSetContactStatusInput {
  @Field(() => GrowthContactStatus, { description: 'AUTHORIZED o REVOKED' })
  @IsIn([GrowthContactStatus.AUTHORIZED, GrowthContactStatus.REVOKED])
  status: GrowthContactStatus;

  @Field()
  @IsString()
  @Length(10, 2000)
  reason: string;
}

// ── Configuración ───────────────────────────────────────────────────────────

@InputType()
export class GrowthUpdateSettingsInput {
  @Field({
    nullable: true,
    description: 'Desactivar al incorporar otros validadores',
  })
  @IsOptional()
  @IsBoolean()
  allowSuperAdminSelfValidation?: boolean;

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(100000)
  prospectGoal?: number;
}
