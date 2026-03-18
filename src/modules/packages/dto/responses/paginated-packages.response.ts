import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Package } from '../../entities/package.entity';

@ObjectType()
export class PaginatedPackagesResponse {

  @Field(() => [Package])
  items: Package[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
