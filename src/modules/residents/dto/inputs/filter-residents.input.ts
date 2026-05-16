import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ResidentType }   from '../../enums/resident-type.enum';
import { ResidentStatus } from '../../enums/resident-status.enum';
import { UnitType }       from '../../../residential-complex/enums/unit-type.enum';

@InputType()
export class FilterResidentsInput {

  @Field(() => String, { nullable: true, description: 'Buscar por nombre, apellido o email del usuario' })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => ResidentStatus, { nullable: true })
  @IsOptional()
  @IsEnum(ResidentStatus)
  status?: ResidentStatus;

  @Field(() => ResidentType, { nullable: true })
  @IsOptional()
  @IsEnum(ResidentType)
  type?: ResidentType;

  @Field(() => String, { nullable: true, description: 'Filtrar por edificio/torre (UUID)' })
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @Field(() => String, { nullable: true, description: 'Filtrar por unidad específica (UUID)' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @Field(() => UnitType, { nullable: true, description: 'Tipo de unidad: HOUSE, APARTMENT, OFFICE...' })
  @IsOptional()
  @IsEnum(UnitType)
  unitType?: UnitType;

  @Field(() => String, { nullable: true, description: 'Número/identificador de la unidad (ej: "39", "601")' })
  @IsOptional()
  @IsString()
  unitNumber?: string;

  @Field(() => String, { nullable: true, description: 'Nombre de torre/edificio (ej: "5", "TORRE A"). Búsqueda exacta.' })
  @IsOptional()
  @IsString()
  buildingName?: string;
}
