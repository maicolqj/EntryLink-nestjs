import { InputType, Field } from '@nestjs/graphql';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { MaintenanceTicketStatus } from '../../enums/maintenance-ticket-status.enum';

/**
 * Movimiento manual del ticket en el tablero (arrastrar la tarjeta).
 *
 * No sirve para resolver, cerrar, rechazar ni reabrir: cada uno de esos exige
 * algo más —evidencia, motivo, quién confirma— y dejarlos entrar por aquí sería
 * la puerta de atrás que se salta todo eso.
 */
@InputType()
export class ChangeMaintenanceStatusInput {
  @Field(() => String)
  @IsUUID()
  ticketId: string;

  @Field(() => MaintenanceTicketStatus)
  @IsEnum(MaintenanceTicketStatus)
  status: MaintenanceTicketStatus;

  /** Obligatorio al pasar a ON_HOLD: un ticket detenido sin razón no se retoma. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  message?: string;
}
