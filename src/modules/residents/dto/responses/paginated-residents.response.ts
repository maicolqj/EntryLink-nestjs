import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Resident } from '../../entities/resident.entity';

@ObjectType()
export class PaginatedResidentsResponse {

  @Field(() => [Resident])
  items: Resident[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
