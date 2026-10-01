import { SubscriptionStatus } from '../enums/subscription-status.enum';

/**
 * Reglas del ciclo de vida de la suscripción.
 *
 * Viven en un archivo sin dependencias de Nest porque las usan el guard de
 * shared (que no puede importar módulos de negocio), el cron y los resolvers:
 * si cada uno calculara el estado a su manera, el banner diría "vigente"
 * mientras el guard ya está bloqueando.
 */
export const EXPIRING_WINDOW_DAYS = 15;
export const GRACE_DAYS = 5;
export const TRIAL_DAYS = 30;
export const INITIAL_PERIOD_DAYS = 30;
/** El plan anual cuesta 10 mensualidades y cubre 12 meses. */
export const ANNUAL_MONTHS_CHARGED = 10;

/** Días antes del vencimiento en que se avisa al complejo, de mayor a menor. */
export const REMINDER_DAYS = [15, 7, 3, 1] as const;

const DAY_MS = 24 * 60 * 60 * 1000;

export const addDays = (date: Date, days: number): Date =>
  new Date(date.getTime() + days * DAY_MS);

/**
 * Días que faltan para el vencimiento, redondeados hacia arriba: si vence en
 * 6 horas falta "1 día", y desde que vence da 0 o negativo.
 */
export function daysUntil(endsAt: Date, now: Date = new Date()): number {
  return Math.ceil((endsAt.getTime() - now.getTime()) / DAY_MS);
}

export function graceEndsAt(endsAt: Date): Date {
  return addDays(endsAt, GRACE_DAYS);
}

export function computeSubscriptionStatus(
  endsAt: Date | string | null | undefined,
  now: Date = new Date(),
): SubscriptionStatus {
  if (!endsAt) return SubscriptionStatus.NONE;
  const end = endsAt instanceof Date ? endsAt : new Date(endsAt);
  if (Number.isNaN(end.getTime())) return SubscriptionStatus.NONE;

  if (now.getTime() < end.getTime()) {
    return daysUntil(end, now) <= EXPIRING_WINDOW_DAYS
      ? SubscriptionStatus.EXPIRING
      : SubscriptionStatus.ACTIVE;
  }

  return now.getTime() < graceEndsAt(end).getTime()
    ? SubscriptionStatus.GRACE
    : SubscriptionStatus.SUSPENDED;
}

/**
 * Suma un mes o un año calendario. Si el día no existe en el mes destino
 * (31 de enero + 1 mes) se queda en el último día de ese mes, no se desborda
 * a marzo.
 */
export function addBillingPeriod(
  start: Date,
  cycle: 'MONTHLY' | 'ANNUAL',
): Date {
  const months = cycle === 'ANNUAL' ? 12 : 1;
  const result = new Date(start.getTime());
  const day = result.getUTCDate();
  result.setUTCDate(1);
  result.setUTCMonth(result.getUTCMonth() + months);
  const lastDay = new Date(
    Date.UTC(result.getUTCFullYear(), result.getUTCMonth() + 1, 0),
  ).getUTCDate();
  result.setUTCDate(Math.min(day, lastDay));
  return result;
}

/** Hitos de aviso. El texto se guarda tal cual en subscription_reminders. */
export type ReminderMilestone =
  'D15' | 'D7' | 'D3' | 'D1' | 'EXPIRED' | 'SUSPENDED';

/**
 * Hito de aviso que corresponde hoy.
 *
 * No exige que el cron caiga justo el día 15, 7, 3 o 1: devuelve el hito más
 * cercano ya alcanzado. Si el servidor estuvo caído y hoy faltan 6 días, toca
 * el aviso de 7 (si no se envió); no se mandan de golpe los atrasados.
 */
export function currentReminderMilestone(
  endsAt: Date,
  now: Date = new Date(),
): ReminderMilestone | null {
  const status = computeSubscriptionStatus(endsAt, now);
  if (status === SubscriptionStatus.SUSPENDED) return 'SUSPENDED';
  if (status === SubscriptionStatus.GRACE) return 'EXPIRED';
  if (status !== SubscriptionStatus.EXPIRING) return null;

  const left = daysUntil(endsAt, now);
  const reached = REMINDER_DAYS.filter((d) => left <= d);
  return reached.length
    ? (`D${reached[reached.length - 1]}` as ReminderMilestone)
    : null;
}
