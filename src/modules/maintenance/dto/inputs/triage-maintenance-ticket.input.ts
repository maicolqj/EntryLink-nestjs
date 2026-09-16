import { InputType, Field, Int } from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Max,
  MaxLength,
  Min,
} from 'class-validator';

import { MaintenanceCategory } from '../../enums/maintenance-category.enum';
import { MaintenancePriority } from '../../enums/maintenance-priority.enum';
import { MaintenanceVisibility } from '../../enums/maintenance-visibility.enum';

/**
 * Revisión inicial de la administración: corrige lo que el residente clasificó
 * mal y fija el plazo. Es el momento en que el ticket deja de ser una queja y
 * pasa a ser un compromiso con fecha.
 */
@InputType()
export class TriageMaintenanceTicketInput {
  @Field(() => String)
  @IsUUID()
  ticketId: string;

  @Field(() => MaintenanceCategory, { nullable: true })
  @IsOptional()
  @IsEnum(MaintenanceCategory)
  category?: MaintenanceCategory;

  @Field(() => MaintenancePriority, { nullable: true })
  @IsOptional()
  @IsEnum(MaintenancePriority)
  priority?: MaintenancePriority;

  @Field(() => MaintenanceVisibility, { nullable: true })
  @IsOptional()
  @IsEnum(MaintenanceVisibility)
  visibility?: MaintenanceVisibility;

  /**
   * Plazo a la medida cuando la política general no aplica: el proveedor de
   * ascensores solo viene el martes y prometer 24 horas sería mentir.
   */
  @Field(() => Int, {
    nullable: true,
    description:
      'Horas de SLA para este ticket. Si no llega, la política del complejo',
  })
  @IsOptional()
  @IsInt()
  @Min(1)
  @Max(8760)
  slaHours?: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
