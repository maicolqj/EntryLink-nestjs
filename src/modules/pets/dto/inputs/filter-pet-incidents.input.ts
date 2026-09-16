import { InputType, Field } from '@nestjs/graphql';
import {
  IsDateString,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { PetIncidentType } from '../../enums/pet-incident-type.enum';
import { PetIncidentStatus } from '../../enums/pet-incident-status.enum';
import { PetIncidentSeverity } from '../../enums/pet-incident-severity.enum';

@InputType()
export class FilterPetIncidentsInput {
  @Field(() => String, {
    nullable: true,
    description: 'Busca por número del reporte o por el relato',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => PetIncidentStatus, { nullable: true })
  @IsOptional()
  @IsEnum(PetIncidentStatus)
  status?: PetIncidentStatus;

  @Field(() => PetIncidentType, { nullable: true })
  @IsOptional()
  @IsEnum(PetIncidentType)
  type?: PetIncidentType;

  @Field(() => PetIncidentSeverity, { nullable: true })
  @IsOptional()
  @IsEnum(PetIncidentSeverity)
  severity?: PetIncidentSeverity;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  petId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @Field(() => String, {
    nullable: true,
    description: 'Solo los reportes sin mascota identificada',
  })
  @IsOptional()
  @IsString()
  onlyUnidentified?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
