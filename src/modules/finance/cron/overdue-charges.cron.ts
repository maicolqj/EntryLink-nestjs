import { Injectable, Logger } from '@nestjs/common';
import { Cron }               from '@nestjs/schedule';
import { InjectRepository }   from '@nestjs/typeorm';
import { LessThan, In, Repository } from 'typeorm';

import { FeeCharge }    from '../entities/fee-charge.entity';
import { ChargeStatus } from '../enums/charge-status.enum';

/**
 * Cron diario que marca como OVERDUE todos los FeeCharges PENDING / PARTIALLY_PAID
 * cuya fecha de vencimiento ya pasó.
 *
 * Se ejecuta a medianoche hora Bogotá: '0 0 * * *'
 */
@Injectable()
export class OverdueChargesCron {
  private readonly logger = new Logger(OverdueChargesCron.name);

  constructor(
    @InjectRepository(FeeCharge)
    private readonly chargeRepo: Repository<FeeCharge>,
  ) {}

  @Cron('0 0 * * *', { timeZone: 'America/Bogota' })
  async markOverdueCharges(): Promise<void> {
    const today = new Date();
    today.setHours(0, 0, 0, 0);

    // Paso 1: Revertir descuento de pronto pago en cargos cuyo pronto pago venció
    // sin pago total. Los cargos generados con earlyPaymentAmount tienen
    // normalAmount > amount y earlyPaymentDueDate; pasada esa fecha se restaura
    // amount al valor normal. Identificadores camelCase citados (sin naming strategy).
    await this.chargeRepo.manager.query(
      `UPDATE "fee_charges"
       SET "amount" = "normalAmount"
       WHERE "normalAmount" IS NOT NULL
         AND "amount" < "normalAmount"
         AND "earlyPaymentDueDate" IS NOT NULL
         AND "earlyPaymentDueDate" < $1
         AND "status" IN ($2, $3)
         AND "deletedAt" IS NULL`,
      [today, ChargeStatus.PENDING, ChargeStatus.PARTIALLY_PAID],
    );

    // Paso 2: Marcar como OVERDUE los cargos cuyo vencimiento ya pasó
    const result = await this.chargeRepo
      .createQueryBuilder()
      .update(FeeCharge)
      .set({ status: ChargeStatus.OVERDUE })
      .where('status IN (:...statuses)', {
        statuses: [ChargeStatus.PENDING, ChargeStatus.PARTIALLY_PAID],
      })
      .andWhere('dueDate < :today', { today })
      .andWhere('deletedAt IS NULL')
      .execute();

    const affected = result.affected ?? 0;
    if (affected > 0) {
      this.logger.log(`markOverdueCharges: ${affected} cargos marcados como OVERDUE`);
    }
  }
}
