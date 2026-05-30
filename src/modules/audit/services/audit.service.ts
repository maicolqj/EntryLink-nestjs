import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, Repository } from 'typeorm';

import { AuditLog }                   from '../entities/audit-log.entity';
import { AuditAction }                from '../enums/audit-action.enum';
import { AuditEntityType }            from '../enums/audit-entity-type.enum';
import { FilterAuditLogsInput }       from '../dto/inputs/filter-audit-logs.input';
import { PaginatedAuditLogsResponse } from '../dto/responses/paginated-audit-logs.response';
import { RevertAuditResponse }        from '../dto/responses/revert-audit.response';
import { AuditLogDetailResponse }     from '../dto/responses/audit-log-detail.response';

import { ValidRoles }        from '../../roles/enums/valid-roles';
import { CustomError }       from '../../shared/utils/errors.utils';
import { GeneralErrorCode }  from '../../shared/constans/error-codes.constants';


export interface LogParams {
  entityType:       AuditEntityType;
  entityId:         string;
  action:           AuditAction;
  previousValue?:   Record<string, any>;
  newValue?:        Record<string, any>;
  performedById:    string;
  performedByName?: string;
  performedByRole:  string;
  complexId?:       string;
  description?:     string;
  /** Marcar true en operaciones masivas — COMPLEX_ROL no las audita */
  isBulk?:          boolean;
}

@Injectable()
export class AuditService {
  private readonly logger = new Logger(AuditService.name);

  constructor(
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
    private readonly dataSource: DataSource,
  ) {}

  // ================================================================
  // REGISTRAR ACCIÓN (fire-and-forget — nunca rompe el flujo principal)
  // ================================================================

  /**
   * SECURITY_ROL: todos los movimientos del guardia.
   * COMPLEX_ROL: acciones individuales (bulk excluido vía isBulk).
   * SUPER_ADMIN_ROL: solo reversiones (acción REVERT).
   */
  private static readonly AUDITED_ROLES = new Set<string>([
    ValidRoles.SECURITY_ROL,
    ValidRoles.COMPLEX_ROL,
    ValidRoles.SUPER_ADMIN_ROL,
  ]);

  async log(params: LogParams): Promise<void> {
    if (!AuditService.AUDITED_ROLES.has(params.performedByRole)) return;
    if (params.performedByRole === ValidRoles.COMPLEX_ROL && params.isBulk) return;

    try {
      const referenceNumber = await this.generateReferenceNumber();

      await this.auditRepo.save(
        this.auditRepo.create({
          referenceNumber,
          entityType:      params.entityType,
          entityId:        params.entityId,
          action:          params.action,
          previousValue:   params.previousValue,
          newValue:        params.newValue,
          performedById:   params.performedById,
          performedByName: params.performedByName,
          performedByRole: params.performedByRole,
          complexId:       params.complexId,
          description:     params.description,
          isReverted:      false,
        }),
      );
    } catch (err) {
      // Nunca propagar el error — el log es secundario al flujo de negocio
      this.logger.error('Error al registrar auditoría', err);
    }
  }

  // ================================================================
  // CONSULTAR HISTORIAL
  // ================================================================

  async findAll(
    filter: FilterAuditLogsInput,
    callerRole: string,
    callerComplexId?: string,
  ): Promise<PaginatedAuditLogsResponse> {
    const {
      action, entityType, entityId, performedById, performedByRole,
      referenceNumber, from, to, limit = 20, offset = 0,
    } = filter;

    const qb = this.auditRepo
      .createQueryBuilder('al')
      .orderBy('al.createdAt', 'DESC')
      .take(limit)
      .skip(offset);

    // ── Reglas de visibilidad ──────────────────────────────────────
    if (callerRole === ValidRoles.SUPER_ADMIN_ROL) {
      // SUPER_ADMIN puede filtrar por complexId opcionalmente
      if (filter.complexId) {
        qb.andWhere('al.complex_id = :complexId', { complexId: filter.complexId });
      }
    } else {
      // COMPLEX_ROL: solo ve su complejo y solo los roles auditados relevantes
      if (!callerComplexId) {
        throw new CustomError({
          message: 'No se pudo determinar el complejo del usuario autenticado.',
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GeneralErrorCode.BAD_REQUEST,
        });
      }
      qb.andWhere('al.complex_id = :complexId', { complexId: callerComplexId });
      qb.andWhere('al.performed_by_role IN (:...visibleRoles)', {
        visibleRoles: [ValidRoles.SECURITY_ROL, ValidRoles.COMPLEX_ROL],
      });
    }

    // ── Filtros opcionales adicionales ─────────────────────────────
    if (action)          qb.andWhere('al.action = :action', { action });
    if (entityType)      qb.andWhere('al.entity_type = :entityType', { entityType });
    if (entityId)        qb.andWhere('al.entity_id = :entityId', { entityId });
    if (performedById)   qb.andWhere('al.performed_by_id = :performedById', { performedById });
    if (performedByRole) qb.andWhere('al.performed_by_role = :performedByRole', { performedByRole });
    if (referenceNumber) qb.andWhere('al.reference_number = :referenceNumber', { referenceNumber });
    if (from)            qb.andWhere('al.createdAt >= :from', { from: new Date(from) });
    if (to)              qb.andWhere('al.createdAt <= :to', { to: new Date(to) });

    const [items, total] = await qb.getManyAndCount();

    return { items, total, limit, offset };
  }

  // ================================================================
  // REVERTIR ACCIÓN (solo SUPER_ADMIN)
  // ================================================================

  async revert(referenceNumber: string, revertedById: string): Promise<RevertAuditResponse> {
    // 1. Obtener el registro de auditoría
    const auditLog = await this.auditRepo.findOne({ where: { referenceNumber } });
    if (!auditLog) {
      throw new CustomError({
        message: `No se encontró ningún registro de auditoría con referencia '${referenceNumber}'.`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    if (auditLog.isReverted) {
      throw new CustomError({
        message: `El registro '${referenceNumber}' ya fue revertido el ${auditLog.revertedAt?.toISOString()}.`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: GeneralErrorCode.CONFLICT,
      });
    }

    if (auditLog.action === AuditAction.REVERT) {
      throw new CustomError({
        message: 'No se puede revertir una acción que ya es una reversión.',
        statusCode: HttpStatus.CONFLICT,
        errorCode: GeneralErrorCode.CONFLICT,
      });
    }

    // 2. Encontrar la metadata de la entidad por nombre de clase
    const metadata = this.dataSource.entityMetadatas.find(
      m => m.name === auditLog.entityType,
    );
    if (!metadata) {
      throw new CustomError({
        message: `Tipo de entidad '${auditLog.entityType}' no encontrado en el sistema.`,
        statusCode: HttpStatus.UNPROCESSABLE_ENTITY,
        errorCode: GeneralErrorCode.INVALID_INPUT,
      });
    }

    // 3. Aplicar la reversión
    const entityManager = this.dataSource.manager;

    if (!auditLog.previousValue) {
      // Revertir un CREATE = eliminar la entidad
      const entity = await entityManager.findOne(metadata.target as any, {
        where: { id: auditLog.entityId },
        withDeleted: true,
      });
      if (entity) {
        await entityManager.remove(metadata.target as any, entity);
      }
    } else {
      // Revertir un UPDATE / DELETE / SUSPEND / etc. = restaurar previousValue
      // Solo se restauran campos seguros (allowlist) — nunca password, tokens ni roles
      const safeValue = AuditService.sanitizeRevertValue(auditLog.entityType, auditLog.previousValue);
      await entityManager.save(metadata.target as any, {
        ...safeValue,
        id: auditLog.entityId,
      });
    }

    // 4. Marcar el registro de auditoría como revertido
    auditLog.isReverted   = true;
    auditLog.revertedAt   = new Date();
    auditLog.revertedById = revertedById;
    await this.auditRepo.save(auditLog);

    // 5. Registrar la reversión como nueva entrada de auditoría
    await this.log({
      entityType:      auditLog.entityType,
      entityId:        auditLog.entityId,
      action:          AuditAction.REVERT,
      previousValue:   auditLog.newValue,
      newValue:        auditLog.previousValue,
      performedById:   revertedById,
      performedByRole: ValidRoles.SUPER_ADMIN_ROL,
      complexId:       auditLog.complexId,
      description:     `Reversión del registro ${referenceNumber} (acción original: ${auditLog.action})`,
    });

    return {
      success: true,
      message: `Acción '${auditLog.action}' en ${auditLog.entityType} revertida exitosamente.`,
      auditLog,
    };
  }

  // ================================================================
  // OBTENER UN REGISTRO POR REFERENCIA (enriquecido)
  // ================================================================

  async findByReference(referenceNumber: string, callerComplexId?: string): Promise<AuditLogDetailResponse> {
    const auditLog = await this.auditRepo.findOne({ where: { referenceNumber } });
    if (!auditLog) {
      throw new CustomError({
        message: `Registro de auditoría '${referenceNumber}' no encontrado.`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    if (callerComplexId && auditLog.complexId !== callerComplexId) {
      throw new CustomError({
        message: `Registro de auditoría '${referenceNumber}' no encontrado.`,
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GeneralErrorCode.NOT_FOUND,
      });
    }

    const [entityLabel, revertedByName] = await Promise.all([
      this.resolveEntityLabel(auditLog.entityType, auditLog.entityId),
      auditLog.revertedById ? this.resolveUserName(auditLog.revertedById) : Promise.resolve(undefined),
    ]);

    return { auditLog, entityLabel, revertedByName };
  }

  // ================================================================
  // HELPERS PRIVADOS DE RESOLUCIÓN
  // ================================================================

  private async resolveEntityLabel(entityType: AuditEntityType, entityId: string): Promise<string | undefined> {
    try {
      const metadata = this.dataSource.entityMetadatas.find(m => m.name === entityType);
      if (!metadata) return undefined;

      const entity = await this.dataSource.manager.findOne(metadata.target as any, {
        where: { id: entityId },
        withDeleted: true,
      }) as any;

      if (!entity) return `[eliminado: ${entityId}]`;

      switch (entityType) {
        case AuditEntityType.User:
          return [entity.name, entity.email].filter(Boolean).join(' - ');
        case AuditEntityType.Resident:
          return `${entity.type ?? ''} - unidad: ${entity.unitId ?? entityId}`.trim();
        case AuditEntityType.Vehicle:
          return [entity.plate, entity.brand, entity.type].filter(Boolean).join(' ');
        case AuditEntityType.ResidentialComplex:
          return entity.name ?? entityId;
        case AuditEntityType.Building:
          return entity.name ?? entityId;
        case AuditEntityType.Unit:
          return `Unidad ${entity.number ?? ''}, Piso ${entity.floor ?? ''}`.trim();
        case AuditEntityType.Visitor:
          return [entity.name, entity.lastName].filter(Boolean).join(' ');
        case AuditEntityType.VisitorVehicle:
          return entity.plate ?? entityId;
        case AuditEntityType.Visit:
          return `${entity.type ?? ''} - ${entity.status ?? ''}`.trim();
        case AuditEntityType.SupervisorVisit:
          return `Supervisión - ${entity.status ?? ''}`.trim();
        case AuditEntityType.SupervisorAccessRequest:
          return `Solicitud acceso - ${entity.status ?? ''}`.trim();
        case AuditEntityType.FeeCharge:
          return `${entity.period ?? ''} - $${entity.amount ?? ''}`.trim();
        case AuditEntityType.FeeConfig:
          return `${entity.name ?? ''} - $${entity.amount ?? ''}`.trim();
        case AuditEntityType.Payment:
          return `$${entity.amount ?? ''} (${entity.method ?? ''})`.trim();
        case AuditEntityType.Note:
          return entity.title ?? entityId;
        case AuditEntityType.ParkingRecord:
          return `Parking - ${entity.status ?? ''}`.trim();
        case AuditEntityType.ParkingConfig:
          return `Config parking - complejo: ${entity.complexId ?? entityId}`;
        default:
          return entityId;
      }
    } catch {
      return undefined;
    }
  }

  private async resolveUserName(userId: string): Promise<string | undefined> {
    try {
      const metadata = this.dataSource.entityMetadatas.find(m => m.name === 'User');
      if (!metadata) return undefined;

      const user = await this.dataSource.manager.findOne(metadata.target as any, {
        where: { id: userId },
        withDeleted: true,
      }) as any;

      return user ? ([user.name, user.email].filter(Boolean).join(' - ')) : undefined;
    } catch {
      return undefined;
    }
  }

  // ================================================================
  // GENERACIÓN DE NÚMERO DE REFERENCIA
  // ================================================================

  // ================================================================
  // SANITIZACIÓN DE VALORES PARA REVERT
  // ================================================================

  private static readonly REVERT_BLOCKED_FIELDS = new Set([
    'password', 'tokenVersion', 'refreshToken', 'resetPasswordToken',
    'resetPasswordExpires', 'accountLockedUntil', 'qrLoginToken', 'qrLoginPin',
    'userRoles', 'roles',
  ]);

  private static sanitizeRevertValue(
    entityType: AuditEntityType,
    value: Record<string, any>,
  ): Record<string, any> {
    const result: Record<string, any> = {};
    for (const [key, val] of Object.entries(value)) {
      if (!AuditService.REVERT_BLOCKED_FIELDS.has(key)) {
        result[key] = val;
      }
    }
    return result;
  }

  private async generateReferenceNumber(): Promise<string> {
    const now   = new Date();
    const today = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, '0')}${String(now.getDate()).padStart(2, '0')}`;
    const prefix = `AUD-${today}-`;

    const count = await this.auditRepo
      .createQueryBuilder('al')
      .where('al.reference_number LIKE :prefix', { prefix: `${prefix}%` })
      .getCount();

    return `${prefix}${String(count + 1).padStart(4, '0')}`;
  }
}
