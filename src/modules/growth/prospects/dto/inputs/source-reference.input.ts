import { Field, ID, InputType } from '@nestjs/graphql';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUrl,
  IsUUID,
  Length,
} from 'class-validator';
import { GrowthEvidenceReliability } from '../../prospects.enums';

/**
 * De dónde salió un dato. Obligatorio en toda alta: con él se registra la
 * evidencia de cada campo informado. La fuente debe estar ACTIVE (con
 * revisión jurídica aprobada).
 */
@InputType()
export class GrowthSourceReferenceInput {
  @Field(() => ID)
  @IsUUID()
  sourceId: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsUrl({ require_protocol: true, protocols: ['https', 'http'] })
  url?: string;

  @Field({ description: 'Cuándo se consultó la fuente (no puede ser futura)' })
  @IsDate()
  consultedAt: Date;

  @Field(() => GrowthEvidenceReliability, {
    defaultValue: GrowthEvidenceReliability.MEDIUM,
  })
  @IsEnum(GrowthEvidenceReliability)
  reliability: GrowthEvidenceReliability = GrowthEvidenceReliability.MEDIUM;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(0, 1000)
  notes?: string;
}
