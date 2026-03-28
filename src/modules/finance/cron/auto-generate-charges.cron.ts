import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository }         from 'typeorm';

import { ComplexFinanceConfig } from '../entities/complex-finance-config.entity';
import { FeeConfig }            from '../entities/fee-config.entity';
import { FinanceService }       from '../services/finance.service';
import { ComplexStatus }        from '../../residential-complex/enums/complex-status.enum';

/**
 * Cron diario a las 00:05 AM (Bogotá) que genera cargos automáticamente
 * para los complejos que tienen `autoGenerateCharges = true`.
 *
 * Lógica por complejo:
 *  1. Obtiene todas las FeeConfigs activas.
 *  2. Para cada FeeConfig, calcula el "día efectivo de vencimiento"
 *     del mes anterior (min(dueDayOfMonth, últimoDíaDelMes)).
 *  3. Si ayer coincide con ese día efectivo, llama a generateChargesInternal
 *     con el período = YYYY-MM de ayer.
 *  4. La idempotencia del servicio evita duplicados.
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
    // Calcular "ayer" en la zona horaria del servidor (America/Bogota via TZ env)
    const today     = new Date();
    const yesterday = new Date(today);
    yesterday.setDate(today.getDate() - 1);

    const yDay   = yesterday.getDate();
    const yMonth = yesterday.getMonth() + 1;
    const yYear  = yesterday.getFullYear();
    const period = `${yYear}-${String(yMonth).padStart(2, '0')}`;

    // Días en el mes de ayer (para calcular el efectivo de cada FeeConfig)
    const lastDayOfYesterdayMonth = new Date(yYear, yMonth, 0).getDate();

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

    this.logger.log(
      `[AutoGenerateCharges] Ejecutando para período ${period} ` +
      `— ${configs.length} complejo(s) candidatos`,
    );

    let processedComplexes = 0;

    for (const cfg of configs) {
      const complexId = cfg.complexId;

      // Obtener FeeConfigs activas del complejo
      const feeConfigs = await this.feeConfigRepo.find({
        where: { complexId, isActive: true, deletedAt: null as any },
        select: ['id', 'dueDayOfMonth'],
      });

      if (!feeConfigs.length) continue;

      // Verificar si alguna FeeConfig tiene ayer como su día efectivo de vencimiento
      const shouldGenerate = feeConfigs.some(fc => {
        const effectiveDay = Math.min(fc.dueDayOfMonth, lastDayOfYesterdayMonth);
        return effectiveDay === yDay;
      });

      if (!shouldGenerate) continue;

      try {
        const result = await this.financeService.generateChargesInternal(complexId, period);
        this.logger.log(
          `[AutoGenerateCharges] Complejo ${complexId} | período ${period} ` +
          `→ ${result.generated} generados, ${result.skipped} omitidos`,
        );
        processedComplexes++;
      } catch (err) {
        this.logger.error(
          `[AutoGenerateCharges] Error en complejo ${complexId}: ${err?.message}`,
          err?.stack,
        );
      }
    }

    if (processedComplexes > 0) {
      this.logger.log(
        `[AutoGenerateCharges] Completado: ${processedComplexes} complejo(s) procesados para ${period}`,
      );
    }
  }
}
