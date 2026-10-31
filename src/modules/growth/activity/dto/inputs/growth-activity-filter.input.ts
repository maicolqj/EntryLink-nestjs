import { Field, ID, InputType } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsUUID } from 'class-validator';
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
}
