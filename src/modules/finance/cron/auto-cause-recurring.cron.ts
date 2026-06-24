import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectRepository }   from '@nestjs/typeorm';
import { Repository }         from 'typeorm';

import { RecurringCharge }  from '../entities/recurring-charge.entity';
import { AccountingService } from '../services/accounting.service';
import { ComplexStatus }     from '../../residential-complex/enums/complex-status.enum';

/** Usuario de sistema para las causaciones automáticas (sin FK; solo trazabilidad). */
const SYSTEM_USER_ID = '00000000-0000-0000-0000-000000000000';

/**
 * Cron diario 00:15 AM (Bogotá): causa los cobros recurrentes (RecurringCharge)
 * cuyo `billingDay` coincide con hoy, generando por unidad la factura contable
 * (INVOICE: Débito 1311 CxC = Crédito ingreso), el FeeCharge (CxC operativa) y
 * el incremento del saldo de la unidad. Idempotente vía `lastBilledPeriod`.
 */
@Injectable()
export class AutoCauseRecurringCron {
  private readonly logger = new Logger(AutoCauseRecurringCron.name);

  constructor(
    @InjectRepository(RecurringCharge)
    private readonly recurringRepo: Repository<RecurringCharge>,
    private readonly accountingService: AccountingService,
  ) {}

  @Cron('15 0 * * *', { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    const today  = new Date();
    const dueDay = today.getDate();
    const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    // Complejos ACTIVOS con algún recurrente activo que vence hoy
    const rows = await this.recurringRepo
      .createQueryBuilder('rc')
      .innerJoin('residential_complexes', 'complex', 'complex.id = rc."complexId"')
      .where('rc."isActive" = true')
      .andWhere('rc."billingDay" = :dueDay', { dueDay })
      .andWhere('(rc."lastBilledPeriod" IS NULL OR rc."lastBilledPeriod" <> :period)', { period })
      .andWhere('complex.status = :status', { status: ComplexStatus.ACTIVE })
      .select('DISTINCT rc."complexId"', 'complexId')
      .getRawMany<{ complexId: string }>();

    if (rows.length === 0) return;

    this.logger.log(`[AutoCauseRecurring] período ${period}, día ${dueDay} — ${rows.length} complejo(s)`);

    for (const { complexId } of rows) {
      try {
        const r = await this.accountingService.causeRecurringChargesInternal(
          complexId, period, SYSTEM_USER_ID, dueDay,
        );
        this.logger.log(
          `[AutoCauseRecurring] Complejo ${complexId} → ${r.caused} causados, ` +
          `${r.skipped} omitidos, total ${r.totalAmount}`,
        );
      } catch (err: any) {
        this.logger.error(`[AutoCauseRecurring] Error en complejo ${complexId}: ${err?.message}`, err?.stack);
      }
    }
  }
}
