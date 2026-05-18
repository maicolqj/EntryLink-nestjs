import { InputType, Field, PartialType, OmitType } from '@nestjs/graphql';
import { IsString, IsUUID, IsOptional, MaxLength } from 'class-validator';
import { RegisterVehicleInput } from './register-vehicle.input';

@InputType()
export class UpdateVehicleInput extends PartialType(
  OmitType(RegisterVehicleInput, ['unitId', 'complexId', 'plate'] as const),
) {
  @Field(() => String, { description: 'ID del vehículo a actualizar' })
  @IsUUID()
  id: string;
}
  