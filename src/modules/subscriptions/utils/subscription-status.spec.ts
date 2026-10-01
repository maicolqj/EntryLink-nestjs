import { SubscriptionStatus } from '../enums/subscription-status.enum';
import {
  addBillingPeriod,
  computeSubscriptionStatus,
  currentReminderMilestone,
} from './subscription-status';

const NOW = new Date('2026-10-01T13:00:00.000Z');
const inDays = (d: number) => new Date(NOW.getTime() + d * 86_400_000);

describe('computeSubscriptionStatus', () => {
  it('sin vencimiento no hay suscripción y no se restringe nada', () => {
    expect(computeSubscriptionStatus(null, NOW)).toBe(SubscriptionStatus.NONE);
  });

  it('vigente con más de 15 días', () => {
    expect(computeSubscriptionStatus(inDays(16), NOW)).toBe(
      SubscriptionStatus.ACTIVE,
    );
  });

  it('por vencer con 15 días o menos', () => {
    expect(computeSubscriptionStatus(inDays(15), NOW)).toBe(
      SubscriptionStatus.EXPIRING,
    );
    expect(computeSubscriptionStatus(inDays(0.2), NOW)).toBe(
      SubscriptionStatus.EXPIRING,
    );
  });

  it('en gracia los 5 días después de vencer', () => {
    expect(computeSubscriptionStatus(inDays(-1), NOW)).toBe(
      SubscriptionStatus.GRACE,
    );
    expect(computeSubscriptionStatus(inDays(-4.9), NOW)).toBe(
      SubscriptionStatus.GRACE,
    );
  });

  it('suspendida pasada la gracia', () => {
    expect(computeSubscriptionStatus(inDays(-5), NOW)).toBe(
      SubscriptionStatus.SUSPENDED,
    );
  });

  it('acepta la fecha como texto (así vuelve de la caché)', () => {
    expect(computeSubscriptionStatus(inDays(-10).toISOString(), NOW)).toBe(
      SubscriptionStatus.SUSPENDED,
    );
  });
});

describe('addBillingPeriod', () => {
  it('suma un mes calendario', () => {
    expect(
      addBillingPeriod(
        new Date('2026-10-01T13:00:00Z'),
        'MONTHLY',
      ).toISOString(),
    ).toBe('2026-11-01T13:00:00.000Z');
  });

  it('el 31 de enero + 1 mes queda en el último día de febrero', () => {
    expect(
      addBillingPeriod(
        new Date('2027-01-31T13:00:00Z'),
        'MONTHLY',
      ).toISOString(),
    ).toBe('2027-02-28T13:00:00.000Z');
  });

  it('suma un año calendario', () => {
    expect(
      addBillingPeriod(
        new Date('2026-10-01T13:00:00Z'),
        'ANNUAL',
      ).toISOString(),
    ).toBe('2027-10-01T13:00:00.000Z');
  });
});

describe('currentReminderMilestone', () => {
  it('sin aviso si faltan más de 15 días', () => {
    expect(currentReminderMilestone(inDays(20), NOW)).toBeNull();
  });

  it('el hito alcanzado más cercano', () => {
    expect(currentReminderMilestone(inDays(15), NOW)).toBe('D15');
    expect(currentReminderMilestone(inDays(10), NOW)).toBe('D15');
    expect(currentReminderMilestone(inDays(6), NOW)).toBe('D7');
    expect(currentReminderMilestone(inDays(3), NOW)).toBe('D3');
    expect(currentReminderMilestone(inDays(0.5), NOW)).toBe('D1');
  });

  it('vencida y suspendida', () => {
    expect(currentReminderMilestone(inDays(-1), NOW)).toBe('EXPIRED');
    expect(currentReminderMilestone(inDays(-6), NOW)).toBe('SUSPENDED');
  });
});
