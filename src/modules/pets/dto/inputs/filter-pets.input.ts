import { InputType, Field } from '@nestjs/graphql';
import {
  IsBoolean,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { PetSpecies } from '../../enums/pet-species.enum';
import { PetStatus } from '../../enums/pet-status.enum';

@InputType()
export class FilterPetsInput {
  @Field(() => String, {
    nullable: true,
    description: 'Busca por nombre, raza, color o microchip',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => PetStatus, { nullable: true })
  @IsOptional()
  @IsEnum(PetStatus)
  status?: PetStatus;

  @Field(() => PetSpecies, { nullable: true })
  @IsOptional()
  @IsEnum(PetSpecies)
  species?: PetSpecies;

  @Field(() => Boolean, {
    nullable: true,
    description: 'Solo razas de manejo especial',
  })
  @IsOptional()
  @IsBoolean()
  isSpecialBreed?: boolean;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  residentId?: string;
}
