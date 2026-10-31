import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import {
  DataSource,
  EntityManager,
  EntityTarget,
  ObjectLiteral,
} from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import {
  OrganizationChannel,
  PersonChannel,
} from '../entities/channels.entity';
import { Evidence } from '../entities/evidence.entity';
import { Organization } from '../entities/organization.entity';
import { Person } from '../entities/person.entity';
import { Property } from '../entities/property.entity';
import { Employment, PropertyManagement } from '../entities/relations.entity';
import { GrowthEvidenceStatus, GrowthProspectKind } from '../prospects.enums';
import { GrowthSourceReferenceInput } from '../dto/inputs/source-reference.input';
import {
  GrowthAddEvidenceInput,
  GrowthVerifyEvidenceInput,
} from '../dto/inputs/evidence.inputs';
import { ProspectGuardsService } from './prospect-guards.service';

/** Entidades que admiten evidencia y el prospecto al que pertenecen. */
const EVIDENCEABLE: Partial<
  Record<GrowthEntityType, EntityTarget<ObjectLiteral>>
> = {
  [GrowthEntityType.ORGANIZATION]: Organization,
  [GrowthEntityType.PERSON]: Person,
  [GrowthEntityType.PROPERTY]: Property,
  [GrowthEntityType.ORGANIZATION_CHANNEL]: OrganizationChannel,
  [GrowthEntityType.PERSON_CHANNEL]: PersonChannel,
  [GrowthEntityType.EMPLOYMENT]: Employment,
  [GrowthEntityType.PROPERTY_MANAGEMENT]: PropertyManagement,
};

/** Datos personales: sus evidencias se enmascaran sin permiso. */
export const PERSONAL_EVIDENCE_TYPES = new Set([
  GrowthEntityType.PERSON,
  GrowthEntityType.PERSON_CHANNEL,
]);

@Injectable()
export class EvidencesService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guards: ProspectGuardsService,
    private readonly activity: ActivityLogService,
  ) {}

  /**
   * Registra una evidencia por cada campo informado en un alta o edición.
   * La llaman los servicios dentro de su transacción.
   */
  async recordFields(
    manager: EntityManager,
    actor: JwtAccessPayload,
    target: { entityType: GrowthEntityType; entityId: string },
    fields: Record<string, unknown>,
    source: GrowthSourceReferenceInput,
  ): Promise<void> {
    const rows = Object.entries(fields)
      .filter(([, v]) => v !== undefined && v !== null && v !== '')
      .map(([field, value]) => ({
        entityType: target.entityType,
        entityId: target.entityId,
        field,
        observedValue:
          value instanceof Date
            ? value.toISOString()
            : String(value as string | number | boolean),
        sourceId: source.sourceId,
        url: source.url ?? null,
        consultedAt: source.consultedAt,
        reliability: source.reliability,
        notes: source.notes ?? null,
        capturedByUserId: actor.sub,
      }));
    if (rows.length) await manager.insert(Evidence, rows);
  }

  async add(
    input: GrowthAddEvidenceInput,
    actor: JwtAccessPayload,
  ): Promise<Evidence> {
    return this.dataSource.transaction(async (manager) => {
      await this.assertTargetVisible(
        manager,
        input.entityType,
        input.entityId,
        actor,
      );
      await this.guards.assertSourceUsable(manager, input.source);
      const evidence = await manager.save(
        manager.create(Evidence, {
          entityType: input.entityType,
          entityId: input.entityId,
          field: input.field,
          observedValue: input.observedValue ?? null,
          sourceId: input.source.sourceId,
          url: input.source.url ?? null,
          consultedAt: input.source.consultedAt,
          reliability: input.source.reliability,
          notes: input.source.notes ?? null,
          capturedByUserId: actor.sub,
        }),
      );
      await this.activity.record(manager, actor, {
        action: 'EVIDENCE_ADDED',
        entityType: GrowthEntityType.EVIDENCE,
        entityId: evidence.id,
        changes: {
          targetType: input.entityType,
          targetId: input.entityId,
          field: input.field,
        },
      });
      return evidence;
    });
  }

  /** Verificar o disputar. Quien capturó la evidencia no la verifica. */
  async verify(
    id: string,
    input: GrowthVerifyEvidenceInput,
    actor: JwtAccessPayload,
  ): Promise<Evidence> {
    return this.dataSource.transaction(async (manager) => {
      const evidence = await this.findOrFail(manager, id);
      await this.assertTargetVisible(
        manager,
        evidence.entityType,
        evidence.entityId,
        actor,
      );
      if (evidence.verificationStatus === GrowthEvidenceStatus.OBSOLETE) {
        throw new CustomError({
          message: 'La evidencia está obsoleta',
          statusCode: HttpStatus.CONFLICT,
          errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
        });
      }
      await this.guards.assertSegregation(manager, actor, {
        registeredByUserId: evidence.capturedByUserId,
        operation: `EVIDENCE_${input.status}`,
        entityType: GrowthEntityType.EVIDENCE,
        entityId: id,
      });
      evidence.verificationStatus = input.status;
      evidence.verifiedByUserId = actor.sub;
      evidence.verifiedAt = new Date();
      if (input.notes) evidence.notes = input.notes;
      const saved = await manager.save(evidence);
      await this.activity.record(manager, actor, {
        action: `EVIDENCE_${input.status}`,
        entityType: GrowthEntityType.EVIDENCE,
        entityId: id,
        changes: { field: evidence.field, targetType: evidence.entityType },
      });
      return saved;
    });
  }

  /** Las evidencias no se borran: quedan OBSOLETE con su motivo. */
  async markObsolete(
    id: string,
    note: string,
    actor: JwtAccessPayload,
  ): Promise<Evidence> {
    if (note.trim().length < 5) {
      throw new CustomError({
        message: 'Marcar una evidencia como obsoleta exige un motivo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
      });
    }
    return this.dataSource.transaction(async (manager) => {
      const evidence = await this.findOrFail(manager, id);
      await this.assertTargetVisible(
        manager,
        evidence.entityType,
        evidence.entityId,
        actor,
      );
      evidence.verificationStatus = GrowthEvidenceStatus.OBSOLETE;
      evidence.verifiedByUserId = actor.sub;
      evidence.verifiedAt = new Date();
      evidence.notes = note.trim();
      const saved = await manager.save(evidence);
      await this.activity.record(manager, actor, {
        action: 'EVIDENCE_OBSOLETE',
        entityType: GrowthEntityType.EVIDENCE,
        entityId: id,
        changes: { field: evidence.field, note: note.trim() },
      });
      return saved;
    });
  }

  async listFor(
    entityType: GrowthEntityType,
    entityId: string,
    actor: JwtAccessPayload,
  ): Promise<Evidence[]> {
    await this.assertTargetVisible(
      this.dataSource.manager,
      entityType,
      entityId,
      actor,
    );
    return this.dataSource.manager.find(Evidence, {
      where: { entityType, entityId },
      order: { field: 'ASC', createdAt: 'DESC' },
      take: 100,
    });
  }

  /** ¿Hay evidencia VERIFIED del campo? (lista de validación) */
  async hasVerified(
    manager: EntityManager,
    entityType: GrowthEntityType,
    entityId: string,
    field: string,
  ): Promise<boolean> {
    return manager.exists(Evidence, {
      where: {
        entityType,
        entityId,
        field,
        verificationStatus: GrowthEvidenceStatus.VERIFIED,
      },
    });
  }

  /**
   * La evidencia hereda la visibilidad del prospecto al que pertenece. Para
   * canales y relaciones se resuelve el prospecto dueño.
   */
  private async assertTargetVisible(
    manager: EntityManager,
    entityType: GrowthEntityType,
    entityId: string,
    actor: JwtAccessPayload,
  ): Promise<void> {
    const target = EVIDENCEABLE[entityType];
    if (!target) {
      throw new CustomError({
        message: 'Ese tipo de registro no admite evidencias',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
      });
    }
    const row = await manager.findOne(target, { where: { id: entityId } });
    if (!row) {
      throw new CustomError({
        message: 'Registro no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
      });
    }
    const owner = ownerOf(entityType, row);
    if (owner)
      await this.guards.findVisible(manager, owner.kind, owner.id, actor);
  }

  private async findOrFail(
    manager: EntityManager,
    id: string,
  ): Promise<Evidence> {
    const evidence = await manager.findOne(Evidence, {
      where: { id },
      lock: { mode: 'pessimistic_write' },
    });
    if (!evidence) {
      throw new CustomError({
        message: 'Evidencia no encontrada',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
      });
    }
    return evidence;
  }
}

function ownerOf(
  entityType: GrowthEntityType,
  row: ObjectLiteral,
): { kind: GrowthProspectKind; id: string } | null {
  switch (entityType) {
    case GrowthEntityType.ORGANIZATION:
      return { kind: GrowthProspectKind.ORGANIZATION, id: row.id as string };
    case GrowthEntityType.PERSON:
      return { kind: GrowthProspectKind.PERSON, id: row.id as string };
    case GrowthEntityType.PROPERTY:
      return { kind: GrowthProspectKind.PROPERTY, id: row.id as string };
    case GrowthEntityType.ORGANIZATION_CHANNEL:
      return {
        kind: GrowthProspectKind.ORGANIZATION,
        id: row.organizationId as string,
      };
    case GrowthEntityType.PERSON_CHANNEL:
      return { kind: GrowthProspectKind.PERSON, id: row.personId as string };
    case GrowthEntityType.EMPLOYMENT:
      return { kind: GrowthProspectKind.PERSON, id: row.personId as string };
    case GrowthEntityType.PROPERTY_MANAGEMENT:
      return {
        kind: GrowthProspectKind.PROPERTY,
        id: row.propertyId as string,
      };
    default:
      return null;
  }
}
