import { Injectable, Logger } from '@nestjs/common';
import { Cron } from '@nestjs/schedule';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { RecurringCharge } from '../entities/recurring-charge.entity';
import { AccountingService } from '../services/accounting.service';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { operableComplexSql } from '../../subscriptions/utils/operable-complex.sql';
import { SubscriptionPause } from '../../subscriptions/entities/subscription-pause.entity';
import { pausedBillingDates } from '../../subscriptions/utils/subscription-status';

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
    @InjectRepository(SubscriptionPause)
    private readonly pauseRepo: Repository<SubscriptionPause>,
  ) {}

  @Cron('15 0 * * *', { timeZone: 'America/Bogota' })
  async run(): Promise<void> {
    await this.catchUpPausedPeriods();

    const today = new Date();
    const dueDay = today.getDate();
    const period = `${today.getFullYear()}-${String(today.getMonth() + 1).padStart(2, '0')}`;

    // Complejos ACTIVOS con algún recurrente activo que vence hoy
    const rows = await this.recurringRepo
      .createQueryBuilder('rc')
      .innerJoin(
        'residential_complexes',
        'complex',
        'complex.id = rc."complexId"',
      )
      .where('rc."isActive" = true')
      .andWhere('rc."billingDay" = :dueDay', { dueDay })
      .andWhere(
        '(rc."lastBilledPeriod" IS NULL OR rc."lastBilledPeriod" <> :period)',
        { period },
      )
      .andWhere('complex.status = :status', { status: ComplexStatus.ACTIVE })
      .andWhere(operableComplexSql('complex.id'))
      .select('DISTINCT rc."complexId"', 'complexId')
      .getRawMany<{ complexId: string }>();

    if (rows.length === 0) return;

    this.logger.log(
      `[AutoCauseRecurring] período ${period}, día ${dueDay} — ${rows.length} complejo(s)`,
    );

    for (const { complexId } of rows) {
      try {
        const r = await this.accountingService.causeRecurringChargesInternal(
          complexId,
          period,
          SYSTEM_USER_ID,
          dueDay,
        );
        this.logger.log(
          `[AutoCauseRecurring] Complejo ${complexId} → ${r.caused} causados, ` +
            `${r.skipped} omitidos, total ${r.totalAmount}`,
        );
      } catch (err: any) {
        this.logger.error(
          `[AutoCauseRecurring] Error en complejo ${complexId}: ${err?.message}`,
          err?.stack,
        );
      }
    }
  }

  /**
   * Causa lo que no corrió mientras el conjunto estuvo pausado. El cron solo
   * mira el `billingDay` de hoy, así que esos días no se recuperarían solos.
   * Si falla no marca la pausa y mañana reintenta: `lastBilledPeriod` evita
   * causar dos veces lo que alcanzó a quedar hecho.
   */
  async catchUpPausedPeriods(): Promise<void> {
    const pending = await this.pauseRepo
      .createQueryBuilder('p')
      .where('p.recurringCaughtUpAt IS NULL')
      .andWhere(operableComplexSql('p.complexId'))
      .orderBy('p.resumedAt', 'ASC')
      .getMany();

    for (const pause of pending) {
      try {
        const recurrents = await this.recurringRepo.find({
          where: { complexId: pause.complexId, isActive: true },
        });
        const billingDays = new Set(recurrents.map((r) => r.billingDay));

        for (const { period, day } of pausedBillingDates(
          pause.pausedAt,
          pause.resumedAt,
        )) {
          if (!billingDays.has(day)) continue;
          await this.accountingService.causeRecurringChargesInternal(
            pause.complexId,
            period,
            SYSTEM_USER_ID,
            day,
          );
        }

        await this.pauseRepo.update(pause.id, {
          recurringCaughtUpAt: new Date(),
        });
      } catch (err: any) {
        this.logger.error(
          `[AutoCauseRecurring] Error al recuperar la pausa de ${pause.complexId}: ${err?.message}`,
          err?.stack,
        );
      }
    }
  }
}
