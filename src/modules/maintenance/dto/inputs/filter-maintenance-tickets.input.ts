import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsBoolean,
  IsDateString,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
} from 'class-validator';

import { MaintenanceCategory } from '../../enums/maintenance-category.enum';
import { MaintenancePriority } from '../../enums/maintenance-priority.enum';
import { MaintenanceTicketStatus } from '../../enums/maintenance-ticket-status.enum';
import { MaintenanceAssigneeType } from '../../enums/maintenance-assignee-type.enum';

@InputType()
export class FilterMaintenanceTicketsInput {
  @Field(() => String, {
    nullable: true,
    description: 'Busca por número del ticket, título o descripción',
  })
  @IsOptional()
  @IsString()
  search?: string;

  @Field(() => [MaintenanceTicketStatus], {
    nullable: true,
    description: 'Varios estados a la vez: el tablero pide columnas, no una',
  })
  @IsOptional()
  @IsEnum(MaintenanceTicketStatus, { each: true })
  statuses?: MaintenanceTicketStatus[];

  @Field(() => MaintenanceCategory, { nullable: true })
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;

  @Field(() => MaintenancePriority, { nullable: true })
  @IsOptional()
  @IsEnum(MaintenancePriority)
  priority?: MaintenancePriority;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  buildingId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  amenityId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  locationTagId?: string;

  @Field(() => MaintenanceAssigneeType, { nullable: true })
  @IsOptional()
  @IsEnum(MaintenanceAssigneeType)
  assigneeType?: MaintenanceAssigneeType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  /** Solo los que ya pasaron su plazo y siguen sin resolver. */
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  onlyOverdue?: boolean;

  /** Solo los que no tienen responsable. Es la bandeja de entrada real. */
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  onlyUnassigned?: boolean;

  /** Solo los que radicó quien consulta. */
  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  onlyMine?: boolean;

  @Field(() => Int, { nullable: true, description: 'Calificación exacta 1-5' })
  @IsOptional()
  @IsInt()
  rating?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  dateFrom?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsDateString()
  dateTo?: string;
}
