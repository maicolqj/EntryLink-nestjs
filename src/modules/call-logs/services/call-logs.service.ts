import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { IsNull, In, Repository } from 'typeorm';

import { CallLog }          from '../entities/call-log.entity';
import { CallOutcome }      from '../enums/call-outcome.enum';
import { CallDirection }    from '../enums/call-direction.enum';
import { LogCallInput }     from '../dto/inputs/log-call.input';
import { CallLogsInput }    from '../dto/inputs/call-logs.input';
import { CallLogsPage }     from '../dto/responses/call-logs-page.response';

import { User }                      from '../../users/entities/user.entity';
import { Resident }                  from '../../residents/entities/resident.entity';
import { ResidentStatus }            from '../../residents/enums/resident-status.enum';
import { JwtAccessPayload }          from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }                from '../../roles/enums/valid-roles';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { AuditService }              from '../../audit/services/audit.service';
import { AuditAction }               from '../../audit/enums/audit-action.enum';
import { AuditEntityType }           from '../../audit/enums/audit-entity-type.enum';

@Injectable()
export class CallLogsService {
  private readonly logger = new Logger(CallLogsService.name);

  constructor(
    @InjectRepository(CallLog)
    private readonly callLogRepo: Repository<CallLog>,
    @InjectRepository(User)
    private readonly userRepo: Repository<User>,
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,
    private readonly complexService: ResidentialComplexService,
    private readonly auditService:   AuditService,
  ) {}

  // ================================================================
  // REGISTRAR LLAMADA
  // agentUserId + agentName se extraen del JWT / User entity
  // ================================================================

  async logCall(input: LogCallInput, currentUser: JwtAccessPayload): Promise<CallLog> {
    if (!this.isSuperAdmin(currentUser)) {
      await this.complexService.assertComplexAccess(input.complexId, currentUser);
    }

    // Resolver el nombre del agente desde la BD
    const agentUser = await this.userRepo.findOne({ where: { id: currentUser.sub }, select: ['id', 'name', 'lastName'] });
    const agentName = agentUser
      ? `${agentUser.name} ${agentUser.lastName}`.trim()
      : currentUser.email;

    // Auto-resolver datos del residente por número de teléfono dentro del complejo
    const residentData = await this.resolveResidentData(input.phoneNumber, input.complexId);

    const log = this.callLogRepo.create({
      complexId:       input.complexId,
      agentUserId:     currentUser.sub,
      agentName,
      direction:       input.direction,
      outcome:         input.outcome,
      phoneNumber:     input.phoneNumber,
      residentId:   residentData?.residentId   ?? input.residentId   ?? null,
      residentName: residentData?.residentName ?? input.residentName ?? null,
      unitId:       residentData?.unitId       ?? input.unitId       ?? null,
      unitNumber:   residentData?.unitNumber   ?? input.unitNumber   ?? null,
      buildingName: residentData?.buildingName ?? input.buildingName ?? null,
      startedAt:       new Date(input.startedAt),
      answeredAt:      input.answeredAt ? new Date(input.answeredAt) : null,
      endedAt:         input.endedAt    ? new Date(input.endedAt)   : null,
      durationSeconds: input.durationSeconds,
      notes:           input.notes ?? null,
    });

    const saved = await this.callLogRepo.save(log);
    this.logger.log(
      `CallLog: ${saved.direction} | ${saved.outcome} | ${saved.phoneNumber} | agente: ${agentName} | complejo: ${input.complexId}`,
    );

    void this.auditService.log({
      entityType:      AuditEntityType.CallLog,
      entityId:        saved.id,
      action:          this.resolveAuditAction(saved.direction, saved.outcome),
      newValue:        { id: saved.id, direction: saved.direction, outcome: saved.outcome, phoneNumber: saved.phoneNumber, durationSeconds: saved.durationSeconds },
      performedById:   currentUser.sub,
      performedByName: agentName,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId:       input.complexId,
      description:     `Llamada ${saved.direction} ${saved.outcome} | ${saved.phoneNumber}${saved.residentName ? ` (${saved.residentName})` : ''} | ${saved.durationSeconds}s`,
    });

    return saved;
  }

  // ================================================================
  // LISTAR LLAMADAS DEL COMPLEJO (paginado + filtros)
  // ================================================================

  async getCallLogs(input: CallLogsInput, currentUser: JwtAccessPayload): Promise<CallLogsPage> {
    if (!this.isSuperAdmin(currentUser)) {
      await this.complexService.assertComplexAccess(input.complexId, currentUser);
    }

    const { page = 1, limit = 20 } = input.pagination ?? {};
    const skip = (page - 1) * limit;

    const qb = this.callLogRepo
      .createQueryBuilder('cl')
      .leftJoinAndSelect('cl.agent', 'agent')
      .where('cl.complexId = :complexId', { complexId: input.complexId });

    // SECURITY_ROL solo ve sus propias llamadas, no las de otros guardias
    if (this.isSecurityGuard(currentUser) && !this.isSuperAdmin(currentUser)) {
      qb.andWhere('cl.agentUserId = :agentId', { agentId: currentUser.sub });
    } else if (input.agentUserId) {
      qb.andWhere('cl.agentUserId = :agentId', { agentId: input.agentUserId });
    }

    if (input.direction) {
      qb.andWhere('cl.direction = :direction', { direction: input.direction });
    }
    if (input.outcome) {
      qb.andWhere('cl.outcome = :outcome', { outcome: input.outcome });
    }
    if (input.dateFrom) {
      qb.andWhere('cl.startedAt >= :dateFrom', { dateFrom: new Date(input.dateFrom) });
    }
    if (input.dateTo) {
      qb.andWhere('cl.startedAt <= :dateTo', { dateTo: new Date(input.dateTo) });
    }

    qb.orderBy('cl.startedAt', 'DESC').skip(skip).take(limit);

    const [items, totalItems] = await qb.getManyAndCount();
    const totalPages = Math.ceil(totalItems / limit);

    return { items, totalItems, totalPages, currentPage: page };
  }

  // ================================================================
  // HELPERS PRIVADOS
  // ================================================================

  private async resolveResidentData(phoneNumber: string, complexId: string) {
    const normalizedPhone = phoneNumber.replace(/\s+/g, '');

    const user = await this.userRepo.findOne({
      where: { phoneNumber: normalizedPhone, deletedAt: IsNull() },
      select: ['id', 'name', 'lastName'],
    });
    if (!user) return null;

    const resident = await this.residentRepo.findOne({
      where: {
        userId:    user.id,
        complexId,
        status:    In([ResidentStatus.ACTIVE, ResidentStatus.SUSPENDED]),
        deletedAt: IsNull(),
      },
      relations: ['unit', 'unit.building'],
    });
    if (!resident) return null;

    return {
      residentId:   resident.id,
      residentName: `${user.name} ${user.lastName}`.trim(),
      unitId:       resident.unitId,
      unitNumber:   resident.unit?.number ?? null,
      buildingName: resident.unit?.building?.name ?? null,
    };
  }

  private isSuperAdmin(user: JwtAccessPayload): boolean {
    return user.roles?.includes(ValidRoles.SUPER_ADMIN_ROL) ?? false;
  }

  private isSecurityGuard(user: JwtAccessPayload): boolean {
    return user.roles?.includes(ValidRoles.SECURITY_ROL) ?? false;
  }

  private resolveAuditAction(direction: CallDirection, outcome: CallOutcome): AuditAction {
    if (outcome === CallOutcome.MISSED)   return AuditAction.CALL_MISSED;
    if (outcome === CallOutcome.REJECTED) return AuditAction.CALL_REJECTED;
    if (direction === CallDirection.INCOMING) return AuditAction.CALL_INCOMING;
    return AuditAction.CALL_OUTGOING;
  }
}
