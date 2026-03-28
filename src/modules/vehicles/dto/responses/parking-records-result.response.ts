import { ObjectType, Field, Int } from '@nestjs/graphql';
import { ParkingRecord } from '../../entities/parking-record.entity';

@ObjectType({ description: 'Lista paginada de registros de parqueadero' })
export class ParkingRecordsResult {

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  offset: number;

  @Field(() => [ParkingRecord])
  items: ParkingRecord[];
}
