import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Not } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import {
  OrganizationChannel,
  PersonChannel,
} from '../entities/channels.entity';
import { Organization } from '../entities/organization.entity';
import { Person } from '../entities/person.entity';
import { Property } from '../entities/property.entity';
import { Employment, PropertyManagement } from '../entities/relations.entity';
import { ValidatableRecord } from '../entities/validatable-record';
import {
  GrowthChannelClass,
  GrowthChannelKind,
  GrowthLegalBasis,
  GrowthManagerType,
  GrowthProspectKind,
  GrowthRelationStatus,
  GrowthValidationDecision,
  GrowthValidationStatus as S,
} from '../prospects.enums';
import {
  GrowthDecideValidationInput,
  GrowthProspectRefInput,
} from '../dto/inputs/relations.inputs';
import {
  GrowthChecklistItem,
  GrowthReviewItem,
  GrowthValidationChecklist,
} from '../dto/responses/prospect.responses';
import { EvidencesService } from './evidences.service';
import {
  PROSPECT_TARGETS,
  ProspectGuardsService,
} from './prospect-guards.service';

/**
 * Validación humana. La base vigila las transiciones (trigger); aquí se
 * aplican además la separación de funciones y la lista de requisitos para
 * VALIDATED. Validar NUNCA autoriza contacto comercial: eso es otra
 * operación (LegalBasisService) con permisos propios.
 */
@Injectable()
export class ValidationService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guards: ProspectGuardsService,
    private readonly evidences: EvidencesService,
    private readonly activity: ActivityLogService,
  ) {}

  async submit(
    ref: GrowthProspectRefInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.transition(
      ref,
      actor,
      [S.NEW, S.INCOMPLETE],
      'VALIDATION_SUBMITTED',
      (record) => {
        record.validationStatus = S.PENDING_REVIEW;
      },
    );
  }

  /** Tomar para validar: quien lo registró no lo toma (salvo excepción). */
  async take(
    ref: GrowthProspectRefInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.transition(
      ref,
      actor,
      [S.PENDING_REVIEW],
      'VALIDATION_TAKEN',
      async (record, manager) => {
        await this.guards.assertSegregation(manager, actor, {
          registeredByUserId: record.createdByUserId,
          operation: 'VALIDATION_TAKEN',
          entityType: PROSPECT_TARGETS[ref.kind].entityType,
          entityId: ref.id,
        });
        record.validationStatus = S.IN_VALIDATION;
        record.validationTakenByUserId = actor.sub;
      },
    );
  }

  async release(
    ref: GrowthProspectRefInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.transition(
      ref,
      actor,
      [S.IN_VALIDATION],
      'VALIDATION_RELEASED',
      (record) => {
        this.assertTaker(record, actor);
        record.validationStatus = S.PENDING_REVIEW;
        record.validationTakenByUserId = null;
      },
    );
  }

  async decide(
    ref: GrowthProspectRefInput,
    input: GrowthDecideValidationInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.transition(
      ref,
      actor,
      [S.IN_VALIDATION],
      `VALIDATION_${input.decision}`,
      async (record, manager) => {
        this.assertTaker(record, actor);
        await this.guards.assertSegregation(manager, actor, {
          registeredByUserId: record.createdByUserId,
          operation: `VALIDATION_${input.decision}`,
          entityType: PROSPECT_TARGETS[ref.kind].entityType,
          entityId: ref.id,
        });
        if (input.decision === GrowthValidationDecision.VALIDATED) {
          const checklist = await this.buildChecklist(
            manager,
            ref.kind,
            record,
          );
          if (!checklist.ready) {
            const missing = checklist.items
              .filter((i) => !i.ok)
              .map((i) => i.label);
            throw new CustomError({
              message: `Faltan requisitos: ${missing.join('; ')}`,
              statusCode: HttpStatus.CONFLICT,
              errorCode: GrowthErrorCode.GROWTH_VALIDATION_INCOMPLETE,
            });
          }
          record.validatedByUserId = actor.sub;
          record.validatedAt = new Date();
          record.lastVerifiedAt = new Date();
        } else if (!input.note?.trim()) {
          throw new CustomError({
            message: 'Rechazar, devolver o marcar duplicado exige una nota',
            statusCode: HttpStatus.BAD_REQUEST,
            errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
          });
        }
        record.validationStatus = input.decision as unknown as S;
        record.validationNote = input.note?.trim() ?? null;
        record.validationTakenByUserId = null;
      },
    );
  }

  async reopen(
    ref: GrowthProspectRefInput,
    reason: string,
    actor: JwtAccessPayload,
  ): Promise<GrowthReviewItem> {
    return this.transition(
      ref,
      actor,
      [S.REJECTED, S.VALIDATED],
      'VALIDATION_REOPENED',
      (record) => {
        record.validationStatus = S.PENDING_REVIEW;
        record.validationNote = reason.trim();
      },
    );
  }

  async checklist(
    ref: GrowthProspectRefInput,
    actor: JwtAccessPayload,
  ): Promise<GrowthValidationChecklist> {
    const manager = this.dataSource.manager;
    const record = await this.guards.findVisible<ValidatableRecord>(
      manager,
      ref.kind,
      ref.id,
      actor,
    );
    return this.buildChecklist(manager, ref.kind, record);
  }

  /** Bandeja de revisión: pendientes y en validación de las tres entidades. */
  async queue(
    actor: JwtAccessPayload,
    statuses: S[] = [S.PENDING_REVIEW, S.IN_VALIDATION],
    takenByMe = false,
  ): Promise<GrowthReviewItem[]> {
    const items: GrowthReviewItem[] = [];
    for (const kind of Object.values(GrowthProspectKind)) {
      const target = PROSPECT_TARGETS[kind];
      const qb = this.dataSource.manager
        .createQueryBuilder(target.entity, 'e')
        .where('e.deleted_at IS NULL')
        .andWhere('e.validation_status IN (:...statuses)', { statuses })
        .orderBy('e.updatedAt', 'ASC')
        .take(100);
      const scope = this.guards.scope(kind, 'e', actor);
      if (scope) qb.andWhere(scope.sql, scope.params);
      if (takenByMe)
        qb.andWhere('e.validation_taken_by_user_id = :me', { me: actor.sub });
      const rows = (await qb.getMany()) as ValidatableRecord[];
      items.push(...rows.map((r) => toReviewItem(kind, r)));
    }
    return items
      .sort((a, b) => a.updatedAt.getTime() - b.updatedAt.getTime())
      .slice(0, 100);
  }

  private async transition(
    ref: GrowthProspectRefInput,
    actor: JwtAccessPayload,
    from: S[],
    action: string,
    apply: (
      record: ValidatableRecord,
      manager: EntityManager,
    ) => void | Promise<void>,
  ): Promise<GrowthReviewItem> {
    return this.dataSource.transaction(async (manager) => {
      const record = await this.guards.findVisible<ValidatableRecord>(
        manager,
        ref.kind,
        ref.id,
        actor,
        true,
      );
      if (record.deletedAt) throw this.invalidState(record.validationStatus);
      if (!from.includes(record.validationStatus))
        throw this.invalidState(record.validationStatus);
      const previous = record.validationStatus;
      await apply(record, manager);
      record.updatedByUserId = actor.sub;
      const saved = await manager.save(record);
      await this.activity.record(manager, actor, {
        action,
        entityType: PROSPECT_TARGETS[ref.kind].entityType,
        entityId: ref.id,
        changes: { status: { from: previous, to: saved.validationStatus } },
      });
      return toReviewItem(ref.kind, saved);
    });
  }

  private assertTaker(
    record: ValidatableRecord,
    actor: JwtAccessPayload,
  ): void {
    if (record.validationTakenByUserId !== actor.sub) {
      throw new CustomError({
        message: 'La validación la tomó otra persona',
        statusCode: HttpStatus.CONFLICT,
        errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
      });
    }
  }

  private invalidState(status: S): CustomError {
    return new CustomError({
      message: `Operación no permitida en estado ${status}`,
      statusCode: HttpStatus.CONFLICT,
      errorCode: GrowthErrorCode.GROWTH_INVALID_TRANSITION,
    });
  }

  /**
   * Requisitos de VALIDATED por tipo (prospecto validado de la meta):
   *  - Empresa: razón social y NIT con evidencia verificada, un canal
   *    corporativo verificado y al menos una copropiedad administrada.
   *  - Administrador independiente: nombre con evidencia verificada, al menos
   *    una copropiedad administrada y un canal PROFESSIONAL verificado, o un
   *    canal DIRECT verificado con base jurídica válida y documentada.
   *  - Otra persona: nombre verificado y un vínculo con empresa o copropiedad.
   *  - Copropiedad: nombre y dirección verificados, localidad si es Bogotá y
   *    una administración registrada (empresa, persona o autogestión).
   */
  async buildChecklist(
    manager: EntityManager,
    kind: GrowthProspectKind,
    record: ValidatableRecord,
  ): Promise<GrowthValidationChecklist> {
    const items: GrowthChecklistItem[] = [];
    const add = (key: string, label: string, ok: boolean) =>
      items.push({ key, label, ok });
    const verified = (type: GrowthEntityType, field: string) =>
      this.evidences.hasVerified(manager, type, record.id, field);

    if (kind === GrowthProspectKind.ORGANIZATION) {
      const org = record as Organization;
      add(
        'legalName',
        'Razón social con evidencia verificada',
        await verified(GrowthEntityType.ORGANIZATION, 'legalName'),
      );
      add(
        'nit',
        'NIT registrado con evidencia verificada',
        !!org.nit && (await verified(GrowthEntityType.ORGANIZATION, 'nit')),
      );
      add(
        'corporateChannel',
        'Canal corporativo verificado (teléfono, correo o sitio)',
        await manager.exists(OrganizationChannel, {
          where: {
            organizationId: org.id,
            verifiedAt: Not(IsNull()),
            kind: Not(GrowthChannelKind.SOCIAL),
          },
        }),
      );
      add(
        'managedProperty',
        'Al menos una copropiedad administrada',
        await manager.exists(PropertyManagement, {
          where: {
            organizationId: org.id,
            status: Not(GrowthRelationStatus.PAST),
          },
        }),
      );
    } else if (kind === GrowthProspectKind.PERSON) {
      const person = record as Person;
      add(
        'fullName',
        'Nombre con evidencia verificada',
        await verified(GrowthEntityType.PERSON, 'fullName'),
      );
      add('notAnonymized', 'Persona no anonimizada', !person.anonymizedAt);
      if (person.isIndependentAdmin) {
        add(
          'managedProperty',
          'Al menos una copropiedad administrada directamente',
          await manager.exists(PropertyManagement, {
            where: {
              personId: person.id,
              managerType: GrowthManagerType.PERSON,
              status: Not(GrowthRelationStatus.PAST),
            },
          }),
        );
        const professional = await manager.exists(PersonChannel, {
          where: {
            personId: person.id,
            channelClass: GrowthChannelClass.PROFESSIONAL,
            verifiedAt: Not(IsNull()),
            kind: Not(GrowthChannelKind.SOCIAL),
          },
        });
        const direct = await manager.exists(PersonChannel, {
          where: {
            personId: person.id,
            channelClass: GrowthChannelClass.DIRECT,
            verifiedAt: Not(IsNull()),
            kind: Not(GrowthChannelKind.SOCIAL),
          },
        });
        const basisDocumented =
          person.legalBasis !== GrowthLegalBasis.PENDING_LEGAL_REVIEW &&
          !!person.legalBasisReference;
        add(
          'channel',
          'Canal profesional verificado, o canal directo verificado con base jurídica válida y documentada',
          professional || (direct && basisDocumented),
        );
      } else {
        const linked =
          (await manager.exists(Employment, {
            where: { personId: person.id },
          })) ||
          (await manager.exists(PropertyManagement, {
            where: { responsiblePersonId: person.id },
          }));
        add('relation', 'Vinculada a una empresa o copropiedad', linked);
      }
    } else {
      const property = record as Property;
      add(
        'name',
        'Nombre con evidencia verificada',
        await verified(GrowthEntityType.PROPERTY, 'name'),
      );
      add(
        'address',
        'Dirección con evidencia verificada',
        !!property.address &&
          (await verified(GrowthEntityType.PROPERTY, 'address')),
      );
      add(
        'locality',
        'Localidad (Bogotá)',
        property.city !== 'BOGOTA' || !!property.locality,
      );
      add(
        'management',
        'Administración registrada (empresa, persona o autogestión)',
        await manager.exists(PropertyManagement, {
          where: {
            propertyId: property.id,
            status: Not(GrowthRelationStatus.PAST),
          },
        }),
      );
    }
    return { kind, id: record.id, ready: items.every((i) => i.ok), items };
  }
}

function toReviewItem(
  kind: GrowthProspectKind,
  r: ValidatableRecord,
): GrowthReviewItem {
  const name =
    kind === GrowthProspectKind.ORGANIZATION
      ? (r as Organization).legalName
      : kind === GrowthProspectKind.PERSON
        ? (r as Person).fullName
        : (r as Property).name;
  return {
    kind,
    id: r.id,
    displayName: name,
    validationStatus: r.validationStatus,
    validationTakenByUserId: r.validationTakenByUserId ?? null,
    createdByUserId: r.createdByUserId,
    updatedAt: r.updatedAt,
  };
}
