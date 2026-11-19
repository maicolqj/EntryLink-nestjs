import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectDataSource } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';
import { ScoringVersionsService } from './scoring-versions.service';

const CATCHUP_LOCK = 'growth-scoring-catchup';

/**
 * Recuperación del recálculo: cada 10 minutos pone al día los puntajes que
 * no están calculados con la versión activa (si Redis falló al encolar, si
 * el trabajo agotó sus reintentos o si se cayó a mitad). Toma un lock
 * consultivo sin esperar: con varias réplicas, solo una trabaja.
 */
@Injectable()
export class ScoringCatchupService {
  private readonly logger = new Logger(ScoringCatchupService.name);

  constructor(
    @InjectDataSource() private readonly dataSource: DataSource,
    private readonly versions: ScoringVersionsService,
  ) {}

  @Cron('*/10 * * * *', {
    name: 'growth-scoring-catchup',
    timeZone: 'America/Bogota',
  })
  async runScheduled(): Promise<void> {
    try {
      await this.catchUp();
    } catch (error) {
      this.logger.error(`Puesta al día del scoring: ${String(error)}`);
    }
  }

  /** Devuelve cuántos puntajes recalculó (0 si otra réplica trabaja). */
  async catchUp(limit = 500): Promise<number> {
    const runner = this.dataSource.createQueryRunner();
    await runner.connect();
    try {
      const [{ locked }] = (await runner.query(
        `SELECT pg_try_advisory_lock(hashtextextended($1, 0)) AS locked`,
        [CATCHUP_LOCK],
      )) as Array<{ locked: boolean }>;
      if (!locked) return 0;
      try {
        return await this.versions.rescorePending(limit);
      } finally {
        await runner.query(
          `SELECT pg_advisory_unlock(hashtextextended($1, 0))`,
          [CATCHUP_LOCK],
        );
      }
    } finally {
      await runner.release();
    }
  }
}
