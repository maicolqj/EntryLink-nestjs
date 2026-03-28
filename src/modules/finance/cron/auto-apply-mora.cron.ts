import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository }         from 'typeorm';

import { ComplexFinanceConfig } from '../entities/complex-finance-config.entity';
import { FinanceService }       from '../services/finance.service';
import { ComplexStatus }        from '../../residential-complex/enums/complex-status.enum';

/**
 * Cron diario a las 00:10 AM (Bogotá) que aplica mora automáticamente
 * a los cargos vencidos de los complejos con `autoApplyMora = true`.
 *
 * Lógica por complejo:
 *  1. Llama a applyMoraInternal con la tasa y días de gracia configurados.
 *  2. El servicio verifica individualmente que dueDate + graceDays < hoy.
 *  3. El servicio evita mora doble (idempotente por descripción + período).
 *  4. El período de las nuevas notas de mora = mes actual (YYYY-MM de hoy).
 */
@Injectable()
export class AutoApplyMoraCron {
  private readonly logger = new Logger(AutoApplyMoraCron.name);

  constructor(
    @InjectRepository(ComplexFinanceConfig)
    private readonly financeConfigRepo: Repository<ComplexFinanceConfig>,
    private readonly financeService: FinanceService,
  ) {}

  @Cron('10 0 * * *', { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    const today  = new Date();
    const month  = today.getMonth() + 1;
    const year   = today.getFullYear();
    const period = `${year}-${String(month).padStart(2, '0')}`;

    // Complejos activos con autoApplyMora=true
    const configs = await this.financeConfigRepo
      .createQueryBuilder('cfg')
      .innerJoin('cfg.complex', 'complex')
      .where('cfg.autoApplyMora = true')
      .andWhere('complex.status = :status', { status: ComplexStatus.ACTIVE })
      .getMany();

    if (!configs.length) return;

    this.logger.log(
      `[AutoApplyMora] Ejecutando para período ${period} ` +
      `— ${configs.length} complejo(s) candidatos`,
    );

    let processedComplexes = 0;

    for (const cfg of configs) {
      try {
        const result = await this.financeService.applyMoraInternal(
          cfg.complexId,
          period,
          Number(cfg.moraRate),
          cfg.moraGraceDays,
        );

        if (result.applied > 0 || result.skipped > 0) {
          this.logger.log(
            `[AutoApplyMora] Complejo ${cfg.complexId} | período ${period} ` +
            `→ ${result.applied} mora(s) aplicada(s) ($${result.totalMoraAmount}), ` +
            `${result.skipped} omitido(s)`,
          );
          processedComplexes++;
        }
      } catch (err) {
        this.logger.error(
          `[AutoApplyMora] Error en complejo ${cfg.complexId}: ${err?.message}`,
          err?.stack,
        );
      }
    }

    if (processedComplexes > 0) {
      this.logger.log(
        `[AutoApplyMora] Completado: ${processedComplexes} complejo(s) procesados para ${period}`,
      );
    }
  }
}
