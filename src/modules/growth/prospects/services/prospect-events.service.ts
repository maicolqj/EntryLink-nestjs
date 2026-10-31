import { InjectQueue } from '@nestjs/bullmq';
import { Injectable, Logger } from '@nestjs/common';
import { Queue } from 'bullmq';
import { GrowthProspectKind } from '../prospects.enums';

export const GROWTH_PROSPECTS_QUEUE = 'growth-prospects';

export const GROWTH_JOBS = {
  /** Buscar posibles duplicados de un registro. */
  SCAN: 'scan',
  /** Recalcular el puntaje (en copropiedades: el de quien las administra). */
  SCORE: 'score',
  /** Recalcular todos los puntajes tras un cambio de reglas. */
  RESCORE_ALL: 'rescore-all',
} as const;

export interface GrowthProspectJob {
  kind: GrowthProspectKind;
  id: string;
}

/**
 * Encola trabajos derivados (duplicados y scoring) DESPUÉS de que el cambio
 * se confirmó. El jobId estable hace que varios cambios seguidos del mismo
 * registro se coalescan en un solo trabajo pendiente. Si Redis falla, el
 * cambio ya está guardado: solo se registra el error (el trabajo se puede
 * relanzar con growthScanDuplicates o growthRescoreAll).
 */
@Injectable()
export class ProspectEventsService {
  private readonly logger = new Logger(ProspectEventsService.name);

  constructor(
    @InjectQueue(GROWTH_PROSPECTS_QUEUE) private readonly queue: Queue,
  ) {}

  async changed(
    kind: GrowthProspectKind,
    id: string,
    options: { dedupe?: boolean } = {},
  ): Promise<void> {
    const jobs: Array<{ name: string; jobId: string }> = [
      { name: GROWTH_JOBS.SCORE, jobId: `score:${kind}:${id}` },
    ];
    if (options.dedupe)
      jobs.push({ name: GROWTH_JOBS.SCAN, jobId: `scan:${kind}:${id}` });
    for (const job of jobs) {
      await this.add(job.name, { kind, id }, job.jobId);
    }
  }

  /** Encola tras un cambio confirmado y devuelve el resultado intacto. */
  async after<T>(
    result: T,
    kind: GrowthProspectKind,
    id: string,
    dedupe = false,
  ): Promise<T> {
    await this.changed(kind, id, { dedupe });
    return result;
  }

  async rescoreAll(): Promise<void> {
    await this.add(GROWTH_JOBS.RESCORE_ALL, {}, `rescore-all:${Date.now()}`);
  }

  private async add(name: string, data: object, jobId: string): Promise<void> {
    try {
      await this.queue.add(name, data, {
        jobId,
        attempts: 3,
        backoff: { type: 'exponential', delay: 5_000 },
        removeOnComplete: true,
        removeOnFail: 50,
      });
    } catch (error) {
      this.logger.error(
        `No se pudo encolar ${name} (${jobId}): ${String(error)}`,
      );
    }
  }
}
