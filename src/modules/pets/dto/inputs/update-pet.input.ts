import { InputType, Field } from '@nestjs/graphql';
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

import { PetSpecies } from '../../enums/pet-species.enum';
import { PetSex } from '../../enums/pet-sex.enum';
import { PetSize } from '../../enums/pet-size.enum';

/**
 * Actualización de la ficha. La unidad NO se puede cambiar por aquí: mover una
 * mascota de apartamento es un traslado con consecuencias (cupos, historial de
 * incidentes), no un campo editable.
 */
@InputType()
export class UpdatePetInput {
  @Field(() => String)
  @IsUUID()
  petId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(2)
  @MaxLength(80)
  name?: string;

  @Field(() => PetSpecies, { nullable: true })
  @IsOptional()
  @IsEnum(PetSpecies)
  species?: PetSpecies;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(80)
  breed?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  color?: string;

  @Field(() => String, {
    description: 'Señas particulares',
    nullable: true,
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  distinguishingMarks?: string;

  @Field(() => PetSex, { nullable: true })
  @IsOptional()
  @IsEnum(PetSex)
  sex?: PetSex;

  @Field(() => PetSize, { nullable: true })
  @IsOptional()
  @IsEnum(PetSize)
  size?: PetSize;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  birthDate?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  hasMicrochip?: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(50)
  microchipCode?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isSpecialBreed?: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(120)
  insuranceCompany?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(60)
  insurancePolicyNumber?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  insuranceExpiresAt?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  rabiesVaccineAt?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  sterilized?: boolean;

  /** Solo la administración: el residente no se escribe sus propias notas internas. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  notes?: string;
}
