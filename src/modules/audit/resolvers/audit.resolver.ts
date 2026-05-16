import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';
import { Logger } from '@nestjs/common';

import { AuditLog }                   from '../entities/audit-log.entity';
import { PaginatedAuditLogsResponse } from '../dto/responses/paginated-audit-logs.response';
import { RevertAuditResponse }        from '../dto/responses/revert-audit.response';
import { AuditLogDetailResponse }     from '../dto/responses/audit-log-detail.response';
import { FilterAuditLogsInput }       from '../dto/inputs/filter-audit-logs.input';
import { AuditService }               from '../services/audit.service';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../auth/interfaces/jwt-payload.interface';

@Resolver(() => AuditLog)
export class AuditResolver {
  private readonly logger = new Logger(AuditResolver.name);

  constructor(private readonly auditService: AuditService) {}

  // ── Consultas ────────────────────────────────────────────────────

  @Query(() => PaginatedAuditLogsResponse, {
    name: 'auditLogs',
    description:
      'Historial de auditoría paginado. ' +
      'SUPER_ADMIN ve todo el sistema. ' +
      'COMPLEX_ROL solo ve las acciones de ACCOUNTANT_ROL, SUPERVISOR_ROL y SECURITY_ROL de su complejo.',
  })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
    ],
  })
  auditLogs(
    @CurrentUser() payload: JwtAccessPayload,
    @Args('filter', { nullable: true }) filter?: FilterAuditLogsInput,
  ): Promise<PaginatedAuditLogsResponse> {
    const callerRole = payload.roles?.[0] ?? '';
    return this.auditService.findAll(
      filter ?? {},
      callerRole,
      payload.complexId,
    );
  }

  @Query(() => AuditLogDetailResponse, {
    name: 'auditLog',
    description: 'Obtiene un registro de auditoría por su número de referencia (AUD-YYYYMMDD-XXXX) con labels enriquecidos.',
  })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
  })
  auditLog(
    @Args('referenceNumber') referenceNumber: string,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<AuditLogDetailResponse> {
    const isSuperAdmin = payload.roles?.includes(ValidRoles.SUPER_ADMIN_ROL);
    return this.auditService.findByReference(referenceNumber, isSuperAdmin ? undefined : payload.complexId);
  }

  // ── Mutaciones ───────────────────────────────────────────────────

  @Mutation(() => RevertAuditResponse, {
    name: 'revertAudit',
    description:
      'Revierte una acción registrada en el historial a su estado anterior. ' +
      'Solo disponible para SUPER_ADMIN_ROL. ' +
      'Una acción solo puede revertirse una vez.',
  })
  @Auth({ roles: [ValidRoles.SUPER_ADMIN_ROL] })
  revertAudit(
    @Args('referenceNumber') referenceNumber: string,
    @CurrentUser() payload: JwtAccessPayload,
  ): Promise<RevertAuditResponse> {
    return this.auditService.revert(referenceNumber, payload.sub);
  }
}
