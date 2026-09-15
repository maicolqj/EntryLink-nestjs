import { InputType, Field } from '@nestjs/graphql';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { PetIncidentSeverity } from '../../enums/pet-incident-severity.enum';

/**
 * La administración le da curso al reporte: lo atribuye a una mascota o al
 * menos a una unidad, y con eso arranca el plazo de descargos.
 *
 * Atribuir es obligatorio aquí: sin unidad no hay a quién notificarle ni a
 * quién sancionar, y un reporte que avanza sin destinatario solo sirve para
 * inflar estadísticas.
 */
@InputType()
export class ValidatePetIncidentInput {
  @Field(() => String)
  @IsUUID()
  incidentId: string;

  @Field(() => String, {
    description: 'Mascota a la que se le atribuye el hecho',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  petId?: string;

  @Field(() => String, {
    description: 'Unidad responsable. Se deduce de la mascota si se envía',
    nullable: true,
  })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @Field(() => PetIncidentSeverity, {
    description: 'Permite corregir la gravedad que puso quien reportó',
    nullable: true,
  })
  @IsOptional()
  @IsEnum(PetIncidentSeverity)
  severity?: PetIncidentSeverity;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
