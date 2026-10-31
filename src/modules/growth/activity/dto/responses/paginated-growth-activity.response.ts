import { Field, ObjectType } from '@nestjs/graphql';
import { PaginationReponse } from '../../../../shared/dto/responses/pagination-object.response';
import { ActivityEvent } from '../../entities/activity-event.entity';

@ObjectType('PaginatedGrowthActivity')
export class PaginatedGrowthActivityResponse {
  @Field(() => [ActivityEvent])
  items: ActivityEvent[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
