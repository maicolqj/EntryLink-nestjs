import { InputType, Field } from '@nestjs/graphql';
import {
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { MaintenanceAssigneeType } from '../../enums/maintenance-assignee-type.enum';

/**
 * Asignación del responsable. `assignedUserId` y `vendorId` son excluyentes: el
 * servicio rechaza que lleguen los dos o ninguno. Un ticket con dos dueños no
 * tiene dueño.
 */
@InputType()
export class AssignMaintenanceTicketInput {
  @Field(() => String)
  @IsUUID()
  ticketId: string;

  @Field(() => MaintenanceAssigneeType)
  @IsEnum(MaintenanceAssigneeType)
  assigneeType: MaintenanceAssigneeType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  assignedUserId?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  vendorId?: string;

  /**
   * Cuándo se comprometió el técnico a ir. Es lo único de todo el trámite que
   * el residente realmente quiere saber: "el jueves a las 3" vale más que
   * cualquier cambio de estado.
   */
  @Field(() => Date, { nullable: true })
  @IsOptional()
  @IsDate()
  scheduledFor?: Date;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(1000)
  notes?: string;
}
