/**
 * Días hábiles en Colombia (lunes a viernes, sin festivos), para los plazos de
 * la Ley 1581: consultas 10 días hábiles (+5 de prórroga) y reclamos 15
 * (+8). Los plazos exactos están pendientes de confirmación jurídica.
 *
 * Festivos según la Ley 51 de 1983 (Emiliani): algunos se trasladan al lunes
 * siguiente. Las fechas se calculan en la zona horaria de Bogotá (UTC-5, sin
 * horario de verano).
 */

const BOGOTA_OFFSET_MS = -5 * 60 * 60 * 1000;

/** Fecha civil en Bogotá como Date UTC a medianoche (solo año-mes-día). */
function bogotaDate(instant: Date): Date {
  const local = new Date(instant.getTime() + BOGOTA_OFFSET_MS);
  return new Date(
    Date.UTC(local.getUTCFullYear(), local.getUTCMonth(), local.getUTCDate()),
  );
}

function addDays(date: Date, days: number): Date {
  return new Date(date.getTime() + days * 86_400_000);
}

/** Domingo de Pascua (algoritmo de Meeus/Jones/Butcher). */
function easterSunday(year: number): Date {
  const a = year % 19;
  const b = Math.floor(year / 100);
  const c = year % 100;
  const d = Math.floor(b / 4);
  const e = b % 4;
  const f = Math.floor((b + 8) / 25);
  const g = Math.floor((b - f + 1) / 3);
  const h = (19 * a + b - d - g + 15) % 30;
  const i = Math.floor(c / 4);
  const k = c % 4;
  const l = (32 + 2 * e + 2 * i - h - k) % 7;
  const m = Math.floor((a + 11 * h + 22 * l) / 451);
  const month = Math.floor((h + l - 7 * m + 114) / 31);
  const day = ((h + l - 7 * m + 114) % 31) + 1;
  return new Date(Date.UTC(year, month - 1, day));
}

/** Traslado Emiliani: si no cae lunes, pasa al lunes siguiente. */
function nextMonday(date: Date): Date {
  const dow = date.getUTCDay();
  return dow === 1 ? date : addDays(date, (8 - dow) % 7);
}

const holidayCache = new Map<number, Set<string>>();

export function colombianHolidays(year: number): Set<string> {
  const cached = holidayCache.get(year);
  if (cached) return cached;

  const d = (month: number, day: number) =>
    new Date(Date.UTC(year, month - 1, day));
  const easter = easterSunday(year);

  const holidays = [
    d(1, 1),
    d(5, 1),
    d(7, 20),
    d(8, 7),
    d(12, 8),
    d(12, 25),
    addDays(easter, -3), // Jueves Santo
    addDays(easter, -2), // Viernes Santo
    nextMonday(d(1, 6)),
    nextMonday(d(3, 19)),
    nextMonday(d(6, 29)),
    nextMonday(d(8, 15)),
    nextMonday(d(10, 12)),
    nextMonday(d(11, 1)),
    nextMonday(d(11, 11)),
    addDays(easter, 43), // Ascensión (lunes)
    addDays(easter, 64), // Corpus Christi (lunes)
    addDays(easter, 71), // Sagrado Corazón (lunes)
  ].map((date) => date.toISOString().slice(0, 10));

  const set = new Set(holidays);
  holidayCache.set(year, set);
  return set;
}

export function isBusinessDay(date: Date): boolean {
  const dow = date.getUTCDay();
  if (dow === 0 || dow === 6) return false;
  return !colombianHolidays(date.getUTCFullYear()).has(
    date.toISOString().slice(0, 10),
  );
}

/**
 * Fin del plazo: se cuentan `days` días hábiles desde el día hábil siguiente a
 * la recepción, y vence al terminar ese día en Bogotá (23:59:59.999 UTC-5).
 */
export function addBusinessDays(receivedAt: Date, days: number): Date {
  let cursor = bogotaDate(receivedAt);
  let counted = 0;
  while (counted < days) {
    cursor = addDays(cursor, 1);
    if (isBusinessDay(cursor)) counted++;
  }
  // Fin del día en Bogotá = día siguiente 05:00 UTC menos 1 ms.
  return new Date(addDays(cursor, 1).getTime() - BOGOTA_OFFSET_MS - 1);
}
