import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { VisitorVehicle }    from '../../entities/visitor-vehicle.entity';

@ObjectType()
export class PaginatedVisitorVehiclesResponse {

  @Field(() => [VisitorVehicle])
  items: VisitorVehicle[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
