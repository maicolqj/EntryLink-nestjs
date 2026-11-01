import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, IsNull } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthEntityType } from '../../shared/growth.enums';
import { GrowthSourceReferenceInput } from '../../prospects/dto/inputs/source-reference.input';
import {
  GrowthChannelClass,
  GrowthChannelKind,
  GrowthProspectKind as K,
} from '../../prospects/prospects.enums';
import { ChannelsService } from '../../prospects/services/channels.service';
import { EvidencesService } from '../../prospects/services/evidences.service';
import { OrganizationsService } from '../../prospects/services/organizations.service';
import { PeopleService } from '../../prospects/services/people.service';
import { PropertiesService } from '../../prospects/services/properties.service';
import {
  PROSPECT_TARGETS,
  ProspectGuardsService,
} from '../../prospects/services/prospect-guards.service';
import { ProspectEventsService } from '../../prospects/services/prospect-events.service';
import {
  ImportBatch,
  ImportIssue,
  ImportRow,
} from '../entities/import.entities';
import {
  GrowthImportDecision as D,
  GrowthImportField as F,
  GrowthImportRowResult as R,
  GrowthImportStatus as S,
  GrowthImportTarget as T,
} from '../imports.enums';
import { fromJobActor, ImportJobActor } from './import-queue.service';

/** Correo y teléfono van como canales: no se copian a evidencias al vincular. */
const CHANNEL_FIELDS: F[] = [F.EMAIL, F.PHONE];

export const TARGET_KIND: Record<T, K> = {
  [T.ORGANIZATIONS]: K.ORGANIZATION,
  [T.PROPERTIES]: K.PROPERTY,
  [T.PEOPLE]: K.PERSON,
};

/**
 * Paso 5: crea o vincula fila por fila con los servicios de 1A, cada fila en
 * su propia transacción (un error no tumba el lote). Idempotente: una fila
 * con resultado no se vuelve a procesar. Todo nace en estado NEW.
 */
@Injectable()
export class ImportCommitService {
  private readonly logger = new Logger(ImportCommitService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly organizations: OrganizationsService,
    private readonly people: PeopleService,
    private readonly properties: PropertiesService,
    private readonly channels: ChannelsService,
    private readonly evidences: EvidencesService,
    private readonly guards: ProspectGuardsService,
    private readonly events: ProspectEventsService,
    private readonly activity: ActivityLogService,
  ) {}

  async commit(batchId: string, jobActor: ImportJobActor): Promise<void> {
    const manager = this.dataSource.manager;
    const batch = await manager.findOne(ImportBatch, {
      where: { id: batchId },
    });
    if (!batch || batch.status !== S.COMMITTING) return;
    const actor = fromJobActor(jobActor);
    const source: GrowthSourceReferenceInput = {
      sourceId: batch.sourceId,
      url: batch.sourceUrl ?? undefined,
      consultedAt: batch.consultedAt,
      reliability: batch.reliability,
      notes: batch.sourceNotes ?? `Importación ${batch.id}`,
    };

    const pending = await manager.find(ImportRow, {
      where: { batchId, result: IsNull() },
      order: { rowNumber: 'ASC' },
    });
    for (const row of pending) {
      const outcome = await this.processRow(batch, row, source, actor);
      await manager.update(ImportRow, row.id, {
        ...outcome,
        processedAt: new Date(),
      });
      if (outcome.result === R.CREATED && outcome.resultEntityId) {
        await this.events.changed(
          TARGET_KIND[batch.target],
          outcome.resultEntityId,
          {
            dedupe: true,
          },
        );
      }
    }

    const [counts]: Array<Record<string, string>> = await manager.query(
      `SELECT count(*) FILTER (WHERE result = 'CREATED') AS created,
              count(*) FILTER (WHERE result = 'LINKED') AS linked,
              count(*) FILTER (WHERE result = 'SKIPPED') AS skipped,
              count(*) FILTER (WHERE result = 'FAILED') AS failed
         FROM growth.import_rows WHERE batch_id = $1`,
      [batchId],
    );
    const totals = {
      createdRows: Number(counts.created),
      linkedRows: Number(counts.linked),
      skippedRows: Number(counts.skipped),
      failedRows: Number(counts.failed),
    };
    await this.dataSource.transaction(async (tx) => {
      const now = new Date();
      await tx.update(ImportBatch, batchId, {
        ...totals,
        status: S.COMMITTED,
        committedAt: now,
        finishedAt: now,
      });
      await this.activity.record(tx, actor, {
        action: 'IMPORT_COMMITTED',
        entityType: GrowthEntityType.IMPORT_BATCH,
        entityId: batchId,
        changes: totals,
      });
    });
  }

  private async processRow(
    batch: ImportBatch,
    row: ImportRow,
    source: GrowthSourceReferenceInput,
    actor: JwtAccessPayload,
  ): Promise<Partial<ImportRow>> {
    const v = (row.mapped ?? {}) as Partial<
      Record<F, string | number | boolean>
    >;
    try {
      if (row.decision === D.LINK_EXISTING && row.linkEntityId) {
        await this.link(batch.target, row.linkEntityId, v, source, actor);
        return { result: R.LINKED, resultEntityId: row.linkEntityId };
      }
      if (row.decision !== D.CREATE || row.errors.length) {
        return { result: R.SKIPPED };
      }
      const id = await this.create(batch, v, source, actor);
      const warnings = [
        ...row.warnings,
        ...(await this.addChannels(batch, id, v, source, actor)),
      ];
      return { result: R.CREATED, resultEntityId: id, warnings };
    } catch (error) {
      const code =
        error instanceof CustomError ? error.errorCode : 'UNEXPECTED';
      if (!(error instanceof CustomError)) {
        this.logger.error(
          `Fila ${row.rowNumber} del lote ${batch.id}: ${String(error)}`,
        );
      }
      return { result: R.FAILED, resultError: code.slice(0, 60) };
    }
  }

  private async create(
    batch: ImportBatch,
    v: Partial<Record<F, string | number | boolean>>,
    source: GrowthSourceReferenceInput,
    actor: JwtAccessPayload,
  ): Promise<string> {
    const s = (f: F) => (v[f] === undefined ? undefined : String(v[f]));
    const n = (f: F) => (v[f] === undefined ? undefined : Number(v[f]));
    switch (batch.target) {
      case T.ORGANIZATIONS:
        return (
          await this.organizations.create(
            {
              legalName: s(F.LEGAL_NAME),
              tradeName: s(F.TRADE_NAME),
              nit: s(F.NIT),
              website: s(F.WEBSITE),
              address: s(F.ADDRESS),
              city: s(F.CITY),
              locality: v[F.LOCALITY] as never,
              estimatedProperties: n(F.ESTIMATED_PROPERTIES),
              estimatedUnits: n(F.ESTIMATED_UNITS),
              source,
            },
            actor,
          )
        ).id;
      case T.PROPERTIES:
        return (
          await this.properties.create(
            {
              name: s(F.NAME),
              phType: v[F.PH_TYPE] as never,
              buildingKind: v[F.BUILDING_KIND] as never,
              address: s(F.ADDRESS),
              city: s(F.CITY),
              locality: v[F.LOCALITY] as never,
              neighborhood: s(F.NEIGHBORHOOD),
              estimatedUnits: n(F.ESTIMATED_UNITS),
              realEstateRegistration: s(F.REAL_ESTATE_REGISTRATION),
              nit: s(F.NIT),
              source,
            },
            actor,
          )
        ).id;
      case T.PEOPLE:
        return (
          await this.people.create(
            {
              fullName: s(F.FULL_NAME),
              isIndependentAdmin: v[F.IS_INDEPENDENT_ADMIN] === true,
              source,
            },
            actor,
          )
        ).id;
    }
  }

  /**
   * Correo y teléfono como canales. Si un canal falla (p. ej. quedó en la lista
   * de exclusión después de validar) el registro se conserva sin ese canal y
   * la fila lleva el aviso.
   */
  private async addChannels(
    batch: ImportBatch,
    id: string,
    v: Partial<Record<F, string | number | boolean>>,
    source: GrowthSourceReferenceInput,
    actor: JwtAccessPayload,
  ): Promise<ImportIssue[]> {
    if (batch.target === T.PROPERTIES) return [];
    const warnings: ImportIssue[] = [];
    for (const [field, kind] of [
      [F.EMAIL, GrowthChannelKind.EMAIL],
      [F.PHONE, GrowthChannelKind.PHONE],
    ] as const) {
      const value = v[field];
      if (typeof value !== 'string') continue;
      try {
        if (batch.target === T.ORGANIZATIONS) {
          await this.channels.addToOrganization(
            id,
            { kind, value, source },
            actor,
          );
        } else {
          await this.channels.addToPerson(
            id,
            {
              kind,
              value,
              source,
              channelClass:
                batch.personChannelClass ?? GrowthChannelClass.PROFESSIONAL,
            },
            actor,
          );
        }
      } catch (error) {
        warnings.push({
          field,
          code:
            error instanceof CustomError &&
            error.errorCode === 'GROWTH_CHANNEL_SUPPRESSED'
              ? 'SUPPRESSED'
              : 'CHANNEL_FAILED',
        });
      }
    }
    return warnings;
  }

  /** No cambia el registro: deja evidencia de lo observado con la fuente del lote. */
  private async link(
    target: T,
    entityId: string,
    v: Partial<Record<F, string | number | boolean>>,
    source: GrowthSourceReferenceInput,
    actor: JwtAccessPayload,
  ): Promise<void> {
    const kind = TARGET_KIND[target];
    await this.dataSource.transaction(async (manager) => {
      await this.guards.assertSourceUsable(manager, source);
      const record = await this.guards.findVisible<{
        mergedIntoId?: string | null;
      }>(manager, kind, entityId, actor);
      if (record.mergedIntoId) {
        throw new CustomError({
          message: 'El registro fue fusionado',
          statusCode: 409,
          errorCode: 'GROWTH_IMPORT_LINK_MERGED',
        });
      }
      await this.evidences.recordFields(
        manager,
        actor,
        { entityType: PROSPECT_TARGETS[kind].entityType, entityId },
        Object.fromEntries(
          Object.entries(v).filter(
            ([f]) => !(CHANNEL_FIELDS as string[]).includes(f),
          ),
        ),
        source,
      );
    });
  }
}
