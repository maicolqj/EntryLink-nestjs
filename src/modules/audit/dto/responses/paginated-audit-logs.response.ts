import { ObjectType, Field, Int } from '@nestjs/graphql';
import { AuditLog } from '../../entities/audit-log.entity';

@ObjectType({ description: 'Lista paginada de registros de auditoría' })
export class PaginatedAuditLogsResponse {

  @Field(() => [AuditLog])
  items: AuditLog[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  offset: number;
}
