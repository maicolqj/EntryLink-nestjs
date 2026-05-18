import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

@ObjectType()
export class NearbyComplexResponse {

  @Field(() => String)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  address: string;

  @Field(() => String)
  city: string;

  @Field(() => Int, { description: 'Distancia en metros desde la posición del supervisor' })
  distanceMeters: number;

  @Field(() => Int, { nullable: true, description: 'Radio GPS configurado en el complejo (metros)' })
  gpsRadius?: number | null;
}
