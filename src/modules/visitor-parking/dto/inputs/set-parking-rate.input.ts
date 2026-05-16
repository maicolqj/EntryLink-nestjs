import { InputType, Field, Float } from '@nestjs/graphql';
import { IsUUID, Min, IsOptional, IsBoolean, MaxLength, IsEnum } from 'class-validator';

import { VehicleType } from '../../../vehicles/enums/vehicle-type.enum';
import { ParkingRateType } from '../../enums/parking-rate-type.enum';

@InputType({ description: 'Datos para configurar o actualizar la tarifa de parqueadero' })
export class SetParkingRateInput {

  @Field(() => String, { description: 'ID del complejo residencial' })
  @IsUUID()
  complexId: string;

  @Field(() => VehicleType, { description: 'Tipo de vehículo al que aplica la tarifa' })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @Field(() => ParkingRateType, { description: 'Tarifa cobrada por minuto de parqueo (en moneda local)' })
  @Min(0)
  rateType: ParkingRateType;

  @Field(() => Boolean, { description: 'Si la tarifa está activa', nullable: true, defaultValue: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;

  @Field(() => String, { description: 'Descripción o etiqueta de la tarifa', nullable: true })
  @IsOptional()
  @MaxLength(200)
  description?: string;

  
}
