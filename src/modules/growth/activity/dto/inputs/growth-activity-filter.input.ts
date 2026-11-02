import { Field, ID, InputType } from '@nestjs/graphql';
import {
  ArrayMaxSize,
  IsArray,
  IsDate,
  IsEnum,
  IsOptional,
  IsUUID,
  Matches,
} from 'class-validator';
import { Type } from 'class-transformer';
import { GrowthEntityType } from '../../../shared/growth.enums';

@InputType()
export class GrowthActivityFilterInput {
  @Field(() => ID, {
    nullable: true,
    description: 'Requiere VIEW_GROWTH_ACTIVITY; sin él solo se ve la propia',
  })
  @IsOptional()
  @IsUUID()
  actorUserId?: string;

  @Field(() => GrowthEntityType, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthEntityType)
  entityType?: GrowthEntityType;

  @Field(() => ID, { nullable: true })
  @IsOptional()
  @IsUUID()
  entityId?: string;

  @Field(() => [String], {
    nullable: true,
    description:
      'Tipos de acción (p. ej. CHANNEL_ADDED, MERGED_INTO). Cualquiera de la lista. Máximo 20.',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @Matches(/^[A-Z][A-Z0-9_]{1,59}$/, { each: true })
  actions?: string[];

  @Field({
    nullable: true,
    description: 'Desde este instante, inclusive (ISO 8601)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  from?: Date;

  @Field({
    nullable: true,
    description: 'Hasta este instante, exclusivo (ISO 8601)',
  })
  @IsOptional()
  @Type(() => Date)
  @IsDate()
  to?: Date;
}
