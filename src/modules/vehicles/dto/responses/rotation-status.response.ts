import { ObjectType, Field, Int } from '@nestjs/graphql';
import GraphQLJSON from 'graphql-type-json';

import { ParkingRotationConfig } from '../../entities/parking-rotation-config.entity';
import { Vehicle } from '../../entities/vehicle.entity';

@ObjectType({ description: 'Estado de la rotación para un tipo de vehículo' })
export class RotationTypeStatus {
  @Field(() => String, { description: 'Tipo de vehículo (ej: CAR, MOTORCYCLE)' })
  vehicleType: string;

  @Field(() => Int, { description: 'Cupos de parqueadero disponibles para este tipo' })
  availableSlots: number;

  @Field(() => Int, { description: 'Total de vehículos registrados activos y en rotación' })
  totalVehicles: number;

  @Field(() => Int, { description: 'Vehículos activos con acceso a parqueadero' })
  activeVehicles: number;

  @Field(() => Int, { description: 'Vehículos actualmente fuera por rotación' })
  suspendedByRotationCount: number;

  @Field(() => Int, {
    description: 'Exceso de vehículos (totalVehicles - availableSlots). 0 si no hay exceso.',
  })
  excessVehicles: number;

  @Field(() => Int, { description: 'Número del gran ciclo actual para este tipo' })
  grandCycleNumber: number;

  @Field(() => [Vehicle], { description: 'Vehículos actualmente fuera por rotación' })
  vehiclesSuspendedByRotation: Vehicle[];

  @Field(() => [Vehicle], {
    description:
      'Próximos candidatos a ser suspendidos en la siguiente rotación ' +
      '(ordenados por prioridad: menos rotaciones → más antiguo en rotación)',
  })
  nextRotationCandidates: Vehicle[];
}

@ObjectType({ description: 'Estado completo de la rotación de parqueaderos del complejo' })
export class RotationStatusResponse {
  @Field(() => ParkingRotationConfig, {
    description: 'Configuración activa de la rotación',
    nullable: true,
  })
  config?: ParkingRotationConfig;

  @Field(() => Boolean, {
    description: 'Si hay configuración de rotación definida para el complejo',
  })
  isConfigured: boolean;

  @Field(() => [RotationTypeStatus], {
    description: 'Estado de la rotación desglosado por tipo de vehículo',
  })
  byType: RotationTypeStatus[];
}
