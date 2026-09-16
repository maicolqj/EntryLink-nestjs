import { ObjectType, Field, Int } from '@nestjs/graphql';

import { MaintenanceTicket } from '../../entities/maintenance-ticket.entity';
import { MaintenanceTicketStatus } from '../../enums/maintenance-ticket-status.enum';

/**
 * Una columna del Kanban.
 *
 * `total` viene aparte de `tickets` porque la columna se pinta con una tapa: un
 * complejo con cuatrocientos tickets cerrados no puede mandarlos todos para que
 * el tablero abra. El contador dice cuántos hay; las tarjetas, las primeras.
 */
@ObjectType()
export class MaintenanceBoardColumn {
  @Field(() => MaintenanceTicketStatus)
  status: MaintenanceTicketStatus;

  @Field(() => Int)
  total: number;

  @Field(() => [MaintenanceTicket])
  tickets: MaintenanceTicket[];
}

@ObjectType()
export class MaintenanceBoardResponse {
  @Field(() => [MaintenanceBoardColumn])
  columns: MaintenanceBoardColumn[];

  @Field(() => Int, { description: 'Tickets abiertos con el SLA vencido' })
  overdueCount: number;
}
