import { RotationIntervalUnit } from '../enums/rotation-interval-unit.enum';
import {
  calcNextRotation,
  effectiveNextRotation,
  endOfBogotaDay,
} from './rotation-schedule';

// 06:00 Bogotá = 11:00 UTC.
const bogota = (isoLocal: string) => new Date(`${isoLocal}-05:00`);

describe('calcNextRotation', () => {
  it('cada día: mañana a las 6 a. m., aunque el cron haya corrido unos segundos tarde', () => {
    const next = calcNextRotation(
      bogota('2026-10-04T06:00:03'),
      1,
      RotationIntervalUnit.DAYS,
    );
    expect(next.toISOString()).toBe('2026-10-05T11:00:00.000Z');
  });

  it('la primera ejecución manual a las 2 p. m. deja la siguiente a las 6 a. m.', () => {
    const next = calcNextRotation(
      bogota('2026-10-04T14:30:00'),
      1,
      RotationIntervalUnit.DAYS,
    );
    expect(next.toISOString()).toBe('2026-10-05T11:00:00.000Z');
  });

  it('usa la fecha de Bogotá, no la UTC (11 p. m. en Bogotá ya es mañana en UTC)', () => {
    const next = calcNextRotation(
      bogota('2026-10-04T23:00:00'),
      1,
      RotationIntervalUnit.DAYS,
    );
    expect(next.toISOString()).toBe('2026-10-05T11:00:00.000Z');
  });

  it('semanas y meses', () => {
    const from = bogota('2026-10-04T06:00:00');
    expect(
      calcNextRotation(from, 2, RotationIntervalUnit.WEEKS).toISOString(),
    ).toBe('2026-10-18T11:00:00.000Z');
    expect(
      calcNextRotation(from, 1, RotationIntervalUnit.MONTHS).toISOString(),
    ).toBe('2026-11-04T11:00:00.000Z');
  });
});

describe('endOfBogotaDay + cron diario', () => {
  it('a las 6 a. m. vence lo programado para hoy, incluso una fecha vieja de 06:00:01 o 2 p. m.', () => {
    const cron = bogota('2026-10-05T06:00:00');
    const limit = endOfBogotaDay(cron);
    expect(bogota('2026-10-05T06:00:01') <= limit).toBe(true);
    expect(bogota('2026-10-05T14:00:00') <= limit).toBe(true);
    expect(bogota('2026-10-06T06:00:00') <= limit).toBe(false);
  });

  it('cada día rota todos los días durante una semana', () => {
    let next = calcNextRotation(
      bogota('2026-10-04T14:00:00'),
      1,
      RotationIntervalUnit.DAYS,
    );
    const runs: string[] = [];
    for (let d = 5; d <= 11; d++) {
      // El cron arranca con algo de retraso, como en producción.
      const cron = bogota(`2026-10-${String(d).padStart(2, '0')}T06:00:02`);
      if (next <= endOfBogotaDay(cron)) {
        runs.push(cron.toISOString().slice(0, 10));
        next = calcNextRotation(cron, 1, RotationIntervalUnit.DAYS);
      }
    }
    expect(runs).toHaveLength(7);
  });
});

describe('effectiveNextRotation', () => {
  it('fecha futura: se muestra a las 6 a. m. de ese día', () => {
    const shown = effectiveNextRotation(
      bogota('2026-10-08T06:00:00.239'),
      bogota('2026-10-04T18:15:00'),
    );
    expect(shown?.toISOString()).toBe('2026-10-08T11:00:00.000Z');
  });

  it('fecha de hoy que el cron ya saltó: se muestra mañana', () => {
    const shown = effectiveNextRotation(
      bogota('2026-10-04T06:00:00.239'),
      bogota('2026-10-04T18:15:00'),
    );
    expect(shown?.toISOString()).toBe('2026-10-05T11:00:00.000Z');
  });

  it('fecha vencida antes de las 6 a. m.: corre hoy', () => {
    const shown = effectiveNextRotation(
      bogota('2026-10-01T06:00:00'),
      bogota('2026-10-04T05:30:00'),
    );
    expect(shown?.toISOString()).toBe('2026-10-04T11:00:00.000Z');
  });

  it('sin fecha: null', () => {
    expect(effectiveNextRotation(null, new Date())).toBeNull();
  });
});
