import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Not, Repository } from 'typeorm';

import { CacheService } from '../../../core/infrastructure/cache/cache.service';
import { BK } from '../../../core/infrastructure/cache/business-cache.constants';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { UnitStatus } from '../../residential-complex/enums/unit-status.enum';
import { PLAN_UNIT_LIMITS } from '../../residential-complex/services/residential-complex.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { CustomError } from '../../shared/utils/errors.utils';
import {
  ComplexErrorCode,
  GeneralErrorCode,
  SubscriptionErrorCode,
} from '../../shared/constans/error-codes.constants';
import { round2 } from '../../finance/utils/numeric.transformer';
import { SubscriptionPeriod } from '../entities/subscription-period.entity';
import { SubscriptionPlanPrice } from '../entities/subscription-plan-price.entity';
import { SubscriptionTax } from '../entities/subscription-tax.entity';
import { SubscriptionPricingMode } from '../enums/subscription-pricing-mode.enum';
import { SetComplexPricingInput } from '../dto/inputs/set-complex-pricing.input';
import { SaveSubscriptionTaxInput } from '../dto/inputs/save-subscription-tax.input';
import { SubscriptionQuote } from '../dto/responses/subscription-quote.response';
import { SubscriptionTaxLine } from '../dto/responses/subscription-tax-line.response';
import { SubscriptionPricing } from '../dto/responses/subscription-pricing.response';
import { TaxRate, computeQuote, splitTotal } from '../utils/subscription-quote';
import { BillingCycle } from '../enums/billing-cycle.enum';
import { SubscriptionTaxKind } from '../enums/subscription-tax-kind.enum';
import { FreePeriodReason } from '../enums/free-period-reason.enum';
import { UpdateSubscriptionPaymentInput } from '../dto/inputs/update-subscription-payment.input';
import { SubscriptionPeriodKind } from '../enums/subscription-period-kind.enum';
import { RenewSubscriptionInput } from '../dto/inputs/renew-subscription.input';
import { GrantTrialInput } from '../dto/inputs/grant-trial.input';
import { AdjustSubscriptionInput } from '../dto/inputs/adjust-subscription.input';
import { SetPlanPriceInput } from '../dto/inputs/set-plan-price.input';
import { SubscriptionSummary } from '../dto/responses/subscription-summary.response';
import { SubscriptionPlanPriceView } from '../dto/responses/subscription-plan-price-view.response';
import {
  ANNUAL_MONTHS_CHARGED,
  TRIAL_DAYS,
  addBillingPeriod,
  addDays,
  computeSubscriptionStatus,
  daysUntil,
  graceEndsAt,
} from '../utils/subscription-status';
import { formatBogotaDate, formatCop } from '../utils/format-date';

/** Planes que se pueden pagar. FREE es solo la prueba gratis. */
const PAID_PLANS = [ComplexPlan.BASIC, ComplexPlan.PRO, ComplexPlan.ENTERPRISE];

const PLAN_LABELS: Record<ComplexPlan, string> = {
  [ComplexPlan.FREE]: 'Gratis',
  [ComplexPlan.BASIC]: 'Básico',
  [ComplexPlan.PRO]: 'Pro',
  [ComplexPlan.ENTERPRISE]: 'Enterprise',
};

@Injectable()
export class SubscriptionsService {
  private readonly logger = new Logger(SubscriptionsService.name);

  constructor(
    @InjectRepository(SubscriptionPeriod)
    private readonly periodRepo: Repository<SubscriptionPeriod>,
    @InjectRepository(SubscriptionPlanPrice)
    private readonly priceRepo: Repository<SubscriptionPlanPrice>,
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    @InjectRepository(SubscriptionTax)
    private readonly taxRepo: Repository<SubscriptionTax>,
    @InjectRepository(Unit)
    private readonly unitRepo: Repository<Unit>,
    private readonly dataSource: DataSource,
    private readonly cacheService: CacheService,
    private readonly notificationsService: NotificationsService,
  ) {}

  // ================================================================
  // CONSULTAS
  // ================================================================

  async getSummary(complexId: string): Promise<SubscriptionSummary> {
    const complex = await this.findComplex(complexId);
    const periods = await this.periodRepo.find({
      where: { complexId },
      order: { endsAt: 'DESC', createdAt: 'DESC' },
    });

    const endsAt = complex.subscriptionEndsAt
      ? new Date(complex.subscriptionEndsAt)
      : null;
    const now = new Date();

    return {
      complexId: complex.id,
      complexName: complex.name,
      plan: complex.plan,
      pricing: this.toPricing(complex),
      quote: await this.quoteFor(complex),
      status: computeSubscriptionStatus(endsAt, now),
      endsAt,
      daysLeft: endsAt ? daysUntil(endsAt, now) : null,
      graceEndsAt: endsAt ? graceEndsAt(endsAt) : null,
      currentPeriod:
        periods.find(
          (p) => p.startsAt.getTime() <= now.getTime() && p.endsAt > now,
        ) ??
        periods[0] ??
        null,
      trialUsed: periods.some((p) => p.kind === SubscriptionPeriodKind.TRIAL),
      periods,
    };
  }

  async listPrices(): Promise<SubscriptionPlanPriceView[]> {
    const prices = await this.priceRepo.find();
    return PAID_PLANS.map((plan) => prices.find((p) => p.plan === plan))
      .filter((p): p is SubscriptionPlanPrice => !!p)
      .map((p) => this.toPriceView(p));
  }

  // ================================================================
  // COBRO PERSONALIZADO DEL CONJUNTO
  // ================================================================

  /**
   * Valor a cobrar al conjunto. Por defecto con su plan y su ciclo; el
   * formulario de pago lo pide con el plan o el ciclo que se vaya a registrar.
   */
  async getQuote(
    complexId: string,
    plan?: ComplexPlan,
    cycle?: BillingCycle,
  ): Promise<SubscriptionQuote> {
    const complex = await this.findComplex(complexId);
    return this.quoteFor(complex, plan, cycle);
  }

  async setPricing(
    input: SetComplexPricingInput,
    userId: string,
  ): Promise<SubscriptionSummary> {
    await this.findComplex(input.complexId);

    const needsPrice = input.mode !== SubscriptionPricingMode.PLAN;
    if (needsPrice && (input.price === null || input.price === undefined)) {
      throw new CustomError({
        message:
          input.mode === SubscriptionPricingMode.PER_UNIT
            ? 'Indica el valor por unidad'
            : 'Indica el valor mensual acordado',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_PRICE_NOT_SET,
      });
    }

    await this.complexRepo.update(input.complexId, {
      subscriptionPricingMode: input.mode,
      subscriptionPrice: needsPrice ? round2(input.price as number) : null,
      subscriptionCycle: input.cycle,
    });
    await this.invalidate(input.complexId);

    this.logger.log(
      `Cobro del complejo ${input.complexId}: ${input.mode} ${input.price ?? ''} ${input.cycle} (por ${userId})`,
    );
    return this.getSummary(input.complexId);
  }

  // ================================================================
  // IMPUESTOS
  // ================================================================

  /** Sin conjunto: los globales. Con conjunto: solo los locales de ese conjunto. */
  listTaxes(complexId?: string): Promise<SubscriptionTax[]> {
    return this.taxRepo.find({
      where: { complexId: complexId ?? IsNull() },
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
  }

  async saveTax(input: SaveSubscriptionTaxInput): Promise<SubscriptionTax> {
    let tax: SubscriptionTax | null;
    if (input.id) {
      tax = await this.taxRepo.findOne({ where: { id: input.id } });
    } else {
      if (input.complexId) await this.findComplex(input.complexId);
      tax = this.taxRepo.create({
        complexId: input.complexId ?? null,
        kind: input.kind ?? SubscriptionTaxKind.CHARGE,
      });
    }
    if (!tax) {
      throw new CustomError({
        message: 'Impuesto no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_TAX_NOT_FOUND,
      });
    }
    tax.name = input.name.trim();
    tax.rate = round2(input.rate);
    if (input.kind !== undefined) tax.kind = input.kind;
    if (input.isActive !== undefined) tax.isActive = input.isActive;
    if (input.sortOrder !== undefined) tax.sortOrder = input.sortOrder;
    return this.taxRepo.save(tax);
  }

  async deleteTax(id: string): Promise<boolean> {
    const result = await this.taxRepo.delete(id);
    return (result.affected ?? 0) > 0;
  }

  async setPlanPrice(
    input: SetPlanPriceInput,
    userId: string,
  ): Promise<SubscriptionPlanPriceView> {
    this.assertPaidPlan(input.plan);

    const existing = await this.priceRepo.findOne({
      where: { plan: input.plan },
    });
    const price = existing ?? this.priceRepo.create({ plan: input.plan });
    price.monthlyPrice = round2(input.monthlyPrice);
    price.annualPrice =
      input.annualPrice === null || input.annualPrice === undefined
        ? null
        : round2(input.annualPrice);
    price.updatedById = userId;

    return this.toPriceView(await this.priceRepo.save(price));
  }

  // ================================================================
  // RENOVAR (registrar un pago)
  // ================================================================

  /**
   * Registra el pago de un periodo.
   *
   * Si el complejo renueva antes de vencer, el periodo nuevo arranca cuando
   * termina el actual: pagar temprano no le hace perder días. Si ya venció,
   * arranca hoy: no se cobra el tiempo que estuvo vencido.
   */
  async renew(
    input: RenewSubscriptionInput,
    userId: string,
  ): Promise<SubscriptionSummary> {
    this.assertPaidPlan(input.plan);

    const quote = await this.getQuote(input.complexId, input.plan, input.cycle);
    if (
      (input.amount === null || input.amount === undefined) &&
      !quote.configured
    ) {
      throw new CustomError({
        message:
          'El conjunto no tiene un valor de suscripción configurado. Configura el cobro del conjunto o indica el valor pagado.',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_PRICE_NOT_SET,
      });
    }

    // Lo pagado ya trae los impuestos sumados y las retenciones descontadas.
    // Si coincide con lo calculado se guarda ese desglose; si el SUPER_ADMIN
    // registró otro valor, se reparte hacia atrás con las tarifas vigentes.
    const amount = round2(input.amount ?? quote.total);
    const breakdown =
      quote.configured && amount === quote.total
        ? quote
        : splitTotal(amount, await this.activeTaxes(input.complexId));

    const period = await this.dataSource.transaction(async (manager) => {
      // Bloqueo de la fila: dos pagos registrados a la vez no pueden arrancar
      // los dos desde el mismo vencimiento.
      const complex = await manager
        .getRepository(ResidentialComplex)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: input.complexId })
        .andWhere('c.deleted_at IS NULL')
        .getOne();
      if (!complex) throw this.complexNotFound(input.complexId);

      const now = new Date();
      const currentEnd = complex.subscriptionEndsAt
        ? new Date(complex.subscriptionEndsAt)
        : null;
      const startsAt =
        input.startsAt ?? (currentEnd && currentEnd > now ? currentEnd : now);
      const endsAt = addBillingPeriod(startsAt, input.cycle);

      const periodRepo = manager.getRepository(SubscriptionPeriod);
      if (input.startsAt) {
        await this.makeRoomFor(periodRepo, complex.id, startsAt);
      }

      const created = await periodRepo.save(
        periodRepo.create({
          complexId: complex.id,
          kind: SubscriptionPeriodKind.PAID,
          plan: input.plan,
          cycle: input.cycle,
          startsAt,
          endsAt,
          amount,
          subtotal: breakdown.subtotal,
          taxAmount: breakdown.taxAmount,
          withholdingAmount: breakdown.withholdingAmount,
          taxes: this.toTaxLines(breakdown.taxes),
          pricingMode: quote.pricingMode,
          unitCount:
            quote.pricingMode === SubscriptionPricingMode.PER_UNIT
              ? quote.unitCount
              : null,
          unitPrice:
            quote.pricingMode === SubscriptionPricingMode.PER_UNIT
              ? (quote.price ?? null)
              : null,
          paidAt: input.paidAt ?? now,
          paymentReference: input.paymentReference?.trim() || null,
          notes: input.notes?.trim() || null,
          createdById: userId,
        }),
      );

      // El vencimiento vigente es el del periodo que termina más tarde: con una
      // fecha de inicio elegida, el pago puede quedar antes de otro periodo.
      const latest = await periodRepo.findOne({
        where: { complexId: complex.id },
        order: { endsAt: 'DESC' },
      });
      await manager.getRepository(ResidentialComplex).update(complex.id, {
        subscriptionEndsAt:
          latest && latest.endsAt > endsAt ? latest.endsAt : endsAt,
        plan: input.plan,
        maxUnits: PLAN_UNIT_LIMITS[input.plan],
      });

      return created;
    });

    await this.invalidate(input.complexId);

    const cycleLabel =
      input.cycle === BillingCycle.ANNUAL ? 'anual' : 'mensual';
    await this.notifyComplex({
      complexId: input.complexId,
      type: NotificationType.SUBSCRIPTION_RENEWED,
      priority: NotificationPriority.NORMAL,
      title: 'Suscripción renovada',
      body: `Registramos tu pago de ${formatCop(amount)} (${cycleLabel}). Tu suscripción queda vigente hasta el ${formatBogotaDate(period.endsAt)}.`,
      metadata: {
        periodId: period.id,
        plan: input.plan,
        cycle: input.cycle,
        endsAt: period.endsAt.toISOString(),
      },
      createdByUserId: userId,
    });

    this.logger.log(
      `Suscripción renovada: complejo ${input.complexId}, ${input.plan} ${input.cycle} hasta ${period.endsAt.toISOString()}`,
    );
    return this.getSummary(input.complexId);
  }

  /**
   * Prepara el historial para un pago con fecha de inicio elegida.
   *
   * Un periodo ya pagado que cubra esa fecha bloquea el registro: sería
   * cobrar dos veces el mismo tiempo. Un periodo gratuito en curso (inicial,
   * prueba o cortesía) se recorta hasta esa fecha, para que el historial no
   * muestre dos periodos encimados.
   */
  private async makeRoomFor(
    periodRepo: Repository<SubscriptionPeriod>,
    complexId: string,
    startsAt: Date,
  ): Promise<void> {
    const periods = await periodRepo.find({ where: { complexId } });
    const covering = periods.filter(
      (p) => p.startsAt < startsAt && p.endsAt > startsAt,
    );

    const paid = covering.find((p) => p.kind === SubscriptionPeriodKind.PAID);
    if (paid) {
      throw new CustomError({
        message: `Ya hay un periodo pagado hasta el ${formatBogotaDate(paid.endsAt)}. El nuevo periodo debe empezar ese día o después.`,
        statusCode: HttpStatus.CONFLICT,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_OVERLAPS_PAID,
      });
    }

    for (const period of covering) {
      const stamp = `[${formatBogotaDate(new Date())}] Recortado al ${formatBogotaDate(startsAt)}: empezó un periodo pagado.`;
      period.notes = period.notes ? `${period.notes}\n${stamp}` : stamp;
      period.endsAt = startsAt;
      await periodRepo.save(period);
    }
  }

  // ================================================================
  // CORREGIR UN PAGO
  // ================================================================

  /**
   * Corrige el valor, la fecha o la referencia de un pago ya registrado.
   *
   * El desglose se rehace hacia atrás desde el valor nuevo con las tarifas
   * guardadas al pagar, o con las vigentes del conjunto si se pide (el pago se
   * registró antes de configurar su retención). No mueve las fechas del
   * periodo: para eso está el ajuste del vencimiento. El motivo y los valores
   * anteriores quedan en las notas.
   */
  async updatePayment(
    input: UpdateSubscriptionPaymentInput,
    userId: string,
  ): Promise<SubscriptionSummary> {
    const period = await this.periodRepo.findOne({
      where: { id: input.periodId },
    });
    if (!period) {
      throw new CustomError({
        message: 'Pago no encontrado',
        statusCode: HttpStatus.NOT_FOUND,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_NOT_FOUND,
      });
    }
    if (period.kind !== SubscriptionPeriodKind.PAID) {
      throw new CustomError({
        message:
          'Solo se pueden corregir pagos. La prueba gratis y el periodo inicial no tienen valor.',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_PERIOD_NOT_PAID,
      });
    }

    const changes: string[] = [];

    if (input.amount !== undefined || input.useCurrentTaxes) {
      const previous = period.amount ?? 0;
      const amount = round2(input.amount ?? previous);
      const rates: TaxRate[] = input.useCurrentTaxes
        ? await this.activeTaxes(period.complexId)
        : (period.taxes ?? []).map((t) => ({
            name: t.name,
            rate: t.rate,
            kind: t.kind,
          }));
      const breakdown = splitTotal(amount, rates);

      period.amount = amount;
      period.subtotal = breakdown.subtotal;
      period.taxAmount = breakdown.taxAmount;
      period.withholdingAmount = breakdown.withholdingAmount;
      period.taxes = this.toTaxLines(breakdown.taxes);

      if (amount !== previous) {
        changes.push(`valor ${formatCop(previous)} → ${formatCop(amount)}`);
      }
      if (input.useCurrentTaxes) {
        changes.push('impuestos recalculados con las tarifas vigentes');
      }
    }

    if (input.paidAt !== undefined) {
      const previous = period.paidAt;
      period.paidAt = input.paidAt;
      changes.push(
        `fecha de pago ${previous ? formatBogotaDate(previous) : '—'} → ${formatBogotaDate(input.paidAt)}`,
      );
    }

    if (input.paymentReference !== undefined) {
      const previous = period.paymentReference ?? '—';
      period.paymentReference = input.paymentReference.trim() || null;
      changes.push(
        `referencia ${previous} → ${period.paymentReference ?? '—'}`,
      );
    }

    if (changes.length === 0) {
      throw new CustomError({
        message: 'No hay cambios que guardar en el pago',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const stamp = `[${formatBogotaDate(new Date())}] Pago corregido (${changes.join('; ')}): ${input.reason.trim()}`;
    period.notes = period.notes ? `${period.notes}\n${stamp}` : stamp;
    period.updatedById = userId;
    period.paymentUpdatedAt = new Date();

    await this.periodRepo.save(period);
    await this.invalidate(period.complexId);

    this.logger.log(
      `Pago ${period.id} del complejo ${period.complexId} corregido por ${userId}: ${changes.join('; ')}`,
    );
    return this.getSummary(period.complexId);
  }

  // ================================================================
  // DÍAS GRATIS (prueba y cortesías)
  // ================================================================

  /**
   * Regala días de suscripción con la duración que elija el SUPER_ADMIN.
   *
   * La prueba gratis (TRIAL) se otorga una sola vez por complejo. Las
   * cortesías (por recomendar a otro conjunto, promoción, otro motivo) se
   * pueden repetir. Si la suscripción sigue vigente, los días se suman al
   * final: regalar días nunca recorta lo que ya tenía. No cambia el plan ni el
   * límite de unidades.
   */
  async grantTrial(
    input: GrantTrialInput,
    userId: string,
  ): Promise<SubscriptionSummary> {
    const reason = input.reason ?? FreePeriodReason.TRIAL;
    const days = input.days ?? TRIAL_DAYS;
    const kind =
      reason === FreePeriodReason.TRIAL
        ? SubscriptionPeriodKind.TRIAL
        : SubscriptionPeriodKind.COURTESY;

    if (reason === FreePeriodReason.OTHER && !input.notes?.trim()) {
      throw new CustomError({
        message: 'Explica en las notas por qué se regalan los días',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }

    const period = await this.dataSource.transaction(async (manager) => {
      const complex = await manager
        .getRepository(ResidentialComplex)
        .createQueryBuilder('c')
        .setLock('pessimistic_write')
        .where('c.id = :id', { id: input.complexId })
        .andWhere('c.deleted_at IS NULL')
        .getOne();
      if (!complex) throw this.complexNotFound(input.complexId);

      if (kind === SubscriptionPeriodKind.TRIAL) {
        const used = await manager.getRepository(SubscriptionPeriod).exists({
          where: { complexId: complex.id, kind: SubscriptionPeriodKind.TRIAL },
        });
        if (used) {
          throw new CustomError({
            message:
              'Este complejo ya usó su prueba gratis. Para regalarle más días usa una cortesía (recomendación, promoción u otro motivo).',
            statusCode: HttpStatus.CONFLICT,
            errorCode: SubscriptionErrorCode.SUBSCRIPTION_TRIAL_ALREADY_USED,
          });
        }
      }

      const now = new Date();
      const currentEnd = complex.subscriptionEndsAt
        ? new Date(complex.subscriptionEndsAt)
        : null;
      const startsAt = currentEnd && currentEnd > now ? currentEnd : now;
      const endsAt = addDays(startsAt, days);

      const created = await manager.getRepository(SubscriptionPeriod).save(
        manager.getRepository(SubscriptionPeriod).create({
          complexId: complex.id,
          kind,
          freeReason: reason,
          plan: complex.plan,
          cycle: null,
          startsAt,
          endsAt,
          amount: 0,
          notes: input.notes?.trim() || null,
          createdById: userId,
        }),
      );

      await manager
        .getRepository(ResidentialComplex)
        .update(complex.id, { subscriptionEndsAt: endsAt });

      return created;
    });

    await this.invalidate(input.complexId);

    const until = formatBogotaDate(period.endsAt);
    const daysLabel = days === 1 ? '1 día' : `${days} días`;
    const message: Record<FreePeriodReason, { title: string; body: string }> = {
      [FreePeriodReason.TRIAL]: {
        title: 'Prueba gratis activada',
        body: `Tienes ${daysLabel} de prueba gratis, hasta el ${until}.`,
      },
      [FreePeriodReason.REFERRAL]: {
        title: 'Días gratis por recomendarnos',
        body: `¡Gracias por recomendarnos! Te regalamos ${daysLabel}: tu suscripción queda vigente hasta el ${until}.`,
      },
      [FreePeriodReason.PROMOTION]: {
        title: 'Días gratis de promoción',
        body: `Te regalamos ${daysLabel} por promoción: tu suscripción queda vigente hasta el ${until}.`,
      },
      [FreePeriodReason.OTHER]: {
        title: 'Días gratis',
        body: `Te regalamos ${daysLabel}: tu suscripción queda vigente hasta el ${until}.`,
      },
    };

    await this.notifyComplex({
      complexId: input.complexId,
      type: NotificationType.SUBSCRIPTION_RENEWED,
      priority: NotificationPriority.NORMAL,
      ...message[reason],
      metadata: {
        periodId: period.id,
        kind,
        reason,
        days,
        endsAt: period.endsAt.toISOString(),
      },
      createdByUserId: userId,
    });

    return this.getSummary(input.complexId);
  }

  // ================================================================
  // AJUSTE MANUAL
  // ================================================================

  /**
   * Corrige el vencimiento vigente (p. ej. para alinear el periodo inicial con
   * lo que el complejo ya había pagado por fuera). El motivo queda en las notas
   * del periodo; los avisos vuelven a empezar para la fecha nueva.
   */
  async adjustEndsAt(
    input: AdjustSubscriptionInput,
    userId: string,
  ): Promise<SubscriptionSummary> {
    await this.findComplex(input.complexId);

    const latest = await this.periodRepo.findOne({
      where: { complexId: input.complexId },
      order: { endsAt: 'DESC', createdAt: 'DESC' },
    });
    if (!latest) {
      throw new CustomError({
        message:
          'El complejo no tiene periodos de suscripción. Otorga una prueba o registra un pago.',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_NOT_FOUND,
      });
    }
    if (input.endsAt <= latest.startsAt) {
      throw new CustomError({
        message: 'El vencimiento debe ser posterior al inicio del periodo',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_INVALID_END_DATE,
      });
    }

    const stamp = `[${formatBogotaDate(new Date())}] Vencimiento ajustado de ${formatBogotaDate(latest.endsAt)} a ${formatBogotaDate(input.endsAt)}: ${input.reason.trim()}`;
    latest.notes = latest.notes ? `${latest.notes}\n${stamp}` : stamp;
    latest.endsAt = input.endsAt;

    await this.dataSource.transaction(async (manager) => {
      await manager.getRepository(SubscriptionPeriod).save(latest);
      await manager
        .getRepository(ResidentialComplex)
        .update(input.complexId, { subscriptionEndsAt: input.endsAt });
    });

    await this.invalidate(input.complexId);
    this.logger.log(
      `Vencimiento de ${input.complexId} ajustado a ${input.endsAt.toISOString()} por ${userId}`,
    );
    return this.getSummary(input.complexId);
  }

  // ================================================================
  // AUXILIARES
  // ================================================================

  /** Avisa a la cuenta del complejo (sub = complex.id). Best-effort. */
  async notifyComplex(params: {
    complexId: string;
    type: NotificationType;
    priority: NotificationPriority;
    title: string;
    body: string;
    metadata?: Record<string, unknown>;
    createdByUserId?: string;
    alsoSuperAdmins?: { title: string; body: string };
  }): Promise<void> {
    try {
      await this.notificationsService.notify({
        complexId: params.complexId,
        userIds: [params.complexId],
        type: params.type,
        priority: params.priority,
        title: params.title,
        body: params.body,
        entityId: params.complexId,
        entityType: 'ResidentialComplex',
        metadata: { complexId: params.complexId, ...params.metadata },
        createdByUserId: params.createdByUserId,
      });

      if (params.alsoSuperAdmins) {
        const superAdminIds =
          await this.notificationsService.findSuperAdminUserIds();
        if (superAdminIds.length > 0) {
          await this.notificationsService.notify({
            complexId: params.complexId,
            userIds: superAdminIds,
            type: params.type,
            priority: params.priority,
            title: params.alsoSuperAdmins.title,
            body: params.alsoSuperAdmins.body,
            entityId: params.complexId,
            entityType: 'ResidentialComplex',
            metadata: { complexId: params.complexId, ...params.metadata },
          });
        }
      }
    } catch (err) {
      this.logger.warn(
        `No se pudo notificar ${params.type} al complejo ${params.complexId}: ${(err as Error).message}`,
      );
    }
  }

  planLabel(plan: ComplexPlan): string {
    return PLAN_LABELS[plan] ?? plan;
  }

  /** Valor a cobrar con la configuración del conjunto. */
  async quoteFor(
    complex: Pick<
      ResidentialComplex,
      | 'id'
      | 'plan'
      | 'totalUnits'
      | 'subscriptionPricingMode'
      | 'subscriptionPrice'
      | 'subscriptionCycle'
    >,
    plan?: ComplexPlan,
    cycle?: BillingCycle,
  ): Promise<SubscriptionQuote> {
    const pricing = this.toPricing(complex);
    const effectiveCycle = cycle ?? pricing.cycle;
    // La prueba (FREE) no se paga: la cotización usa el plan pago más bajo.
    const effectivePlan =
      plan ??
      (PAID_PLANS.includes(complex.plan) ? complex.plan : ComplexPlan.BASIC);

    const [units, taxes, planPrice] = await Promise.all([
      pricing.mode === SubscriptionPricingMode.PER_UNIT
        ? this.countUnits(complex.id, complex.totalUnits)
        : Promise.resolve({ count: 0, source: 'REGISTERED' as const }),
      this.activeTaxes(complex.id),
      pricing.mode === SubscriptionPricingMode.PLAN
        ? this.priceRepo.findOne({ where: { plan: effectivePlan } })
        : Promise.resolve(null),
    ]);

    const result = computeQuote({
      mode: pricing.mode,
      cycle: effectiveCycle,
      price: pricing.price,
      planMonthlyPrice: planPrice?.monthlyPrice ?? null,
      planAnnualPrice: planPrice?.annualPrice ?? null,
      unitCount: units.count,
      taxes,
    });

    return {
      ...result,
      taxes: this.toTaxLines(result.taxes),
      pricingMode: pricing.mode,
      plan: effectivePlan,
      cycle: effectiveCycle,
      unitCount: units.count,
      unitCountSource: units.source,
      price: pricing.price ?? null,
    };
  }

  /**
   * Unidades que se cobran: las registradas que no estén deshabilitadas. Un
   * conjunto recién inscrito todavía no las ha cargado; mientras tanto se usan
   * las que declaró al inscribirse.
   */
  private async countUnits(
    complexId: string,
    declared?: number | null,
  ): Promise<{ count: number; source: 'REGISTERED' | 'DECLARED' }> {
    const registered = await this.unitRepo.count({
      where: {
        complexId,
        deletedAt: IsNull(),
        status: Not(UnitStatus.DISABLED),
      },
    });
    if (registered > 0 || !declared) {
      return { count: registered, source: 'REGISTERED' };
    }
    return { count: declared, source: 'DECLARED' };
  }

  /** Los globales primero y luego los locales del conjunto. */
  private async activeTaxes(complexId: string): Promise<TaxRate[]> {
    const taxes = await this.taxRepo.find({
      where: [
        { isActive: true, complexId: IsNull() },
        { isActive: true, complexId },
      ],
      order: { sortOrder: 'ASC', name: 'ASC' },
    });
    return [
      ...taxes.filter((t) => !t.complexId),
      ...taxes.filter((t) => !!t.complexId),
    ].map((t) => ({ name: t.name, rate: t.rate, kind: t.kind }));
  }

  private toTaxLines(
    lines: { name: string; rate: number; kind: string; amount: number }[],
  ): SubscriptionTaxLine[] {
    return lines.map((l) => ({
      name: l.name,
      rate: l.rate,
      kind: l.kind as SubscriptionTaxKind,
      amount: l.amount,
    }));
  }

  private toPricing(
    complex: Pick<
      ResidentialComplex,
      'subscriptionPricingMode' | 'subscriptionPrice' | 'subscriptionCycle'
    >,
  ): SubscriptionPricing {
    const modes = Object.values(SubscriptionPricingMode) as string[];
    const mode = modes.includes(complex.subscriptionPricingMode)
      ? (complex.subscriptionPricingMode as SubscriptionPricingMode)
      : SubscriptionPricingMode.PLAN;
    return {
      mode,
      price: complex.subscriptionPrice ?? null,
      cycle:
        complex.subscriptionCycle === BillingCycle.ANNUAL
          ? BillingCycle.ANNUAL
          : BillingCycle.MONTHLY,
    };
  }

  private toPriceView(price: SubscriptionPlanPrice): SubscriptionPlanPriceView {
    const custom =
      price.annualPrice !== null && price.annualPrice !== undefined;
    return {
      plan: price.plan,
      monthlyPrice: price.monthlyPrice,
      annualPrice: custom
        ? price.annualPrice
        : round2(price.monthlyPrice * ANNUAL_MONTHS_CHARGED),
      annualPriceIsCustom: custom,
      updatedAt: price.updatedAt ?? null,
    };
  }

  private assertPaidPlan(plan: ComplexPlan): void {
    if (!PAID_PLANS.includes(plan)) {
      throw new CustomError({
        message:
          'El plan Gratis es solo la prueba de 30 días: elige Básico, Pro o Enterprise.',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: SubscriptionErrorCode.SUBSCRIPTION_FREE_NOT_RENEWABLE,
      });
    }
  }

  private async findComplex(complexId: string): Promise<ResidentialComplex> {
    const complex = await this.complexRepo.findOne({
      where: { id: complexId, deletedAt: IsNull() },
      select: [
        'id',
        'name',
        'plan',
        'totalUnits',
        'subscriptionEndsAt',
        'subscriptionPricingMode',
        'subscriptionPrice',
        'subscriptionCycle',
      ],
    });
    if (!complex) throw this.complexNotFound(complexId);
    return complex;
  }

  private complexNotFound(complexId: string): CustomError {
    return new CustomError({
      message: `Complejo con ID "${complexId}" no encontrado`,
      statusCode: HttpStatus.NOT_FOUND,
      errorCode: ComplexErrorCode.COMPLEX_NOT_FOUND,
    });
  }

  /** El guard y el detalle del complejo leen de caché: hay que soltarla. */
  private async invalidate(complexId: string): Promise<void> {
    await this.cacheService.delete({
      key: BK.complexSubscription.one(complexId),
    });
    await this.cacheService.delete({ key: BK.complex.one(complexId) });
  }
}
