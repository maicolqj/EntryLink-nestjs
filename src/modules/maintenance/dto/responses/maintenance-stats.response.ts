import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

import { MaintenanceCategory } from '../../enums/maintenance-category.enum';
import { MaintenanceTicketStatus } from '../../enums/maintenance-ticket-status.enum';

@ObjectType()
export class MaintenanceStatusCount {
  @Field(() => MaintenanceTicketStatus)
  status: MaintenanceTicketStatus;

  @Field(() => Int)
  count: number;
}

@ObjectType()
export class MaintenanceCategoryCount {
  @Field(() => MaintenanceCategory)
  category: MaintenanceCategory;

  @Field(() => Int)
  count: number;
}

/**
 * El informe que el administrador lleva al consejo.
 *
 * `slaComplianceRate` se calcula solo sobre los tickets ya resueltos: incluir
 * los que siguen abiertos y todavía dentro del plazo inflaría el cumplimiento
 * con trabajo que aún no se ha hecho.
 */
@ObjectType({ description: 'Resumen de mantenimiento del complejo' })
export class MaintenanceStatsResponse {
  @Field(() => Int)
  totalTickets: number;

  @Field(() => Int)
  openTickets: number;

  @Field(() => Int)
  overdueTickets: number;

  @Field(() => [MaintenanceStatusCount])
  byStatus: MaintenanceStatusCount[];

  @Field(() => [MaintenanceCategoryCount])
  byCategory: MaintenanceCategoryCount[];

  @Field(() => Float, {
    nullable: true,
    description: 'Horas promedio entre radicar y resolver',
  })
  averageResolutionHours?: number | null;

  @Field(() => Float, {
    nullable: true,
    description: 'Porcentaje de resueltos dentro del plazo',
  })
  slaComplianceRate?: number | null;

  @Field(() => Float, { nullable: true, description: 'Calificación promedio' })
  averageRating?: number | null;

  @Field(() => Int)
  ratedTickets: number;

  @Field(() => Float, {
    nullable: true,
    description: 'Costo acumulado de las reparaciones cerradas',
  })
  totalCost?: number | null;
}
