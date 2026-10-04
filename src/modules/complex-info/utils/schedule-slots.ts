import { ComplexScheduleSlot } from '../entities/complex-schedule.entity';

const DAY_MINUTES = 24 * 60;

const toMinutes = (hhmm: string): number => {
  const [h, m] = hhmm.split(':').map(Number);
  return h * 60 + m;
};

/**
 * Minutos de la semana (0 = domingo 00:00) que ocupa una franja. Una franja que
 * cruza la medianoche sigue en el día siguiente; la del sábado sigue el
 * domingo.
 */
function weekRanges(slot: ComplexScheduleSlot): [number, number][] {
  const start = slot.dayOfWeek * DAY_MINUTES + toMinutes(slot.openTime);
  let end = slot.dayOfWeek * DAY_MINUTES + toMinutes(slot.closeTime);
  if (end <= start) end += DAY_MINUTES;
  const week = 7 * DAY_MINUTES;
  return end <= week
    ? [[start, end]]
    : [
        [start, week],
        [0, end - week],
      ];
}

/**
 * Franjas ordenadas por día y hora, o el motivo por el que no sirven: que abra
 * y cierre a la misma hora, o que se cruce con otra (también la que viene del
 * día anterior pasada la medianoche).
 */
export function normalizeSlots(
  slots: ComplexScheduleSlot[],
): { slots: ComplexScheduleSlot[] } | { error: string } {
  const sorted = slots
    .map((s) => ({
      dayOfWeek: s.dayOfWeek,
      openTime: s.openTime,
      closeTime: s.closeTime,
    }))
    .sort(
      (a, b) =>
        a.dayOfWeek - b.dayOfWeek ||
        toMinutes(a.openTime) - toMinutes(b.openTime),
    );

  if (sorted.some((s) => s.openTime === s.closeTime)) {
    return { error: 'Una franja no puede abrir y cerrar a la misma hora' };
  }

  const ranges = sorted.flatMap(weekRanges).sort((a, b) => a[0] - b[0]);
  for (let i = 1; i < ranges.length; i++) {
    if (ranges[i][0] < ranges[i - 1][1]) {
      return { error: 'Hay franjas que se cruzan en el mismo día' };
    }
  }
  return { slots: sorted };
}
