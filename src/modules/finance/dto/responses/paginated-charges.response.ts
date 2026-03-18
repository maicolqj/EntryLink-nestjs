import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { FeeCharge }         from '../../entities/fee-charge.entity';

@ObjectType()
export class PaginatedChargesResponse {

  @Field(() => [FeeCharge])
  items: FeeCharge[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
