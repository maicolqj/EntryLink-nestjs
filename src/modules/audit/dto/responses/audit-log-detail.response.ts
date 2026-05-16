import { ObjectType, Field } from '@nestjs/graphql';

import { AuditLog } from '../../entities/audit-log.entity';

@ObjectType({ description: 'Detalle enriquecido de un registro de auditoría con labels resueltos' })
export class AuditLogDetailResponse {

  @Field(() => AuditLog, { description: 'Registro de auditoría completo' })
  auditLog: AuditLog;

  @Field(() => String, { nullable: true, description: 'Etiqueta legible de la entidad afectada' })
  entityLabel?: string;

  @Field(() => String, { nullable: true, description: 'Nombre del usuario que revirtió la acción' })
  revertedByName?: string;
}
