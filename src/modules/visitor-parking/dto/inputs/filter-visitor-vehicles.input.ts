import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsOptional } from 'class-validator';

import { VehicleType }   from '../../../vehicles/enums/vehicle-type.enum';
import { ParkingRecordStatus } from '../../enums/parking-status.enum';

@InputType({ description: 'Filtros para listar vehículos visitantes' })
export class FilterVisitorVehiclesInput {

  @Field(() => String, { description: 'ID del complejo residencial' })
  @IsUUID()
  complexId: string;

  @Field(() => ParkingRecordStatus, { description: 'Filtrar por estado del registro', nullable: true })
  @IsOptional()
  status?: ParkingRecordStatus;

  @Field(() => VehicleType, { description: 'Filtrar por tipo de vehículo', nullable: true })
  @IsOptional()
  vehicleType?: VehicleType;

  @Field(() => String, { description: 'Buscar por placa (parcial o completa)', nullable: true })
  @IsOptional()
  plate?: string;

  @Field(() => String, { description: 'Filtrar por residente anfitrión', nullable: true })
  @IsOptional()
  @IsUUID()
  hostResidentId?: string;

  @Field(() => Date, { description: 'Registros con ingreso desde esta fecha', nullable: true })
  @IsOptional()
  dateFrom?: Date;

  @Field(() => Date, { description: 'Registros con ingreso hasta esta fecha', nullable: true })
  @IsOptional()
  dateTo?: Date;
}
