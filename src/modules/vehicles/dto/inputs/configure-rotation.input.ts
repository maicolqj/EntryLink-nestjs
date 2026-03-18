import { InputType, Field, Int } from '@nestjs/graphql';
import { IsUUID, IsInt, IsEnum, IsOptional, IsBoolean, Min, ValidateNested, IsString } from 'class-validator';
import { Type } from 'class-transformer';
import GraphQLJSON from 'graphql-type-json';

import { RotationIntervalUnit } from '../../enums/rotation-interval-unit.enum';

@InputType({ description: 'Cupos de parqueadero disponibles para un tipo de vehículo' })
export class ParkingSlotByTypeInput {
  @Field(() => String, {
    description: 'Tipo de vehículo (ej: "CAR", "MOTORCYCLE", "TRUCK", "VAN")',
  })
  @IsString()
  vehicleType: string;

  @Field(() => Int, { description: 'Cantidad de cupos disponibles para ese tipo' })
  @IsInt()
  @Min(0)
  slots: number;
}

@InputType({ description: 'Datos para configurar la rotación de parqueaderos del complejo' })
export class ConfigureRotationInput {
  @Field(() => String, { description: 'ID del complejo residencial' })
  @IsUUID()
  complexId: string;

  @Field(() => Int, {
    description: 'Valor numérico del intervalo de rotación (ej: 3 para "cada 3 meses")',
  })
  @IsInt()
  @Min(1)
  rotationIntervalValue: number;

  @Field(() => RotationIntervalUnit, {
    description: 'Unidad de tiempo del intervalo (DAYS | WEEKS | MONTHS)',
  })
  @IsEnum(RotationIntervalUnit)
  rotationIntervalUnit: RotationIntervalUnit;

  @Field(() => [ParkingSlotByTypeInput], {
    description:
      'Lista de cupos disponibles por tipo de vehículo. ' +
      'Ej: [{ vehicleType: "CAR", slots: 20 }, { vehicleType: "MOTORCYCLE", slots: 13 }]. ' +
      'Solo los tipos listados participarán en la rotación.',
  })
  @ValidateNested({ each: true })
  @Type(() => ParkingSlotByTypeInput)
  slotsByType: ParkingSlotByTypeInput[];

  @Field(() => Boolean, {
    description: 'Activar o desactivar la rotación. Por defecto: true',
    nullable: true,
  })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
