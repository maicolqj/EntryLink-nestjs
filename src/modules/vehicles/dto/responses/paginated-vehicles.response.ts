import { ObjectType, Field } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { Vehicle } from '../../entities/vehicle.entity';

@ObjectType()
export class PaginatedVehiclesResponse {

  @Field(() => [Vehicle])
  items: Vehicle[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}
