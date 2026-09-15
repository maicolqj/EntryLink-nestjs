import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { PetIncident } from '../../entities/pet-incident.entity';

@ObjectType()
export class PaginatedPetIncidentsResponse {
  @Field(() => [PetIncident])
  items: PetIncident[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
