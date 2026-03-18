import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsString, IsUUID, MaxLength } from 'class-validator';

@InputType()
export class ApproveVehicleInput {

  @Field(() => String, { description: 'ID del vehículo a aprobar' })
  @IsUUID()
  vehicleId: string;

  @Field(() => String, { description: 'Parqueadero asignado (opcional en la aprobación)', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  parkingSpot?: string;

  @Field(() => String, { description: 'Notas del administrador', nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
