import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Pet } from '../../entities/pet.entity';

@ObjectType()
export class PaginatedPetsResponse {
  @Field(() => [Pet])
  items: Pet[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
