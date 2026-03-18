import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { ResidentialComplex } from '../../entities/residential-complex.entity';

@ObjectType()
export class PaginatedComplexesResponse {

  @Field(() => [ResidentialComplex])
  items: ResidentialComplex[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
