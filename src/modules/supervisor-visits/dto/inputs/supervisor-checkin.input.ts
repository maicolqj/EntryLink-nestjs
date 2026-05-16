import { InputType, Field, Float } from '@nestjs/graphql';
import { IsUUID, IsNumber, Min, Max } from 'class-validator';

@InputType()
export class SupervisorCheckInInput {

  @Field(() => String, { description: 'ID del complejo residencial donde el supervisor hace check-in' })
  @IsUUID()
  complexId: string;

  @Field(() => Float, { description: 'Latitud GPS actual del supervisor (-90 a 90)' })
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat: number;

  @Field(() => Float, { description: 'Longitud GPS actual del supervisor (-180 a 180)' })
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng: number;
}
