import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID } from 'class-validator';
import { ResidentType }   from '../../enums/resident-type.enum';
import { ResidentStatus } from '../../enums/resident-status.enum';

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

  @Field(() => String, { nullable: true, description: 'Filtrar por edificio/torre' })
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @Field(() => String, { nullable: true, description: 'Filtrar por unidad específica' })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}
