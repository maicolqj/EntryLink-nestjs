import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { readOptionalBoolean } from '../../utils/pets-module.util';
import { PetSpecies } from '../../enums/pet-species.enum';
import { PetSex } from '../../enums/pet-sex.enum';
import { PetSize } from '../../enums/pet-size.enum';

/**
 * En multipart todo llega como texto y "false" es una cadena no vacía: para
 * JavaScript, verdadera. Sin esto, una mascota registrada con
 * `isSpecialBreed=false` entraba al sistema como raza de manejo especial.
 *
 * Se lee del objeto ORIGINAL (`obj[key]`) y no del `value` que entrega
 * class-transformer. El ValidationPipe global corre con
 * `enableImplicitConversion: true`, así que para una propiedad declarada
 * `boolean` ya convirtió la cadena antes de llegar aquí —y esa conversión es un
 * `Boolean("false")`, es decir `true`—. Leyendo el crudo, la conversión
 * implícita deja de importar.
 */
const toOptionalBoolean = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown => readOptionalBoolean(obj?.[key]);

/**
 * DTO para registrar una mascota vía REST (POST /api/v1/pets).
 *
 * Va por REST y no por GraphQL porque la foto es obligatoria y llega como
 * archivo: la ficha sin foto no permite identificar a la mascota en un reporte,
 * que es la mitad de la razón por la que existe el censo.
 */
export class RegisterPetDto {
  @IsUUID()
  complexId: string;

  /**
   * Opcional para el residente: se deduce de su ficha. La administración sí
   * debe enviarla — registra mascotas de unidades que no son la suya.
   */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name: string;

  @IsEnum(PetSpecies)
  species: PetSpecies;

  @IsOptional()
  @IsString()
  @MaxLength(80)
  breed?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  color?: string;

  @IsOptional()
  @IsString()
  @MaxLength(500)
  distinguishingMarks?: string;

  @IsOptional()
  @IsEnum(PetSex)
  sex?: PetSex;

  @IsOptional()
  @IsEnum(PetSize)
  size?: PetSize;

  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  hasMicrochip?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(50)
  microchipCode?: string;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  isSpecialBreed?: boolean;

  @IsOptional()
  @IsString()
  @MaxLength(120)
  insuranceCompany?: string;

  @IsOptional()
  @IsString()
  @MaxLength(60)
  insurancePolicyNumber?: string;

  @IsOptional()
  @IsDateString()
  insuranceExpiresAt?: string;

  @IsOptional()
  @IsDateString()
  rabiesVaccineAt?: string;

  @IsOptional()
  @Transform(toOptionalBoolean)
  @IsBoolean()
  sterilized?: boolean;
}
