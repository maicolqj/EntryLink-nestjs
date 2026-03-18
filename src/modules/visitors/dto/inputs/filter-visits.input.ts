import { InputType, Field } from '@nestjs/graphql';
import { IsDateString, IsEnum, IsOptional, IsUUID } from 'class-validator';
import { VisitType }   from '../../enums/visit-type.enum';
import { VisitStatus } from '../../enums/visit-status.enum';

@InputType()
export class FilterVisitsInput {

  @Field(() => VisitStatus, { nullable: true })
  @IsOptional()
  @IsEnum(VisitStatus)
  status?: VisitStatus;

  @Field(() => VisitType, { nullable: true })
  @IsOptional()
  @IsEnum(VisitType)
  type?: VisitType;

  @Field(() => String, { nullable: true, description: 'Filtrar por unidad' })
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @Field(() => String, { nullable: true, description: 'Filtrar por residente anfitrión' })
  @IsOptional()
  @IsUUID()
  hostResidentId?: string;

  @Field(() => String, { nullable: true, description: 'Desde esta fecha (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @Field(() => String, { nullable: true, description: 'Hasta esta fecha (ISO 8601)' })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
