import { ObjectType, Field } from '@nestjs/graphql';
import { AuditLog } from '../../entities/audit-log.entity';

@ObjectType({ description: 'Resultado de la reversión de una acción de auditoría' })
export class RevertAuditResponse {

  @Field(() => Boolean)
  success: boolean;

  @Field(() => String)
  message: string;

  @Field(() => AuditLog, { description: 'El registro de auditoría que fue revertido' })
  auditLog: AuditLog;
}
