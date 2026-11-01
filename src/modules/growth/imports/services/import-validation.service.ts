import { Injectable, Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource, EntityManager } from 'typeorm';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { SuppressionsService } from '../../compliance/services/suppressions.service';
import {
  GrowthEntityType,
  GrowthIdentifierType,
} from '../../shared/growth.enums';
import { ImportBatch, ImportRow } from '../entities/import.entities';
import {
  GrowthImportDecision as D,
  GrowthImportField as F,
  GrowthImportStatus as S,
  GrowthImportTarget as T,
} from '../imports.enums';
import {
  ImportIssueValue,
  ImportMatchKeys,
  normalizeRow,
} from '../shared/row-normalizer';
import { fromJobActor, ImportJobActor } from './import-queue.service';

type KeyName = keyof ImportMatchKeys;

/** Claves que, repetidas dentro del archivo, hacen saltar la fila posterior. */
const IN_FILE_STRONG: Record<T, KeyName[]> = {
  [T.ORGANIZATIONS]: ['nit', 'email'],
  [T.PROPERTIES]: ['nit', 'registration'],
  [T.PEOPLE]: ['email'],
};

/** Coincidencias en la base que sugieren LINK_EXISTING (si apuntan a un solo registro). */
const LINK_KEYS: Record<T, KeyName[]> = {
  [T.ORGANIZATIONS]: ['nit'],
  [T.PROPERTIES]: ['nit', 'registration'],
  [T.PEOPLE]: ['email'],
};

const SIGNAL: Record<KeyName, string> = {
  nit: 'NIT',
  registration: 'REGISTRATION',
  email: 'EMAIL',
  phone: 'PHONE',
  domain: 'DOMAIN',
  address: 'ADDRESS',
};

interface RowOutcome {
  id: string;
  mapped: Record<string, unknown>;
  errors: ImportIssueValue[];
  warnings: ImportIssueValue[];
  hint: {
    matchedOn: string[];
    existingIds: string[];
    sameFileRow: number | null;
  } | null;
  decision: D;
  linkEntityId: string | null;
  suppressed: number;
}

/**
 * Paso 4 del flujo: normaliza, valida, cruza la lista de exclusión y marca
 * duplicados exactos (contra la base y dentro del archivo). Propone una
 * decisión por fila; no crea nada.
 */
@Injectable()
export class ImportValidationService {
  private readonly logger = new Logger(ImportValidationService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly suppressions: SuppressionsService,
    private readonly activity: ActivityLogService,
  ) {}

  async validate(
    batchId: string,
    mappingKey: string,
    actor: ImportJobActor,
  ): Promise<void> {
    const manager = this.dataSource.manager;
    const batch = await manager.findOne(ImportBatch, {
      where: { id: batchId },
    });
    if (!batch || ![S.MAPPED, S.VALIDATING].includes(batch.status)) return;
    if (mappingKeyOf(batch) !== mappingKey) return; // lo reemplazó un mapeo más nuevo

    await manager.query(
      `UPDATE growth.import_batches SET status = 'VALIDATING', updated_at = now() WHERE id = $1 AND status = 'MAPPED'`,
      [batchId],
    );

    const rows = await manager.find(ImportRow, {
      where: { batchId },
      order: { rowNumber: 'ASC' },
    });
    const outcomes = await this.evaluate(manager, batch, rows);

    await this.dataSource.transaction(async (tx) => {
      const locked = await tx.findOne(ImportBatch, {
        where: { id: batchId },
        lock: { mode: 'pessimistic_write' },
      });
      // Cancelado mientras tanto, o lo reemplazó un mapeo más nuevo (su
      // trabajo encuentra el lote en VALIDATING y lo termina).
      if (locked?.status !== S.VALIDATING) return;
      if (mappingKeyOf(locked) !== mappingKey) return;

      for (const o of outcomes) {
        await tx.update(ImportRow, o.id, {
          mapped: o.mapped,
          errors: o.errors,
          warnings: o.warnings,
          duplicateHint: o.hint,
          suggestedDecision: o.decision,
          decision: o.decision,
          linkEntityId: o.linkEntityId,
          decidedByUserId: null,
        });
      }
      const counts = {
        validRows: outcomes.filter((o) => !o.errors.length).length,
        errorRows: outcomes.filter((o) => o.errors.length).length,
        duplicateRows: outcomes.filter((o) => o.hint).length,
        suppressedValues: outcomes.reduce((n, o) => n + o.suppressed, 0),
      };
      await tx.update(ImportBatch, batchId, {
        ...counts,
        status: S.VALIDATED,
        validatedAt: new Date(),
      });
      await this.activity.record(tx, fromJobActor(actor), {
        action: 'IMPORT_VALIDATED',
        entityType: GrowthEntityType.IMPORT_BATCH,
        entityId: batchId,
        changes: { totalRows: batch.totalRows, ...counts },
      });
    });
  }

  private async evaluate(
    manager: EntityManager,
    batch: ImportBatch,
    rows: ImportRow[],
  ): Promise<RowOutcome[]> {
    const mapping = batch.columnMapping ?? [];
    const prepared: Array<{
      row: ImportRow;
      normalized: ReturnType<typeof normalizeRow>;
      warnings: ImportIssueValue[];
      suppressed: number;
    }> = [];

    for (const row of rows) {
      const normalized = normalizeRow(batch.target, row.raw ?? [], mapping);
      const warnings: ImportIssueValue[] = [];
      let suppressed = 0;
      // Lista de exclusión: el dato excluido no se guarda en ninguna parte.
      for (const [field, key, type] of [
        [F.EMAIL, 'email', GrowthIdentifierType.EMAIL],
        [F.PHONE, 'phone', GrowthIdentifierType.PHONE],
      ] as const) {
        const value = normalized.values[field];
        if (typeof value !== 'string') continue;
        if (
          await this.suppressions.isSuppressed({ identifierType: type, value })
        ) {
          delete normalized.values[field];
          delete normalized.keys[key];
          warnings.push({ field, code: 'SUPPRESSED' });
          suppressed++;
        }
      }
      prepared.push({ row, normalized, warnings, suppressed });
    }

    const existing = await this.findExisting(
      manager,
      batch.target,
      prepared.map((p) => p.normalized.keys),
    );

    const firstSeen = new Map<string, number>();
    return prepared.map(({ row, normalized, warnings, suppressed }) => {
      const matchedOn = new Set<string>();
      const existingIds = new Set<string>();
      let linkCandidate: string | null = null;
      let linkAmbiguous = false;
      let sameFileRow: number | null = null;

      for (const key of Object.keys(normalized.keys) as KeyName[]) {
        const value = normalized.keys[key];
        const ids = existing.get(`${key}:${value}`) ?? [];
        if (ids.length) {
          matchedOn.add(SIGNAL[key]);
          ids.forEach((id) => existingIds.add(id));
          if (LINK_KEYS[batch.target].includes(key)) {
            if (ids.length > 1 || (linkCandidate && linkCandidate !== ids[0]))
              linkAmbiguous = true;
            else linkCandidate = ids[0];
          }
        }
        const seenKey = `${key}:${value}`;
        const seen = firstSeen.get(seenKey);
        if (seen === undefined) firstSeen.set(seenKey, row.rowNumber);
        else if (IN_FILE_STRONG[batch.target].includes(key)) {
          sameFileRow = sameFileRow ?? seen;
          matchedOn.add(SIGNAL[key]);
        }
      }

      let decision = D.CREATE;
      let linkEntityId: string | null = null;
      if (normalized.errors.length) decision = D.SKIP;
      else if (sameFileRow !== null) {
        decision = D.SKIP;
        warnings.push({ code: 'DUPLICATE_IN_FILE' });
      } else if (linkCandidate && !linkAmbiguous) {
        decision = D.LINK_EXISTING;
        linkEntityId = linkCandidate;
        warnings.push({ code: 'MATCHES_EXISTING' });
      } else if (existingIds.size) {
        warnings.push({ code: 'MATCHES_EXISTING' });
      }

      return {
        id: row.id,
        mapped: normalized.values,
        errors: normalized.errors,
        warnings,
        hint: matchedOn.size
          ? {
              matchedOn: [...matchedOn].sort(),
              existingIds: [...existingIds],
              sameFileRow,
            }
          : null,
        decision,
        linkEntityId,
        suppressed,
      };
    });
  }

  /** Coincidencias exactas en la base, consultadas por lotes (no fila por fila). */
  private async findExisting(
    manager: EntityManager,
    target: T,
    keys: ImportMatchKeys[],
  ): Promise<Map<string, string[]>> {
    const values = (k: KeyName) => [
      ...new Set(keys.map((x) => x[k]).filter((v): v is string => !!v)),
    ];
    const out = new Map<string, string[]>();
    const collect = async (k: KeyName, sql: string) => {
      const list = values(k);
      if (!list.length) return;
      const rows: Array<{ id: string; v: string }> = await manager.query(sql, [
        list,
      ]);
      for (const r of rows) {
        const key = `${k}:${r.v}`;
        out.set(key, [...new Set([...(out.get(key) ?? []), r.id])]);
      }
    };
    const alive = (a: string) =>
      `${a}.deleted_at IS NULL AND ${a}.merged_into_id IS NULL`;
    const channel = (
      table: string,
      owner: string,
      ownerTable: string,
      kind: string,
    ) =>
      `SELECT c.${owner} AS id, c.value_normalized AS v FROM growth.${table} c
         JOIN growth.${ownerTable} o ON o.id = c.${owner}
        WHERE c.kind = '${kind}' AND c.deleted_at IS NULL AND ${alive('o')}
          AND c.value_normalized = ANY($1::text[])`;

    if (target === T.ORGANIZATIONS) {
      await collect(
        'nit',
        `SELECT id, nit AS v FROM growth.organizations o WHERE ${alive('o')} AND nit = ANY($1::text[])`,
      );
      await collect(
        'domain',
        `SELECT id, domain AS v FROM growth.organizations o WHERE ${alive('o')} AND domain = ANY($1::text[])`,
      );
      await collect(
        'address',
        `SELECT id, address_normalized AS v FROM growth.organizations o WHERE ${alive('o')} AND address_normalized = ANY($1::text[])`,
      );
      await collect(
        'email',
        channel(
          'organization_channels',
          'organization_id',
          'organizations',
          'EMAIL',
        ),
      );
      await collect(
        'phone',
        channel(
          'organization_channels',
          'organization_id',
          'organizations',
          'PHONE',
        ),
      );
    } else if (target === T.PROPERTIES) {
      await collect(
        'nit',
        `SELECT id, nit AS v FROM growth.properties o WHERE ${alive('o')} AND nit = ANY($1::text[])`,
      );
      await collect(
        'registration',
        `SELECT id, real_estate_registration AS v FROM growth.properties o WHERE ${alive('o')} AND real_estate_registration = ANY($1::text[])`,
      );
      await collect(
        'address',
        `SELECT id, address_normalized AS v FROM growth.properties o WHERE ${alive('o')} AND address_normalized = ANY($1::text[])`,
      );
    } else {
      await collect(
        'email',
        channel('person_channels', 'person_id', 'people', 'EMAIL'),
      );
      await collect(
        'phone',
        channel('person_channels', 'person_id', 'people', 'PHONE'),
      );
    }
    return out;
  }
}

/** Identifica el mapeo vigente: un trabajo de un mapeo viejo no escribe. */
export function mappingKeyOf(
  batch: Pick<ImportBatch, 'columnMapping' | 'personChannelClass'>,
): string {
  // Por valores, no por objeto: jsonb reordena las claves al guardar.
  return JSON.stringify([
    (batch.columnMapping ?? []).map((m) => [m.column, m.field]),
    batch.personChannelClass ?? null,
  ]);
}
