import { RotationIntervalUnit } from '../enums/rotation-interval-unit.enum';

/** Hora local (Bogotá) a la que corre el cron de rotación. */
export const ROTATION_HOUR = 6;

/** Bogotá es UTC-5 todo el año: no tiene horario de verano. */
const BOGOTA_OFFSET_MS = 5 * 60 * 60 * 1000;

/**
 * Próxima rotación: el día que toca según el intervalo, a las 6 a. m. de
 * Bogotá.
 *
 * Antes se sumaba el intervalo al instante exacto de la ejecución. El cron
 * corre a las 06:00:00 y guardaba, por ejemplo, 06:00:01 de mañana; al día
 * siguiente volvía a correr a las 06:00:00, la fecha aún no había llegado por un
 * segundo y la rotación se saltaba ese día. Con la primera ejecución manual
 * pasaba lo mismo a cualquier hora (una a las 2 p. m. dejaba la siguiente para
 * las 2 p. m., y el cron solo mira a las 6). Una rotación "cada día" terminaba
 * corriendo cada dos o tres días.
 */
export function calcNextRotation(
  from: Date,
  value: number,
  unit: RotationIntervalUnit,
): Date {
  // Los campos UTC de `local` son la fecha y hora de Bogotá.
  const local = new Date(from.getTime() - BOGOTA_OFFSET_MS);
  switch (unit) {
    case RotationIntervalUnit.DAYS:
      local.setUTCDate(local.getUTCDate() + value);
      break;
    case RotationIntervalUnit.WEEKS:
      local.setUTCDate(local.getUTCDate() + value * 7);
      break;
    case RotationIntervalUnit.MONTHS:
      local.setUTCMonth(local.getUTCMonth() + value);
      break;
  }
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate(),
      ROTATION_HOUR,
    ) + BOGOTA_OFFSET_MS,
  );
}

/**
 * Último instante del día de Bogotá que contiene `now`.
 *
 * El cron compara contra esto y no contra `now`: la rotación es por día, así
 * que vence todo lo programado para hoy aunque su hora sea posterior. Así se
 * ponen al día las fechas guardadas con el cálculo anterior (06:00:01, 2 p. m.).
 */
export function endOfBogotaDay(now: Date): Date {
  const local = new Date(now.getTime() - BOGOTA_OFFSET_MS);
  return new Date(
    Date.UTC(
      local.getUTCFullYear(),
      local.getUTCMonth(),
      local.getUTCDate() + 1,
    ) +
      BOGOTA_OFFSET_MS -
      1,
  );
}

/**
 * Cuándo va a correr de verdad la rotación, para mostrarlo.
 *
 * La fecha guardada puede quedar en el pasado: el cron no corrió ese día (el
 * servidor estaba caído a las 6 a. m.) o quedó del cálculo anterior a
 * `calcNextRotation`. El cron la toma en su siguiente pasada, así que mostrarla
 * tal cual anuncia una rotación que ya no va a pasar ese día. Corre el día que
 * llegue primero entre la fecha guardada y la próxima pasada del cron.
 */
export function effectiveNextRotation(
  next: Date | null | undefined,
  now: Date,
): Date | null {
  if (!next) return null;
  const scheduled = calcNextRotation(next, 0, RotationIntervalUnit.DAYS);
  const todayRun = calcNextRotation(now, 0, RotationIntervalUnit.DAYS);
  const nextCronRun =
    now < todayRun
      ? todayRun
      : calcNextRotation(now, 1, RotationIntervalUnit.DAYS);
  return scheduled > nextCronRun ? scheduled : nextCronRun;
}
