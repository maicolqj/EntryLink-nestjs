import { SubscriptionStatus } from '../enums/subscription-status.enum';
import {
  addBillingPeriod,
  computeSubscriptionStatus,
  currentReminderMilestone,
  daysUntil,
  earliestCutDate,
  isAutomationPaused,
  nextCutStep,
  parseCutMode,
  pausedBillingDates,
  pausedDaysBetween,
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

describe('daysUntil', () => {
  // Pago registrado el 30 de septiembre a las 3:00 p. m. (Bogotá): vence el
  // 30 de octubre a la misma hora.
  const paidAt = new Date('2026-09-30T20:00:00.000Z');
  const endsAt = addBillingPeriod(paidAt, 'MONTHLY');

  it('el día del pago faltan 30 días', () => {
    expect(daysUntil(endsAt, paidAt)).toBe(30);
  });

  it('al día siguiente baja a 29, a cualquier hora', () => {
    expect(daysUntil(endsAt, new Date('2026-10-01T13:00:00.000Z'))).toBe(29);
    expect(daysUntil(endsAt, new Date('2026-10-02T04:30:00.000Z'))).toBe(29);
  });

  it('cuenta días de calendario de Colombia, no bloques de 24 horas', () => {
    // 11:30 p. m. del 1 de octubre en Bogotá (ya es 2 de octubre en UTC).
    expect(daysUntil(endsAt, new Date('2026-10-02T04:30:00.000Z'))).toBe(29);
    // 12:30 a. m. del 2 de octubre en Bogotá.
    expect(daysUntil(endsAt, new Date('2026-10-02T05:30:00.000Z'))).toBe(28);
  });

  it('el día del vencimiento es 0 ("vence hoy") y después es negativo', () => {
    expect(daysUntil(endsAt, new Date('2026-10-30T14:00:00.000Z'))).toBe(0);
    expect(daysUntil(endsAt, new Date('2026-11-01T14:00:00.000Z'))).toBe(-2);
  });
});

describe('isAutomationPaused', () => {
  it('no pausa con la fecha vacía', () => {
    expect(isAutomationPaused(null, NOW)).toBe(false);
  });

  it('no pausa durante la gracia', () => {
    expect(isAutomationPaused(inDays(-4), NOW)).toBe(false);
  });

  it('pausa desde el quinto día después de vencer', () => {
    expect(isAutomationPaused(inDays(-5), NOW)).toBe(true);
  });
});

describe('pausedDaysBetween', () => {
  const windows = [{ pausedAt: inDays(-20), resumedAt: inDays(-10) }];

  it('cuenta solo los días que se cruzan con la pausa', () => {
    expect(pausedDaysBetween(inDays(-15), NOW, windows)).toBe(5);
  });

  it('cuenta la pausa completa si el rango la contiene', () => {
    expect(pausedDaysBetween(inDays(-30), NOW, windows)).toBe(10);
  });

  it('da cero si el rango empieza después de la pausa', () => {
    expect(pausedDaysBetween(inDays(-5), NOW, windows)).toBe(0);
  });

  it('suma varias pausas', () => {
    const two = [...windows, { pausedAt: inDays(-8), resumedAt: inDays(-6) }];
    expect(pausedDaysBetween(inDays(-30), NOW, two)).toBe(12);
  });
});

describe('pausedBillingDates', () => {
  it('va del día siguiente a la pausa hasta el día de reanudar', () => {
    const dates = pausedBillingDates(
      new Date('2026-09-20T13:00:00.000Z'),
      new Date('2026-10-02T13:00:00.000Z'),
    );

    expect(dates[0]).toEqual({ period: '2026-09', day: 21 });
    expect(dates[dates.length - 1]).toEqual({ period: '2026-10', day: 2 });
    expect(dates).toHaveLength(12);
  });

  it('usa el calendario de Colombia', () => {
    // 11:30 p. m. del 20 en Bogotá: en UTC ya es 21.
    const dates = pausedBillingDates(
      new Date('2026-09-21T04:30:00.000Z'),
      new Date('2026-09-22T13:00:00.000Z'),
    );

    expect(dates).toEqual([
      { period: '2026-09', day: 21 },
      { period: '2026-09', day: 22 },
    ]);
  });

  it('no recupera más de 12 meses', () => {
    const dates = pausedBillingDates(
      new Date('2024-01-15T13:00:00.000Z'),
      new Date('2026-10-02T13:00:00.000Z'),
    );

    const periods = new Set(dates.map((d) => d.period));
    expect(periods.size).toBe(12);
    expect(dates[0]).toEqual({ period: '2025-11', day: 1 });
  });
});

describe('nextCutStep', () => {
  const none: (Date | null)[] = [null, null, null];

  it('el día 9 no hace nada', () => {
    expect(nextCutStep(inDays(-9), none, NOW)).toBeNull();
  });

  it('el día 10 toca el aviso 1', () => {
    expect(nextCutStep(inDays(-10), none, NOW)).toEqual({
      kind: 'NOTICE',
      index: 0,
    });
  });

  it('el día 20 con el aviso 1 de hace 10 días toca el aviso 2', () => {
    expect(nextCutStep(inDays(-20), [inDays(-10), null, null], NOW)).toEqual({
      kind: 'NOTICE',
      index: 1,
    });
  });

  it('el día 40 sin avisos solo toca el aviso 1', () => {
    expect(nextCutStep(inDays(-40), none, NOW)).toEqual({
      kind: 'NOTICE',
      index: 0,
    });
  });

  it('el día 47 con el aviso 1 de hace 6 días no hace nada', () => {
    expect(nextCutStep(inDays(-47), [inDays(-6), null, null], NOW)).toBeNull();
  });

  it('el día 30 con el último aviso de hace 3 días corta', () => {
    expect(
      nextCutStep(inDays(-30), [inDays(-20), inDays(-10), inDays(-3)], NOW),
    ).toEqual({ kind: 'CUT' });
  });

  it('el día 35 con el último aviso de hace 2 días no corta', () => {
    expect(
      nextCutStep(inDays(-35), [inDays(-20), inDays(-10), inDays(-2)], NOW),
    ).toBeNull();
  });

  it('no corta antes del día 30', () => {
    expect(
      nextCutStep(inDays(-29), [inDays(-20), inDays(-10), inDays(-5)], NOW),
    ).toBeNull();
  });

  it('el aviso de ayer a las 08:00:05 cuenta como día completo a las 08:00:02', () => {
    const ayer = new Date('2026-10-24T13:00:05.000Z');
    const hoy = new Date('2026-10-31T13:00:02.000Z');
    const endsAt = new Date('2026-10-01T13:00:00.000Z');

    expect(nextCutStep(endsAt, [ayer, null, null], hoy)).toEqual({
      kind: 'NOTICE',
      index: 1,
    });
  });
});

describe('earliestCutDate', () => {
  it('en el camino normal es el día 30', () => {
    expect(
      earliestCutDate(inDays(-10), [null, null, null], NOW).getTime(),
    ).toBe(inDays(20).getTime());
  });

  it('un conjunto muy atrasado espera los tres avisos', () => {
    // Aviso 1 hoy, aviso 2 a los 7 días, aviso 3 a los 14 y corte a los 17.
    expect(
      earliestCutDate(inDays(-40), [null, null, null], NOW).getTime(),
    ).toBe(inDays(17).getTime());
  });
});

describe('parseCutMode', () => {
  it('reconoce los modos válidos', () => {
    expect(parseCutMode('access')).toBe('access');
    expect(parseCutMode('access_and_panic')).toBe('access_and_panic');
  });

  it('cualquier otro valor queda apagado', () => {
    expect(parseCutMode(undefined)).toBe('off');
    expect(parseCutMode('')).toBe('off');
    expect(parseCutMode('todo')).toBe('off');
  });
});
