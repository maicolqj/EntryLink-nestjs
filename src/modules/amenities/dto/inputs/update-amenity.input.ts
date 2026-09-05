import { InputType, Field, PartialType, OmitType } from '@nestjs/graphql';
import { IsUUID } from 'class-validator';

import { CreateAmenityInput } from './create-amenity.input';

/**
 * El horario no se parchea aquí: se reemplaza con `setAmenitySchedules`, que es
 * una operación de conjunto y no admite semántica parcial.
 */
@InputType()
export class UpdateAmenityInput extends PartialType(
  OmitType(CreateAmenityInput, ['complexId', 'schedules'] as const),
) {
  @Field(() => String, { description: 'ID de la zona común a actualizar' })
  @IsUUID()
  id: string;
}
