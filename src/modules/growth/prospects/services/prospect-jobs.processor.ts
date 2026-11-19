import { OnWorkerEvent, Processor, WorkerHost } from '@nestjs/bullmq';
import { Logger } from '@nestjs/common';
import { InjectDataSource } from '@nestjs/typeorm';
import { Job } from 'bullmq';
import { DataSource } from 'typeorm';
import { GrowthProspectKind } from '../prospects.enums';
import { DedupeService } from './dedupe.service';
import {
  GROWTH_JOBS,
  GROWTH_PROSPECTS_QUEUE,
  GrowthProspectJob,
} from './prospect-events.service';
import { ScoringService } from './scoring.service';

/** Worker de la cola growth-prospects: duplicados y scoring. */
@Processor(GROWTH_PROSPECTS_QUEUE)
export class ProspectJobsProcessor extends WorkerHost {
  private readonly logger = new Logger(ProspectJobsProcessor.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly dedupe: DedupeService,
    private readonly scoring: ScoringService,
  ) {
    super();
  }

  @OnWorkerEvent('failed')
  onFailed(job: Job | undefined, error: Error): void {
    this.logger.error(
      `Trabajo ${job?.name ?? '?'} (${job?.id ?? '?'}) falló: ${error.message}`,
    );
  }

  async process(job: Job<GrowthProspectJob>): Promise<void> {
    switch (job.name) {
      case GROWTH_JOBS.SCAN:
        await this.dedupe.scan(job.data.kind, job.data.id);
        return;
      case GROWTH_JOBS.SCORE:
        await this.score(job.data.kind, job.data.id);
        return;
      case GROWTH_JOBS.RESCORE_ALL:
        for (const target of await this.scoring.scorableIds()) {
          await this.scoring.recompute(target.kind, target.id);
        }
        return;
      default:
        this.logger.warn(`Trabajo desconocido: ${job.name}`);
    }
  }

  /**
   * Una copropiedad no tiene puntaje propio: cambiarla altera el de quienes
   * la administran (vigente o histórico reciente), que se recalculan.
   */
  async score(kind: GrowthProspectKind, id: string): Promise<void> {
    if (kind !== GrowthProspectKind.PROPERTY) {
      await this.scoring.recompute(kind, id);
      return;
    }
    const managers: Array<{
      organization_id: string | null;
      person_id: string | null;
    }> = await this.dataSource.query(
      `SELECT DISTINCT organization_id, person_id FROM growth.property_managements WHERE property_id = $1`,
      [id],
    );
    for (const m of managers) {
      if (m.organization_id)
        await this.scoring.recompute(
          GrowthProspectKind.ORGANIZATION,
          m.organization_id,
        );
      if (m.person_id)
        await this.scoring.recompute(GrowthProspectKind.PERSON, m.person_id);
    }
  }
}
