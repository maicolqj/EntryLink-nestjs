import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { VehicleType }   from '../../enums/vehicle-type.enum';
import { VehicleStatus } from '../../enums/vehicle-status.enum';

@InputType()
export class FilterVehiclesInput {

  @Field(() => String, { nullable: true, description: 'Buscar por placa, marca, modelo o color' })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => VehicleStatus, { nullable: true })
  @IsOptional()
  @IsEnum(VehicleStatus)
  status?: VehicleStatus;

  @Field(() => VehicleType, { nullable: true })
  @IsOptional()
  @IsEnum(VehicleType)
  type?: VehicleType;

  @Field(() => String, { nullable: true, description: 'Filtrar por residente' })
  @IsOptional()
  @IsUUID()
  residentId?: string;

  @Field(() => String, { nullable: true, description: 'Filtrar por unidad' })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
