import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsEnum, IsInt, IsOptional, IsString,
  IsUUID, Matches, Max, MaxLength, Min,
} from 'class-validator';
import { VehicleType }     from '../../enums/vehicle-type.enum';
import { VehicleFuelType } from '../../enums/vehicle-fuel-type.enum';

@InputType()
export class RegisterVehicleInput {

  @Field(() => String, { description: 'Placa del vehículo. Ej: ABC123, ABC12D' })
  @IsString()
  @Matches(/^[A-Za-z0-9]{3,10}$/, {
    message: 'La placa debe tener entre 3 y 10 caracteres alfanuméricos sin espacios ni guiones',
  })
  plate: string;

  @Field(() => VehicleType, { description: 'Tipo de vehículo', defaultValue: VehicleType.CAR })
  @IsOptional()
  @IsEnum(VehicleType)
  type?: VehicleType;

  @Field(() => String, { description: 'Marca. Ej: Toyota, Renault', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  brand?: string;

  @Field(() => String, { description: 'Modelo. Ej: Corolla, Logan', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  model?: string;

  @Field(() => Int, { description: 'Año del modelo', nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1900)
  @Max(2100)
  year?: number;

  @Field(() => String, { description: 'Color del vehículo', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  color?: string;

  @Field(() => VehicleFuelType, { nullable: true })
  @IsOptional()
  @IsEnum(VehicleFuelType)
  fuelType?: VehicleFuelType;

  @Field(() => String, { description: 'URL de la foto del vehículo', nullable: true })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @Field(() => String, { description: 'Número de parqueadero asignado (opcional)', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  parkingSpot?: string;

  @Field(() => String, { description: 'Notas adicionales', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;

  // ---- Relaciones ----

  @Field(() => String, { description: 'ID de la unidad a la que pertenece el vehículo' })
  @IsUUID()
  unitId: string;

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  complexId: string;
}
