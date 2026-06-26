import { InputType, Field, Float } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsIn, IsObject, IsNumber, Min } from 'class-validator';
import GraphQLJSON from 'graphql-type-json';

@InputType()
export class UpsertCoefficientWeightingInput {

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  complexId: string;

  @Field(() => String, { description: "Base del score: 'AREA' | 'UNIT'", nullable: true })
  @IsOptional()
  @IsIn(['AREA', 'UNIT'])
  base?: string;

  @Field(() => GraphQLJSON, { description: 'Multiplicador por tipo de unidad', nullable: true })
  @IsOptional()
  @IsObject()
  typeMultipliers?: Record<string, number>;

  @Field(() => Float, { description: 'Puntos por alcoba', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  perBedroom?: number;

  @Field(() => Float, { description: 'Puntos por baño', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  perBathroom?: number;

  @Field(() => Float, { description: 'Puntos por parqueadero', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  perParking?: number;

  @Field(() => Float, { description: 'Puntos por depósito', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  perStorage?: number;

  @Field(() => Float, { description: 'Puntos por ascensor', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  elevatorPoints?: number;

  @Field(() => Float, { description: 'Puntos por piso de la casa', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(0)
  houseFloorPoints?: number;
}
