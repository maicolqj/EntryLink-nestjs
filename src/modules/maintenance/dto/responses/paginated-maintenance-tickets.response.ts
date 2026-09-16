import { ObjectType, Field } from '@nestjs/graphql';

import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { MaintenanceTicket } from '../../entities/maintenance-ticket.entity';

@ObjectType()
export class PaginatedMaintenanceTicketsResponse {
  @Field(() => [MaintenanceTicket])
  items: MaintenanceTicket[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
