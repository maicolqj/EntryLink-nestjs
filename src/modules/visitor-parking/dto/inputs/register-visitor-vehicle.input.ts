import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsOptional, MaxLength, isEnum, IsEnum } from 'class-validator';

import { VehicleType } from '../../../vehicles/enums/vehicle-type.enum';

@InputType({ description: 'Datos para registrar el ingreso de un vehículo visitante' })
export class RegisterVisitorVehicleInput {

  

  @Field(() => String, { description: 'ID del complejo residencial' })
  @IsUUID()
  complexId: string;

  @Field(() => String, { description: 'Placa del vehículo visitante' })
  @MaxLength(20)
  plate: string;

  @Field(() => VehicleType, { description: 'Tipo de vehículo (carro, moto, etc.)' })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @Field(() => String, { description: 'ID del residente anfitrión que recibe la visita' })
  @IsUUID()
  hostResidentId: string;

  @Field(() => String, { description: 'Nombre del conductor (opcional)', nullable: true })
  @IsOptional()
  @MaxLength(200)
  driverName?: string;

  @Field(() => String, { description: 'Notas adicionales', nullable: true })
  @IsOptional()
  notes?: string;
}
 