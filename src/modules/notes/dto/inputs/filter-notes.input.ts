import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, IsUUID, IsDateString, IsString, IsArray } from 'class-validator';

@InputType()
export class FilterNotesInput {

  @Field(() => String, { nullable: true, description: 'Filtrar por usuario creador (solo SUPER_ADMIN y COMPLEX_ROL)' })
  @IsOptional()
  @IsUUID()
  createdByUserId?: string;

  @Field(() => [String], { nullable: true, description: 'Filtrar por uno o varios roles creadores. Cada rol solo puede filtrar dentro de los roles que tiene visibilidad' })
  @IsOptional()
  @IsArray()
  @IsString({ each: true })
  createdByRoles?: string[];

  @Field(() => String, { nullable: true, description: 'Fecha de inicio del rango (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @Field(() => String, { nullable: true, description: 'Fecha de fin del rango (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
