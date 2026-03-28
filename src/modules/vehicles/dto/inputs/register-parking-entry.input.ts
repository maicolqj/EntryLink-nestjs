import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsOptional, IsString, IsUUID, Matches, MaxLength } from 'class-validator';
import { VehicleType } from '../../enums/vehicle-type.enum';

@InputType({ description: 'Datos para registrar la entrada de un vehículo visitante al parqueadero' })
export class RegisterParkingEntryInput {

  @Field(() => String, { description: 'Placa del vehículo visitante' })
  @IsString()
  @IsNotEmpty()
  @Matches(/^[A-Z0-9]{2,10}$/i, { message: 'Formato de placa inválido' })
  plate: string;

  @Field(() => VehicleType, { description: 'Tipo de vehículo' })
  @IsEnum(VehicleType)
  vehicleType: VehicleType;

  @Field(() => String, { description: 'Marca del vehículo', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  brand?: string;

  @Field(() => String, { description: 'Color del vehículo', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string;

  @Field(() => String, { description: 'ID de la unidad que visita (opcional)', nullable: true })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  @IsNotEmpty()
  complexId: string;
}
