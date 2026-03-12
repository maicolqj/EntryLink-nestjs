import { InputType, Field, Int, Float } from '@nestjs/graphql';
import {
  IsString, IsOptional, IsUUID, IsEnum,
  MaxLength, MinLength, IsInt, Min, Max, IsNumber,
} from 'class-validator';
import { UnitType } from '../../enums/unit-type.enum';

@InputType()
export class CreateUnitInput {

  @Field(() => String, { description: 'Número o código de la unidad. Ej: "101", "B-302"' })
  @IsString()
  @MinLength(1)
  @MaxLength(20)
  number: string;

  @Field(() => Int, { description: 'Piso donde se ubica la unidad', defaultValue: 1 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(200)
  floor?: number;

  @Field(() => UnitType, { description: 'Tipo de unidad', defaultValue: UnitType.APARTMENT })
  @IsOptional()
  @IsEnum(UnitType)
  type?: UnitType;

  @Field(() => Float, { description: 'Área en m²', nullable: true })
  @IsOptional()
  @IsNumber()
  @Min(1)
  area?: number;

  @Field(() => Int, { description: 'Número de habitaciones', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  bedrooms?: number;

  @Field(() => Int, { description: 'Número de baños', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(20)
  bathrooms?: number;

  @Field(() => Int, { description: 'Cupos de parqueadero', defaultValue: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(10)
  parkingSpots?: number;

  @Field(() => Int, { description: 'Cuartos de bodega', defaultValue: 0 })
  @IsOptional()
  @IsInt()
  @Min(0)
  @Max(5)
  storageRooms?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  description?: string;

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  complexId: string;

  @Field(() => String, { description: 'ID de la torre (opcional, para complejos con edificios)', nullable: true })
  @IsOptional()
  @IsUUID()
  buildingId?: string;
}
