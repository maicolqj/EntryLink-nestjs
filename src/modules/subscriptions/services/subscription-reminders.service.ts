import { Injectable, Logger } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MailService } from '../../../mail/mail.service';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';
import { ComplexStatus } from '../../residential-complex/enums/complex-status.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { NotificationPriority } from '../../notifications/enums/notification-priority.enum';
import { SubscriptionReminder } from '../entities/subscription-reminder.entity';
import {
  EXPIRING_WINDOW_DAYS,
  ReminderMilestone,
  currentReminderMilestone,
  daysUntil,
  graceEndsAt,
} from '../utils/subscription-status';
import { formatBogotaDate, formatCop } from '../utils/format-date';
import { SubscriptionQuote } from '../dto/responses/subscription-quote.response';
import { SubscriptionsService } from './subscriptions.service';

const STILL_WORKING =
  'El botón de pánico, la portería y el control de acceso nunca se suspenden por la suscripción.';

/** Complejos que reciben avisos: los que operan. */
const NOTIFIED_STATUSES = [ComplexStatus.ACTIVE, ComplexStatus.PENDING_SETUP];

interface Notice {
  type: NotificationType;
  priority: NotificationPriority;
  title: string;
  body: string;
  tone: 'warning' | 'danger';
  superAdmins?: { title: string; body: string };
}

/**
 * Avisos de vencimiento de la suscripción: 15, 7, 3 y 1 días antes, el día que
 * vence (arranca la gracia) y cuando se suspende.
 *
 * Cada aviso se registra en `subscription_reminders` ANTES de enviarse, con un
 * índice único: si el cron corre dos veces o en dos réplicas, solo el primero
 * que inserta la fila manda el aviso.
 */
@Injectable()
export class SubscriptionRemindersService {
  private readonly logger = new Logger(SubscriptionRemindersService.name);

  constructor(
    @InjectRepository(ResidentialComplex)
    private readonly complexRepo: Repository<ResidentialComplex>,
    @InjectRepository(SubscriptionReminder)
    private readonly reminderRepo: Repository<SubscriptionReminder>,
    private readonly subscriptionsService: SubscriptionsService,
    private readonly mailService: MailService,
    private readonly configService: ConfigService,
  ) {}

  /** Devuelve cuántos avisos se enviaron. */
  async sendDueReminders(now: Date = new Date()): Promise<number> {
    // Ventana: desde los que vencen en 16 días hasta los que vencieron hace un
    // mes (la suspensión llega a los 5 días; más atrás ya se avisó todo).
    const from = new Date(now.getTime() - 30 * 86_400_000);
    const to = new Date(
      now.getTime() + (EXPIRING_WINDOW_DAYS + 1) * 86_400_000,
    );

    const complexes = await this.complexRepo
      .createQueryBuilder('c')
      .select([
        'c.id',
        'c.name',
        'c.email',
        'c.plan',
        'c.status',
        'c.totalUnits',
        'c.subscriptionEndsAt',
        'c.subscriptionPricingMode',
        'c.subscriptionPrice',
        'c.subscriptionCycle',
      ])
      .where('c.deleted_at IS NULL')
      .andWhere('c.status IN (:...statuses)', { statuses: NOTIFIED_STATUSES })
      .andWhere('c.subscription_ends_at BETWEEN :from AND :to', { from, to })
      .getMany();

    let sent = 0;
    for (const complex of complexes) {
      try {
        if (await this.remindOne(complex, now)) sent++;
      } catch (err) {
        this.logger.error(
          `Aviso de suscripción fallido para ${complex.id}: ${(err as Error).message}`,
        );
      }
    }
    return sent;
  }

  private async remindOne(
    complex: ResidentialComplex,
    now: Date,
  ): Promise<boolean> {
    const endsAt = new Date(complex.subscriptionEndsAt);
    const milestone = currentReminderMilestone(endsAt, now);
    if (!milestone) return false;

    const claimed = await this.claim(complex.id, endsAt, milestone);
    if (!claimed) return false;

    const quote = await this.subscriptionsService
      .quoteFor(complex)
      .catch(() => null);
    const notice = this.buildNotice(complex, endsAt, milestone, now, quote);

    await this.subscriptionsService.notifyComplex({
      complexId: complex.id,
      type: notice.type,
      priority: notice.priority,
      title: notice.title,
      body: notice.body,
      metadata: {
        milestone,
        amount: quote?.configured ? quote.total : null,
        cycle: quote?.cycle ?? null,
        endsAt: endsAt.toISOString(),
        graceEndsAt: graceEndsAt(endsAt).toISOString(),
      },
      alsoSuperAdmins: notice.superAdmins,
    });

    if (complex.email) {
      await this.mailService
        .queueSubscriptionNoticeEmail({
          email: complex.email,
          complexId: complex.id,
          complexName: complex.name,
          title: notice.title,
          message: notice.body,
          note: STILL_WORKING,
          ctaUrl: `${this.configService.get<string>('FRONTEND_URL', '')}/dashboard/suscripcion`,
          tone: notice.tone,
        })
        .catch((err: Error) =>
          this.logger.warn(
            `No se pudo encolar el correo de suscripción de ${complex.id}: ${err.message}`,
          ),
        );
    }

    return true;
  }

  /** Inserta la fila del aviso; false si otro ya lo había enviado. */
  private async claim(
    complexId: string,
    endsAt: Date,
    milestone: ReminderMilestone,
  ): Promise<boolean> {
    const result = await this.reminderRepo
      .createQueryBuilder()
      .insert()
      .into(SubscriptionReminder)
      .values({ complexId, endsAt, milestone })
      .orIgnore()
      .returning(['id'])
      .execute();
    return (result.raw as unknown[]).length > 0;
  }

  private buildNotice(
    complex: ResidentialComplex,
    endsAt: Date,
    milestone: ReminderMilestone,
    now: Date,
    quote: SubscriptionQuote | null,
  ): Notice {
    const endDate = formatBogotaDate(endsAt);
    const graceDate = formatBogotaDate(graceEndsAt(endsAt));
    // "Debes renovarla por $ 333.200 (mensual, impuestos incluidos)."
    const renewFor = quote?.configured
      ? `Debes renovarla por ${formatCop(quote.total)} (${quote.cycle === 'ANNUAL' ? 'anual' : 'mensual'}, impuestos incluidos), el valor configurado para el conjunto.`
      : 'Comunícate con EntryLink para renovarla.';

    if (milestone === 'SUSPENDED') {
      return {
        type: NotificationType.SUBSCRIPTION_SUSPENDED,
        priority: NotificationPriority.HIGH,
        title: 'Suscripción suspendida',
        body: `La suscripción venció el ${endDate} y no se renovó. El panel administrativo quedó en solo lectura: puedes consultar todo, pero para hacer cambios debes renovar. ${renewFor}`,
        tone: 'danger',
        superAdmins: {
          title: 'Suscripción suspendida',
          body: `"${complex.name}" pasó la gracia sin renovar (venció el ${endDate}). Su administración quedó en solo lectura.`,
        },
      };
    }

    if (milestone === 'EXPIRED') {
      return {
        type: NotificationType.SUBSCRIPTION_EXPIRED,
        priority: NotificationPriority.HIGH,
        title: 'Tu suscripción venció',
        body: `La suscripción venció el ${endDate}. Tienes hasta el ${graceDate} para renovarla; después el panel administrativo quedará en solo lectura. ${renewFor}`,
        tone: 'danger',
        superAdmins: {
          title: 'Suscripción vencida',
          body: `"${complex.name}" venció el ${endDate}. Queda en gracia hasta el ${graceDate}.`,
        },
      };
    }

    const left = Math.max(daysUntil(endsAt, now), 1);
    return {
      type: NotificationType.SUBSCRIPTION_EXPIRING,
      priority:
        left <= 3 ? NotificationPriority.HIGH : NotificationPriority.NORMAL,
      title:
        left === 1
          ? `Tu suscripción vence ${endDate === formatBogotaDate(now) ? 'hoy' : 'mañana'}`
          : `Tu suscripción vence en ${left} días`,
      body: `La suscripción vence el ${endDate}. ${renewFor}`,
      tone: left <= 3 ? 'danger' : 'warning',
    };
  }
}
