import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository }         from 'typeorm';

import { ComplexFinanceConfig } from '../entities/complex-finance-config.entity';
import { FeeConfig }            from '../entities/fee-config.entity';
import { FinanceService }       from '../services/finance.service';
import { ComplexStatus }        from '../../residential-complex/enums/complex-status.enum';

/**
 * Cron diario 00:05 AM (Bogotá): emite los cargos de los períodos que falten
 * hasta el mes en curso, para los complejos con `autoGenerateCharges = true`.
 *
 * Corre todos los días, no solo el 1, porque una sola corrida mensual perdida
 * (proceso caído, despliegue, entorno apagado) dejaba un hueco permanente en la
 * cartera. El catch-up recupera esos meses en la siguiente corrida; en el caso
 * normal el día 1 emite el mes que arranca y los demás días no hacen nada.
 *
 * Nunca emite un período futuro, y `dueDayOfMonth` ya no dispara la emisión:
 * quedó solo como corte de pronto pago.
 */
@Injectable()
export class AutoGenerateChargesCron {
  private readonly logger = new Logger(AutoGenerateChargesCron.name);

  constructor(
    @InjectRepository(ComplexFinanceConfig)
    private readonly financeConfigRepo: Repository<ComplexFinanceConfig>,
    @InjectRepository(FeeConfig)
    private readonly feeConfigRepo: Repository<FeeConfig>,
    private readonly financeService: FinanceService,
  ) {}

  @Cron('5 0 * * *', { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    // Mes en curso (America/Bogota via TZ env). Es el tope: nunca se emite futuro.
    const today  = new Date();
    const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    // Cargar configs activas que tienen autoGenerateCharges=true
    // y cuyo complejo está ACTIVO
    const configs = await this.financeConfigRepo
      .createQueryBuilder('cfg')
      .innerJoin('cfg.complex', 'complex')
      .where('cfg.autoGenerateCharges = true')
      .andWhere('complex.status = :status', { status: ComplexStatus.ACTIVE })
      .select(['cfg.complexId', 'cfg.id'])
      .getMany();

    if (!configs.length) return;

    // Debug: corre a diario y la mayoría de los días no hay nada que emitir.
    this.logger.debug(
      `[AutoGenerateCharges] Revisando hasta ${period} ` +
      `— ${configs.length} complejo(s) candidatos`,
    );

    let processedComplexes = 0;

    for (const cfg of configs) {
      const complexId = cfg.complexId;

      // Sin conceptos activos no hay nada que emitir
      const activeConfigs = await this.feeConfigRepo.count({
        where: { complexId, isActive: true, deletedAt: null as any },
      });

      if (!activeConfigs) continue;

      try {
        const result = await this.financeService.generateMissingChargesInternal(complexId, period);
        if (result.generated > 0) {
          this.logger.log(
            `[AutoGenerateCharges] Complejo ${complexId} | períodos ${result.periods.join(', ')} ` +
            `→ ${result.generated} generados, ${result.skipped} omitidos`,
          );
        }
        processedComplexes++;
      } catch (err) {
        this.logger.error(
          `[AutoGenerateCharges] Error en complejo ${complexId}: ${err?.message}`,
          err?.stack,
        );
      }
    }

    if (processedComplexes > 0) {
      this.logger.debug(
        `[AutoGenerateCharges] Completado: ${processedComplexes} complejo(s) revisados hasta ${period}`,
      );
    }
  }
}
