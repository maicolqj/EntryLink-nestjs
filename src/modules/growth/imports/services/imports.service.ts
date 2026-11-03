import { createHash } from 'node:crypto';
import { HttpStatus, Injectable } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ValidPermissions } from '../../../permissions/enums/valid-permissions';
import { PaginationInput } from '../../../shared/dto/inputs/pagination.input';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../../../shared/utils/errors.utils';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { actorHas } from '../../shared/growth-actor';
import { GrowthErrorCode } from '../../shared/growth-error-codes';
import { GrowthEntityType } from '../../shared/growth.enums';
import { GrowthEvidenceReliability } from '../../prospects/prospects.enums';
import { paginate } from '../../prospects/dto/responses/prospect.responses';
import { ProspectGuardsService } from '../../prospects/services/prospect-guards.service';
import {
  GrowthImportBatchFilterInput,
  GrowthImportRowDecisionInput,
  GrowthImportRowFilterInput,
  GrowthMapImportInput,
  GrowthUploadImportDto,
} from '../dto/inputs/import.inputs';
import {
  GrowthImportPreview,
  PaginatedGrowthImportBatches,
  PaginatedGrowthImportRows,
} from '../dto/responses/import.responses';
import {
  ImportBatch,
  ImportMappingTemplate,
  ImportRow,
} from '../entities/import.entities';
import {
  GrowthImportDecision as D,
  GrowthImportField as F,
  GrowthImportStatus as S,
  GrowthImportTarget as T,
} from '../imports.enums';
import { mappingProblems, suggestMapping } from '../shared/field-catalog';
import { ImportFileError, readSpreadsheet } from '../shared/file-reader';
import { previousBatchesQuery } from '../shared/previous-batches';
import { buildImportReport, maskRawRow } from '../shared/report';
import { TARGET_KIND } from './import-commit.service';
import {
  IMPORT_JOBS,
  ImportQueueService,
  toJobActor,
} from './import-queue.service';
import { ImportRedactionService } from './import-redaction.service';
import { mappingKeyOf } from './import-validation.service';

const PREVIEW_ROWS = 20;

const ISSUE_LABELS: Record<string, string> = {
  REQUIRED: 'obligatorio',
  TOO_SHORT: 'muy corto',
  TOO_LONG: 'muy largo',
  INVALID_NIT: 'NIT inválido',
  NIT_CHECK_DIGIT: 'dígito de verificación no corresponde',
  INVALID_EMAIL: 'correo inválido',
  INVALID_PHONE: 'teléfono inválido',
  INVALID_WEBSITE: 'sitio web inválido',
  INVALID_LOCALITY: 'localidad desconocida',
  LOCALITY_OUTSIDE_BOGOTA: 'la localidad solo aplica a Bogotá',
  INVALID_NUMBER: 'número inválido',
  INVALID_BOOLEAN: 'use sí o no',
  INVALID_OPTION: 'opción desconocida',
  SUPPRESSED: 'en la lista de exclusión: no se guarda',
  DUPLICATE_IN_FILE: 'repetida en el archivo',
  MATCHES_EXISTING: 'coincide con un registro existente',
  CHANNEL_FAILED: 'el canal no se pudo guardar',
};

/**
 * Importaciones CSV/XLSX: subir (con fuente ACTIVE), vista previa, mapeo,
 * validación en cola, decisión por fila y confirmación en cola. Nada se
 * valida ni se fusiona solo: todo entra como NEW.
 */
@Injectable()
export class ImportsService {
  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly guards: ProspectGuardsService,
    private readonly activity: ActivityLogService,
    private readonly queue: ImportQueueService,
    private readonly redaction: ImportRedactionService,
  ) {}

  // ── Subir ────────────────────────────────────────────────────────────────

  async upload(
    file: { buffer: Buffer; originalname: string } | undefined,
    input: GrowthUploadImportDto,
    actor: JwtAccessPayload,
  ): Promise<ImportBatch> {
    if (!file?.buffer?.length)
      throw invalidFile('Adjunte un archivo CSV o XLSX');
    let sheet: Awaited<ReturnType<typeof readSpreadsheet>>;
    try {
      sheet = await readSpreadsheet(file.buffer);
    } catch (error) {
      if (error instanceof ImportFileError) throw invalidFile(error.message);
      throw invalidFile('No se pudo leer el archivo');
    }
    // Antes de guardar nada: los correos y teléfonos excluidos se redactan en
    // las filas (y en los encabezados). El archivo original no se conserva.
    const suppressedValues = await this.redaction.redact([
      sheet.headers,
      ...sheet.rows.map((r) => r.values),
    ]);
    if (input.consultedAt.getTime() > Date.now() + 60_000) {
      throw new CustomError({
        message: 'La fecha de consulta no puede ser futura',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
      });
    }

    return this.dataSource.transaction(async (manager) => {
      await this.guards.assertSourceUsable(manager, input);
      const batch = await manager.save(
        manager.create(ImportBatch, {
          target: input.target,
          sourceId: input.sourceId,
          sourceUrl: input.url ?? null,
          consultedAt: input.consultedAt,
          reliability: input.reliability ?? GrowthEvidenceReliability.MEDIUM,
          sourceNotes: input.notes?.trim() || null,
          fileName: safeFileName(file.originalname),
          fileKind: sheet.kind,
          fileSize: file.buffer.length,
          fileSha256: createHash('sha256').update(file.buffer).digest('hex'),
          headers: sheet.headers,
          totalRows: sheet.rows.length,
          suppressedValues,
          status: S.UPLOADED,
          createdByUserId: actor.sub,
        }),
      );
      for (let i = 0; i < sheet.rows.length; i += 500) {
        await manager.insert(
          ImportRow,
          sheet.rows.slice(i, i + 500).map((r) => ({
            batchId: batch.id,
            rowNumber: r.rowNumber,
            raw: r.values,
          })),
        );
      }
      // El evento no lleva el nombre del archivo (puede nombrar personas).
      await this.activity.record(manager, actor, {
        action: 'IMPORT_UPLOADED',
        entityType: GrowthEntityType.IMPORT_BATCH,
        entityId: batch.id,
        changes: {
          target: batch.target,
          sourceId: batch.sourceId,
          fileKind: batch.fileKind,
          fileSize: batch.fileSize,
          totalRows: batch.totalRows,
          suppressedValues,
        },
      });
      return batch;
    });
  }

  // ── Consultas ────────────────────────────────────────────────────────────

  async list(
    actor: JwtAccessPayload,
    filter: GrowthImportBatchFilterInput = {},
    pagination: PaginationInput = { page: 1, limit: 25 },
  ): Promise<PaginatedGrowthImportBatches> {
    const qb = this.dataSource.manager
      .createQueryBuilder(ImportBatch, 'b')
      .orderBy('b.createdAt', 'DESC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);
    if (!this.guards.canSeeAll(actor)) {
      qb.andWhere('b.createdByUserId = :me', { me: actor.sub });
    }
    if (filter.statuses?.length) {
      qb.andWhere('b.status IN (:...statuses)', { statuses: filter.statuses });
    }
    if (filter.target)
      qb.andWhere('b.target = :target', { target: filter.target });
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, pagination);
  }

  /** Lo que el actor no puede ver responde NOT_FOUND, sin revelar que existe. */
  async get(
    id: string,
    actor: JwtAccessPayload,
    manager: EntityManager = this.dataSource.manager,
    lock = false,
  ): Promise<ImportBatch> {
    const qb = manager
      .createQueryBuilder(ImportBatch, 'b')
      .where('b.id = :id', { id });
    if (!this.guards.canSeeAll(actor)) {
      qb.andWhere('b.createdByUserId = :me', { me: actor.sub });
    }
    if (lock) qb.setLock('pessimistic_write');
    const batch = await qb.getOne();
    if (!batch) {
      throw new CustomError({
        message: 'Lote de importación no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
      });
    }
    return batch;
  }

  async preview(
    id: string,
    actor: JwtAccessPayload,
  ): Promise<GrowthImportPreview> {
    const batch = await this.get(id, actor);
    const rows = batch.purgedAt
      ? []
      : await this.dataSource.manager.find(ImportRow, {
          where: { batchId: id },
          order: { rowNumber: 'ASC' },
          take: PREVIEW_ROWS,
        });
    // Solo los lotes que el actor podría abrir: sin VIEW_ALL, los propios.
    const query = previousBatchesQuery(
      batch.fileSha256,
      id,
      this.guards.canSeeAll(actor) ? null : actor.sub,
    );
    const previous: Array<{ id: string }> = await this.dataSource.query(
      query.sql,
      query.params,
    );
    return {
      headers: batch.headers,
      rows: rows.map((r) => this.visibleRaw(r.raw ?? [], actor)),
      suggestedMapping: suggestMapping(batch.target, batch.headers),
      previousBatchIds: previous.map((p) => p.id),
    };
  }

  async rows(
    batchId: string,
    actor: JwtAccessPayload,
    filter: GrowthImportRowFilterInput = {},
    pagination: PaginationInput = { page: 1, limit: 25 },
  ): Promise<PaginatedGrowthImportRows> {
    await this.get(batchId, actor);
    const qb = this.dataSource.manager
      .createQueryBuilder(ImportRow, 'r')
      .where('r.batchId = :batchId', { batchId })
      .orderBy('r.rowNumber', 'ASC')
      .skip((pagination.page - 1) * pagination.limit)
      .take(pagination.limit);
    if (filter.withErrors) qb.andWhere(`jsonb_array_length(r.errors) > 0`);
    if (filter.withWarnings) qb.andWhere(`jsonb_array_length(r.warnings) > 0`);
    if (filter.decision) qb.andWhere('r.decision = :d', { d: filter.decision });
    if (filter.result) qb.andWhere('r.result = :res', { res: filter.result });
    const [items, total] = await qb.getManyAndCount();
    return paginate(items, total, pagination);
  }

  visibleRaw(raw: string[], actor: JwtAccessPayload): string[] {
    return actorHas(actor, ValidPermissions.VIEW_GROWTH_CONTACT_DATA)
      ? raw
      : maskRawRow(raw);
  }

  templates(target: T): Promise<ImportMappingTemplate[]> {
    return this.dataSource.manager.find(ImportMappingTemplate, {
      where: { target },
      order: { name: 'ASC' },
      take: 100,
    });
  }

  // ── Mapear (y validar en cola) ───────────────────────────────────────────

  async map(
    input: GrowthMapImportInput,
    actor: JwtAccessPayload,
  ): Promise<ImportBatch> {
    const batch = await this.dataSource.transaction(async (manager) => {
      const batch = await this.get(input.batchId, actor, manager, true);
      assertStatus(batch, [S.UPLOADED, S.MAPPED, S.VALIDATED], 'mapear');
      const mapping = input.mapping.map((m) => ({
        column: m.column,
        field: m.field,
      }));
      const problems = mappingProblems(
        batch.target,
        batch.headers.length,
        mapping,
      );
      const hasChannels = mapping.some(
        (m) => m.field === F.EMAIL || m.field === F.PHONE,
      );
      if (
        batch.target === T.PEOPLE &&
        hasChannels &&
        !input.personChannelClass
      ) {
        problems.push(
          'Indique si los correos y teléfonos son PROFESSIONAL o DIRECT',
        );
      }
      if (batch.target !== T.PEOPLE && input.personChannelClass) {
        problems.push('La clase de canal solo aplica a personas');
      }
      if (problems.length) {
        throw new CustomError({
          message: problems.join('. '),
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GrowthErrorCode.GROWTH_IMPORT_MAPPING_INVALID,
        });
      }

      batch.columnMapping = mapping;
      batch.personChannelClass =
        batch.target === T.PEOPLE && hasChannels
          ? input.personChannelClass
          : null;
      batch.status = S.MAPPED;
      Object.assign(batch, {
        validRows: 0,
        errorRows: 0,
        duplicateRows: 0,
        validatedAt: null,
      });
      const saved = await manager.save(batch);
      await manager.update(
        ImportRow,
        { batchId: batch.id },
        {
          mapped: null,
          errors: [],
          warnings: [],
          duplicateHint: null,
          suggestedDecision: null,
          decision: null,
          decidedByUserId: null,
          linkEntityId: null,
        },
      );
      if (input.saveAsTemplate) {
        await this.saveTemplate(
          manager,
          batch,
          input.saveAsTemplate.trim(),
          actor,
        );
      }
      await this.activity.record(manager, actor, {
        action: 'IMPORT_MAPPED',
        entityType: GrowthEntityType.IMPORT_BATCH,
        entityId: batch.id,
        changes: {
          fields: mapping.map((m) => m.field),
          personChannelClass: saved.personChannelClass ?? null,
        },
      });
      return saved;
    });
    await this.queue.enqueue(IMPORT_JOBS.VALIDATE, {
      batchId: batch.id,
      mappingKey: mappingKeyOf(batch),
      actor: toJobActor(actor),
    });
    return batch;
  }

  private async saveTemplate(
    manager: EntityManager,
    batch: ImportBatch,
    name: string,
    actor: JwtAccessPayload,
  ): Promise<void> {
    const columnMapping = (batch.columnMapping ?? []).map((m) => ({
      header: batch.headers[m.column],
      field: m.field,
    }));
    const [existing]: Array<{ id: string }> = await manager.query(
      `SELECT id FROM growth.import_mapping_templates WHERE target = $1 AND lower(name) = lower($2)`,
      [batch.target, name],
    );
    let id = existing?.id;
    if (id) {
      await manager.update(ImportMappingTemplate, id, { columnMapping });
    } else {
      id = (
        await manager.save(
          manager.create(ImportMappingTemplate, {
            target: batch.target,
            name,
            columnMapping,
            createdByUserId: actor.sub,
          }),
        )
      ).id;
    }
    await this.activity.record(manager, actor, {
      action: existing ? 'IMPORT_TEMPLATE_UPDATED' : 'IMPORT_TEMPLATE_CREATED',
      entityType: GrowthEntityType.IMPORT_TEMPLATE,
      entityId: id,
      changes: { target: batch.target, name },
    });
  }

  // ── Decidir por fila ─────────────────────────────────────────────────────

  async setRowDecision(
    input: GrowthImportRowDecisionInput,
    actor: JwtAccessPayload,
  ): Promise<ImportRow> {
    return this.dataSource.transaction(async (manager) => {
      const row = await manager.findOne(ImportRow, {
        where: { id: input.rowId },
      });
      if (!row) throw notFound('Fila no encontrada');
      const batch = await this.get(row.batchId, actor, manager, true);
      assertStatus(batch, [S.VALIDATED], 'decidir filas');

      if (input.decision === D.CREATE && row.errors.length) {
        throw invalidInput('Una fila con errores no se puede crear');
      }
      let linkEntityId: string | null = null;
      if (input.decision === D.LINK_EXISTING) {
        if (!input.linkEntityId)
          throw invalidInput('Indique el registro existente');
        const kind = TARGET_KIND[batch.target];
        const record = await this.guards.findVisible<{
          mergedIntoId?: string | null;
        }>(manager, kind, input.linkEntityId, actor);
        if (record.mergedIntoId)
          throw invalidInput(
            'Ese registro fue fusionado: use el sobreviviente',
          );
        linkEntityId = input.linkEntityId;
      }
      row.decision = input.decision;
      row.linkEntityId = linkEntityId;
      row.decidedByUserId = actor.sub;
      const saved = await manager.save(row);
      // Cuenta como actividad del lote (cancelación por inactividad).
      await manager.query(
        `UPDATE growth.import_batches SET updated_at = now() WHERE id = $1`,
        [batch.id],
      );
      await this.activity.record(manager, actor, {
        action: 'IMPORT_ROW_DECIDED',
        entityType: GrowthEntityType.IMPORT_BATCH,
        entityId: batch.id,
        changes: {
          rowNumber: row.rowNumber,
          decision: input.decision,
          linkEntityId,
        },
      });
      return saved;
    });
  }

  // ── Confirmar y cancelar ─────────────────────────────────────────────────

  /**
   * Pasa a COMMITTING y encola. Repetirlo con el lote en COMMITTING vuelve a
   * encolar (el trabajo es idempotente): sirve si Redis falló al encolar.
   */
  async commit(id: string, actor: JwtAccessPayload): Promise<ImportBatch> {
    const batch = await this.dataSource.transaction(async (manager) => {
      const batch = await this.get(id, actor, manager, true);
      assertStatus(batch, [S.VALIDATED, S.COMMITTING], 'confirmar');
      if (batch.status === S.COMMITTING) return batch;
      await this.guards.assertSourceUsable(manager, batch);
      batch.status = S.COMMITTING;
      batch.committedByUserId = actor.sub;
      const saved = await manager.save(batch);
      const [plan]: Array<Record<string, string>> = await manager.query(
        `SELECT count(*) FILTER (WHERE decision = 'CREATE') AS "create",
                count(*) FILTER (WHERE decision = 'LINK_EXISTING') AS "link",
                count(*) FILTER (WHERE decision = 'SKIP' OR decision IS NULL) AS "skip"
           FROM growth.import_rows WHERE batch_id = $1`,
        [id],
      );
      await this.activity.record(manager, actor, {
        action: 'IMPORT_COMMIT_REQUESTED',
        entityType: GrowthEntityType.IMPORT_BATCH,
        entityId: id,
        changes: {
          create: Number(plan.create),
          link: Number(plan.link),
          skip: Number(plan.skip),
        },
      });
      return saved;
    });
    await this.queue.enqueue(IMPORT_JOBS.COMMIT, {
      batchId: batch.id,
      actor: toJobActor(actor),
    });
    return batch;
  }

  async cancel(
    id: string,
    reason: string,
    actor: JwtAccessPayload,
  ): Promise<ImportBatch> {
    return this.dataSource.transaction(async (manager) => {
      const batch = await this.get(id, actor, manager, true);
      assertStatus(
        batch,
        [S.UPLOADED, S.MAPPED, S.VALIDATING, S.VALIDATED],
        'cancelar',
      );
      batch.status = S.CANCELLED;
      batch.statusReason = reason.trim();
      batch.finishedAt = new Date();
      const saved = await manager.save(batch);
      await this.activity.record(manager, actor, {
        action: 'IMPORT_CANCELLED',
        entityType: GrowthEntityType.IMPORT_BATCH,
        entityId: id,
        changes: { reason: batch.statusReason },
      });
      return saved;
    });
  }

  // ── Informe ──────────────────────────────────────────────────────────────

  async report(
    id: string,
    actor: JwtAccessPayload,
  ): Promise<{ fileName: string; content: Buffer }> {
    const batch = await this.get(id, actor);
    if (batch.purgedAt) {
      throw new CustomError({
        message:
          'El lote ya se purgó: el informe con los datos originales no está disponible',
        statusCode: HttpStatus.GONE,
        errorCode: GrowthErrorCode.GROWTH_IMPORT_PURGED,
      });
    }
    const rows = await this.dataSource.manager.find(ImportRow, {
      where: { batchId: id },
      order: { rowNumber: 'ASC' },
    });
    const issues = (r: ImportRow) =>
      [
        ...r.errors.map((e) => ({ ...e, kind: 'Error' })),
        ...r.warnings.map((w) => ({ ...w, kind: 'Aviso' })),
      ]
        .map(
          (i) =>
            `${i.kind}${i.field ? ` en ${i.field}` : ''}: ${ISSUE_LABELS[i.code] ?? i.code}`,
        )
        .concat(r.resultError ? [`Error al confirmar: ${r.resultError}`] : [])
        .join('; ');
    const content = await buildImportReport(
      batch.headers,
      [
        { label: 'Lote', value: batch.id },
        { label: 'Destino', value: batch.target },
        { label: 'Estado', value: batch.status },
        { label: 'Filas', value: batch.totalRows },
        { label: 'Filas válidas', value: batch.validRows },
        { label: 'Filas con errores', value: batch.errorRows },
        { label: 'Posibles duplicados', value: batch.duplicateRows },
        {
          label: 'Datos excluidos (no guardados)',
          value: batch.suppressedValues,
        },
        { label: 'Creados', value: batch.createdRows },
        { label: 'Vinculados', value: batch.linkedRows },
        { label: 'Omitidos', value: batch.skippedRows },
        { label: 'Fallidos', value: batch.failedRows },
        {
          label: 'Se purga',
          value: batch.finishedAt
            ? new Date(batch.finishedAt.getTime() + 30 * 86_400_000)
                .toISOString()
                .slice(0, 10)
            : 'a los 30 días de terminar el lote',
        },
      ],
      rows.map((r) => ({
        rowNumber: r.rowNumber,
        decision: r.decision ?? null,
        result: r.result ?? null,
        issues: issues(r),
        raw: this.visibleRaw(r.raw ?? [], actor),
      })),
    );
    await this.dataSource.transaction((manager) =>
      this.activity.record(manager, actor, {
        action: 'IMPORT_REPORT_DOWNLOADED',
        entityType: GrowthEntityType.IMPORT_BATCH,
        entityId: id,
        changes: null,
      }),
    );
    return { fileName: `informe-importacion-${id.slice(0, 8)}.xlsx`, content };
  }

  /** Para el procesador: marcar FAILED cuando la cola agotó los reintentos. */
  async markFailed(id: string, reason: string): Promise<void> {
    await this.dataSource.transaction(async (manager) => {
      const [batch]: Array<{ status: S }> = await manager.query(
        `SELECT status FROM growth.import_batches WHERE id = $1 FOR UPDATE`,
        [id],
      );
      if (
        !batch ||
        ![S.MAPPED, S.VALIDATING, S.COMMITTING].includes(batch.status)
      )
        return;
      await manager.update(ImportBatch, id, {
        status: S.FAILED,
        statusReason: reason.slice(0, 500),
        finishedAt: new Date(),
      });
      await this.activity.recordSystem(manager, {
        action: 'IMPORT_FAILED',
        entityType: GrowthEntityType.IMPORT_BATCH,
        entityId: id,
        changes: { previousStatus: batch.status },
      });
    });
  }
}

function assertStatus(batch: ImportBatch, allowed: S[], action: string): void {
  if (batch.purgedAt || !allowed.includes(batch.status)) {
    throw new CustomError({
      message: `No se puede ${action} un lote en estado ${batch.status}`,
      statusCode: HttpStatus.CONFLICT,
      errorCode: GrowthErrorCode.GROWTH_IMPORT_INVALID_STATE,
    });
  }
}

function invalidFile(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: GrowthErrorCode.GROWTH_IMPORT_FILE_INVALID,
  });
}

function invalidInput(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.BAD_REQUEST,
    errorCode: GrowthErrorCode.GROWTH_INVALID_INPUT,
  });
}

function notFound(message: string): CustomError {
  return new CustomError({
    message,
    statusCode: HttpStatus.NOT_FOUND,
    errorCode: GrowthErrorCode.GROWTH_NOT_FOUND,
  });
}

/** Solo el nombre (sin rutas) y sin caracteres de control. */
export function safeFileName(name: string | undefined): string {
  const base = (name ?? 'archivo').split(/[\\/]/).pop() ?? 'archivo';
  // eslint-disable-next-line no-control-regex
  return base.replace(/[\u0000-\u001f\u007f]/g, '').slice(0, 255) || 'archivo';
}
