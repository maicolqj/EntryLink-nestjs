import {
  IsDateString,
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Type } from 'class-transformer';

import { PetIncidentType } from '../../enums/pet-incident-type.enum';
import { PetIncidentSeverity } from '../../enums/pet-incident-severity.enum';

/**
 * DTO para radicar un reporte vía REST (POST /api/v1/pets/incidents).
 *
 * La evidencia fotográfica llega como archivo en la misma petición: pedirle al
 * usuario que suba la foto en un segundo paso significa, en la práctica, que la
 * mitad de los reportes se quedan sin evidencia.
 */
export class ReportPetIncidentDto {
  @IsUUID()
  complexId: string;

  @IsEnum(PetIncidentType)
  type: PetIncidentType;

  @IsOptional()
  @IsEnum(PetIncidentSeverity)
  severity?: PetIncidentSeverity;

  @IsString()
  @MinLength(10)
  @MaxLength(2000)
  description: string;

  /** Si no llega, el servicio usa la hora del servidor. Nunca puede ser futura. */
  @IsOptional()
  @IsDateString()
  occurredAt?: string;

  @IsOptional()
  @IsString()
  @MaxLength(160)
  location?: string;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-90)
  @Max(90)
  lat?: number;

  @IsOptional()
  @Type(() => Number)
  @IsNumber()
  @Min(-180)
  @Max(180)
  lng?: number;

  /**
   * Quien reporta puede señalar la mascota si la reconoce. La administración
   * puede corregir la atribución después: el vecino se equivoca de perro con
   * facilidad, y de eso depende a quién se le cobra.
   */
  @IsOptional()
  @IsUUID()
  petId?: string;

  @IsOptional()
  @IsUUID()
  unitId?: string;
}
