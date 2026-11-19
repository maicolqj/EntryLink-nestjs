import { Field, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, Length } from 'class-validator';
import {
  GrowthIdentifierType,
  GrowthSuppressionReason,
  GrowthSuppressionScope,
  GrowthSuppressionStatus,
} from '../../../shared/growth.enums';

@InputType()
export class GrowthAddSuppressionInput {
  @Field(() => GrowthIdentifierType)
  @IsEnum(GrowthIdentifierType)
  identifierType: GrowthIdentifierType;

  @Field({ description: 'Se normaliza y se guarda SOLO su hash con llave' })
  @IsString()
  @Length(3, 320)
  value: string;

  @Field(() => GrowthSuppressionScope, {
    defaultValue: GrowthSuppressionScope.ALL_CHANNELS,
  })
  @IsEnum(GrowthSuppressionScope)
  scope: GrowthSuppressionScope = GrowthSuppressionScope.ALL_CHANNELS;

  @Field(() => GrowthSuppressionReason)
  @IsEnum(GrowthSuppressionReason)
  reason: GrowthSuppressionReason;
}

@InputType()
export class GrowthCheckSuppressionInput {
  @Field(() => GrowthIdentifierType)
  @IsEnum(GrowthIdentifierType)
  identifierType: GrowthIdentifierType;

  @Field()
  @IsString()
  @Length(3, 320)
  value: string;

  @Field(() => GrowthSuppressionScope, {
    nullable: true,
    description:
      'Canal a usar. Vacío = bloqueado si hay cualquier exclusión activa.',
  })
  @IsOptional()
  @IsEnum(GrowthSuppressionScope)
  channel?: GrowthSuppressionScope;
}

/**
 * Levantar una exclusión es excepcional: exige fundamento jurídico y un
 * soporte verificable (p. ej. la autorización escrita del titular).
 */
@InputType()
export class GrowthLiftSuppressionInput {
  @Field({
    description: 'Fundamento jurídico del levantamiento (mín. 10 caracteres)',
  })
  @IsString()
  @Length(10, 2000)
  legalBasis: string;

  @Field({
    description:
      'Referencia verificable del soporte (radicado, documento, acta)',
  })
  @IsString()
  @Length(3, 500)
  evidenceReference: string;
}

@InputType()
export class GrowthSuppressionFilterInput {
  @Field(() => GrowthSuppressionStatus, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthSuppressionStatus)
  status?: GrowthSuppressionStatus;

  @Field(() => GrowthIdentifierType, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthIdentifierType)
  identifierType?: GrowthIdentifierType;
}
