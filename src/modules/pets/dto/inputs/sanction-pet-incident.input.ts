import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';

import { PetSanction } from '../../enums/pet-sanction.enum';

@InputType()
export class SanctionPetIncidentInput {
  @Field(() => String)
  @IsUUID()
  incidentId: string;

  @Field(() => PetSanction, { description: 'Llamado de atención o multa' })
  @IsEnum(PetSanction)
  sanction: PetSanction;

  /** Obligatorio cuando la sanción es FINE; el servicio lo exige. */
  @Field(() => Float, {
    description: 'Valor de la multa. Requerido si sanction = FINE',
    nullable: true,
  })
  @IsOptional()
  @IsNumber({ maxDecimalPlaces: 2 })
  @Min(1)
  fineAmount?: number;

  /**
   * La decisión SIEMPRE se motiva. Una multa que aparece en el estado de cuenta
   * sin explicación es un reclamo asegurado, y sin motivación tampoco se
   * sostiene si la unidad la discute.
   */
  @Field(() => String, { description: 'Motivación de la decisión' })
  @IsString()
  @MinLength(10)
  @MaxLength(1000)
  resolutionNotes: string;
}
