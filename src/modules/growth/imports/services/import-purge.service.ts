import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ActivityLogService } from '../../activity/services/activity-log.service';
import { GrowthEntityType } from '../../shared/growth.enums';

export const IMPORT_RETENTION_DAYS = 30;
/** Un lote sin terminar y sin actividad en estos días se cierra solo. */
export const IMPORT_INACTIVITY_DAYS = 7;

/**
 * Ajuste D: 30 días después de que un lote termina (COMMITTED, FAILED o
 * CANCELLED) quedan en NULL las filas crudas, los valores normalizados y las
 * pistas de duplicado. Se conservan número de fila, errores (sin valores),
 * decisión y resultado. El archivo original nunca se guardó.
 *
 * Un lote abandonado no terminaría nunca: tras 7 días sin actividad se
 * cancela (o queda FAILED si estaba confirmando) y desde ahí corre el plazo
 * de 30 días. Un lote con retención legal activa no se purga. Los eventos
 * llevan lote, conteos y fecha, nunca datos.
 */
@Injectable()
export class ImportPurgeService {
  private readonly logger = new Logger(ImportPurgeService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly activity: ActivityLogService,
  ) {}

  @Cron('45 3 * * *', {
    name: 'growth-import-purge',
    timeZone: 'America/Bogota',
  })
  async runScheduled(): Promise<void> {
    try {
      const expired = await this.expireInactive();
      const purged = await this.purgeDue();
      if (expired || purged) {
        this.logger.log(
          `Importaciones: ${expired} lote(s) cerrados por inactividad, ${purged} purgado(s)`,
        );
      }
    } catch (error) {
      this.logger.error(`Purga de importaciones falló: ${String(error)}`);
    }
  }

  /** Cierra los lotes sin terminar e inactivos. `now` es inyectable para las pruebas. */
  async expireInactive(now = new Date()): Promise<number> {
    const stale: Array<{ id: string; status: string }> =
      await this.dataSource.query(
        `SELECT id, status FROM growth.import_batches
          WHERE finished_at IS NULL
            AND updated_at <= $1::timestamptz - make_interval(days => $2)
          ORDER BY updated_at
          LIMIT 500`,
        [now.toISOString(), IMPORT_INACTIVITY_DAYS],
      );
    for (const { id, status } of stale) {
      // COMMITTING no se puede cancelar (ya pudo crear registros): queda FAILED.
      const next = status === 'COMMITTING' ? 'FAILED' : 'CANCELLED';
      await this.dataSource.transaction(async (manager) => {
        const [, changed]: [unknown[], number] = await manager.query(
          `UPDATE growth.import_batches
              SET status = $2, status_reason = $3, finished_at = $4, updated_at = now()
            WHERE id = $1 AND status = $5 AND finished_at IS NULL`,
          [
            id,
            next,
            `Cerrado por inactividad (${IMPORT_INACTIVITY_DAYS} días sin cambios)`,
            now.toISOString(),
            status,
          ],
        );
        if (!changed) return;
        await this.activity.recordSystem(manager, {
          action: 'IMPORT_EXPIRED',
          entityType: GrowthEntityType.IMPORT_BATCH,
          entityId: id,
          changes: { previousStatus: status, status: next },
        });
      });
    }
    return stale.length;
  }

  /** Devuelve cuántos lotes purgó. `now` es inyectable para las pruebas. */
  async purgeDue(now = new Date()): Promise<number> {
    const due: Array<{ id: string }> = await this.dataSource.query(
      `SELECT b.id FROM growth.import_batches b
        WHERE b.purged_at IS NULL AND b.finished_at IS NOT NULL
          AND b.finished_at <= $1::timestamptz - make_interval(days => $2)
          AND NOT EXISTS (
            SELECT 1 FROM growth.legal_holds h
             WHERE h.entity_type = 'IMPORT_BATCH' AND h.entity_id = b.id
               AND h.released_at IS NULL AND h.hold_until >= $1::date)
        ORDER BY b.finished_at
        LIMIT 200`,
      [now.toISOString(), IMPORT_RETENTION_DAYS],
    );
    for (const { id } of due) {
      await this.dataSource.transaction(async (manager) => {
        const [, rows]: [unknown[], number] = await manager.query(
          `UPDATE growth.import_rows SET raw = NULL, mapped = NULL, duplicate_hint = NULL
            WHERE batch_id = $1 AND (raw IS NOT NULL OR mapped IS NOT NULL OR duplicate_hint IS NOT NULL)`,
          [id],
        );
        await manager.query(
          `UPDATE growth.import_batches SET purged_at = $2, updated_at = now() WHERE id = $1`,
          [id, now.toISOString()],
        );
        await this.activity.recordSystem(manager, {
          action: 'IMPORT_PURGED',
          entityType: GrowthEntityType.IMPORT_BATCH,
          entityId: id,
          changes: {
            rowsCleared: Number(rows ?? 0),
            purgedAt: now.toISOString(),
          },
        });
      });
    }
    return due.length;
  }
}
