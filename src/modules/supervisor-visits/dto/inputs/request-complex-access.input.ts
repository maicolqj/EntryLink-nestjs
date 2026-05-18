import { InputType, Field, Float } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString, MaxLength, IsNumber, Min, Max } from 'class-validator';

@InputType()
export class RequestComplexAccessInput {

  @Field(() => String, { description: 'ID del complejo al que el supervisor solicita acceso' })
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

  @Field(() => String, { nullable: true, description: 'Mensaje opcional para el administrador del complejo' })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
