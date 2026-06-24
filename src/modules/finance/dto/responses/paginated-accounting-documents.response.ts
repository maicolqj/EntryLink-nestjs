import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { AccountingHeader } from '../../entities/accounting-header.entity';

@ObjectType()
export class PaginatedAccountingDocumentsResponse {

  @Field(() => [AccountingHeader])
  items: AccountingHeader[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
