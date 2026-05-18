import { InputType, Field, Int } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID, Max, Min } from 'class-validator';

import { AuditAction }     from '../../enums/audit-action.enum';
import { AuditEntityType } from '../../enums/audit-entity-type.enum';

@InputType({ description: 'Filtros para consultar el historial de auditoría' })
export class FilterAuditLogsInput {

  @Field(() => String, { nullable: true, description: 'Filtrar por ID del complejo' })
  @IsOptional()
  @IsUUID()
  complexId?: string;

  @Field(() => AuditAction, { nullable: true, description: 'Filtrar por tipo de acción' })
  @IsOptional()
  @IsEnum(AuditAction)
  action?: AuditAction;

  @Field(() => AuditEntityType, { nullable: true, description: 'Filtrar por tipo de entidad' })
  @IsOptional()
  @IsEnum(AuditEntityType)
  entityType?: AuditEntityType;

  @Field(() => String, { nullable: true, description: 'Filtrar por ID de la entidad' })
  @IsOptional()
  @IsString()
  entityId?: string;

  @Field(() => String, { nullable: true, description: 'Filtrar por ID del actor' })
  @IsOptional()
  @IsString()
  performedById?: string;

  @Field(() => String, { nullable: true, description: 'Filtrar por rol del actor' })
  @IsOptional()
  @IsString()
  performedByRole?: string;

  @Field(() => String, { nullable: true, description: 'Número de referencia exacto' })
  @IsOptional()
  @IsString()
  referenceNumber?: string;

  @Field(() => String, { nullable: true, description: 'Desde esta fecha (ISO 8601)' })
  @IsOptional()
  @IsString()
  from?: string;

  @Field(() => String, { nullable: true, description: 'Hasta esta fecha (ISO 8601)' })
  @IsOptional()
  @IsString()
  to?: string;

  @Field(() => Int, { nullable: true, defaultValue: 20 })
  @IsOptional()
  @Min(1)
  @Max(100)
  limit?: number;

  @Field(() => Int, { nullable: true, defaultValue: 0 })
  @IsOptional()
  @Min(0)
  offset?: number;
}
