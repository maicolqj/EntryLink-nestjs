import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { SecurityAppExit } from '../../entities/security-app-exit.entity';

@ObjectType()
export class PaginatedSecurityAppExitsResponse {
  @Field(() => [SecurityAppExit])
  items: SecurityAppExit[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
