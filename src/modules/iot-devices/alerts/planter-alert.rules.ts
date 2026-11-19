/**
 * Reglas de alerta de la matera. Funciones PURAS (sin BD ni red): deciden qué
 * avisar a partir de la lectura actual, las anteriores y el perfil de planta.
 * El throttling (1 aviso por tipo cada 6 h) y las horas de silencio se aplican
 * después, en el processor, con `isThrottled` / `isQuietTime`.
 *
 * Se usan los datos (suelo, depósito, temperatura) y no el nombre de la cara:
 * muchas caras son de interacción o de fechas y no dicen nada de la planta.
 */
export type PlanterAlertKind =
  | 'thirsty'
  | 'tank_empty'
  | 'watering'
  | 'overwatered'
  | 'hot'
  | 'cold'
  | 'offline';

export interface ReadingForRules {
  soil: number;
  tankHasWater: boolean;
  tempC?: number | null;
}

/** Umbrales del perfil (mismos nombres que set_plant). Sin perfil: los genéricos del firmware. */
export interface PlantThresholds {
  suelo_sed: number;
  suelo_exceso: number;
  temp_min: number;
  temp_max: number;
}

export const GENERIC_THRESHOLDS: PlantThresholds = {
  suelo_sed: 30,
  suelo_exceso: 92,
  temp_min: 12,
  temp_max: 30,
};

/** Subida de humedad que cuenta como "acaban de regar". */
export const WATERING_JUMP = 15;
/** hot/cold solo si se sostiene este número de lecturas seguidas. */
export const SUSTAINED_READINGS = 3;

export const THROTTLE_MS: Record<PlanterAlertKind, number> = {
  thirsty: 6 * 3600_000,
  tank_empty: 6 * 3600_000,
  watering: 6 * 3600_000,
  overwatered: 6 * 3600_000,
  hot: 6 * 3600_000,
  cold: 6 * 3600_000,
  offline: 24 * 3600_000,
};

export function thresholdsFrom(
  plant?: { thresholds?: Record<string, unknown> } | null,
): PlantThresholds {
  const t = plant?.thresholds ?? {};
  const n = (k: keyof PlantThresholds) =>
    typeof t[k] === 'number' && Number.isFinite(t[k])
      ? t[k]
      : GENERIC_THRESHOLDS[k];
  return {
    suelo_sed: n('suelo_sed'),
    suelo_exceso: n('suelo_exceso'),
    temp_min: n('temp_min'),
    temp_max: n('temp_max'),
  };
}

/**
 * @param current  lectura que acaba de llegar
 * @param previous lecturas anteriores, de la más reciente a la más vieja
 */
export function decidePlanterAlerts(
  current: ReadingForRules,
  previous: ReadingForRules[],
  th: PlantThresholds,
): PlanterAlertKind[] {
  const kinds: PlanterAlertKind[] = [];
  const anterior = previous[0];

  if (!current.tankHasWater) kinds.push('tank_empty');
  if (anterior && current.soil - anterior.soil >= WATERING_JUMP)
    kinds.push('watering');
  else if (current.soil < th.suelo_sed) kinds.push('thirsty');
  if (current.soil > th.suelo_exceso) kinds.push('overwatered');

  const ultimas = [current, ...previous].slice(0, SUSTAINED_READINGS);
  if (ultimas.length === SUSTAINED_READINGS) {
    const temps = ultimas.map((r) => r.tempC);
    if (temps.every((c) => typeof c === 'number' && c > th.temp_max))
      kinds.push('hot');
    if (temps.every((c) => typeof c === 'number' && c < th.temp_min))
      kinds.push('cold');
  }
  return kinds;
}

export function isThrottled(
  kind: string,
  lastSentAt: Date | null | undefined,
  now: Date,
): boolean {
  if (!lastSentAt) return false;
  const ventana = THROTTLE_MS[kind as PlanterAlertKind] ?? THROTTLE_MS.thirsty;
  return now.getTime() - lastSentAt.getTime() < ventana;
}

export interface QuietHours {
  start: string; // "22:00"
  end: string; // "07:00"
  timeZone?: string;
}

const minutos = (hhmm: string): number | null => {
  const m = /^([01]?\d|2[0-3]):([0-5]\d)$/.exec(hhmm ?? '');
  return m ? Number(m[1]) * 60 + Number(m[2]) : null;
};

/** ¿Está `now` dentro de las horas de silencio? Admite franjas que cruzan la medianoche. */
export function isQuietTime(
  now: Date,
  quiet: QuietHours | null | undefined,
  defaultTimeZone: string,
): boolean {
  if (!quiet) return false;
  const ini = minutos(quiet.start);
  const fin = minutos(quiet.end);
  if (ini === null || fin === null || ini === fin) return false;
  let partes: Intl.DateTimeFormatPart[];
  try {
    partes = new Intl.DateTimeFormat('en-GB', {
      timeZone: quiet.timeZone || defaultTimeZone,
      hour: '2-digit',
      minute: '2-digit',
      hourCycle: 'h23',
    }).formatToParts(now);
  } catch {
    return false; // zona horaria inválida: mejor avisar que callar
  }
  const h = Number(partes.find((p) => p.type === 'hour')?.value);
  const m = Number(partes.find((p) => p.type === 'minute')?.value);
  const actual = h * 60 + m;
  return ini < fin
    ? actual >= ini && actual < fin
    : actual >= ini || actual < fin;
}

/** Texto del push (español, como el resto de EntryLink). */
export function alertText(
  kind: PlanterAlertKind,
  deviceName: string,
  r?: ReadingForRules & { previousSoil?: number },
): { title: string; body: string } {
  switch (kind) {
    case 'thirsty':
      return {
        title: `${deviceName} tiene sed`,
        body: `La tierra está al ${r?.soil ?? '?'} %. Es hora de regar.`,
      };
    case 'tank_empty':
      return {
        title: 'El depósito está vacío',
        body: `Rellena el depósito de agua de ${deviceName}.`,
      };
    case 'watering':
      return {
        title: '¡Gracias por regar!',
        body: `${deviceName} recibió agua (${r?.previousSoil ?? '?'} % → ${r?.soil ?? '?'} %).`,
      };
    case 'overwatered':
      return {
        title: 'Demasiada agua',
        body: `La tierra de ${deviceName} está al ${r?.soil ?? '?'} %. Deja que drene.`,
      };
    case 'hot':
      return {
        title: 'Hace mucho calor',
        body: `${deviceName} lleva un rato a ${r?.tempC ?? '?'} °C.`,
      };
    case 'cold':
      return {
        title: 'Hace frío',
        body: `${deviceName} lleva un rato a ${r?.tempC ?? '?'} °C.`,
      };
    case 'offline':
      return {
        title: `${deviceName} está sin conexión`,
        body: 'No reporta desde hace más de 2 horas. Revisa el WiFi o la batería.',
      };
  }
}
