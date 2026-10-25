/**
 * Telemetría de la matera (CONTRATO_REAL.md §3). Llega IGUAL por MQTT y por
 * POST /iot/devices/telemetry; este parser es el único sitio que la interpreta.
 * Es tolerante: un campo raro se ignora en lugar de perder la lectura entera.
 */
export interface PlanterTelemetry {
  fw?: string;
  measuredAt: Date;
  /** true si `ts` no venía o no era creíble y se usó la hora de llegada. */
  tsFromServer: boolean;
  queued: boolean;
  soil: number;
  soilRaw: number | null;
  tankHasWater: boolean;
  lux: number | null;
  tempC: number | null;
  hum: number | null;
  battery: number;
  batteryPct: number | null;
  power: 'usb' | 'battery' | null;
  mood: string | null;
  motion: boolean | null;
  tilt: number | null;
  plantId: string | null;
  faults: string[];
  rssi: number | null;
}

/** ok → value; !ok → error. (Sin unión discriminada: el proyecto no usa strictNullChecks.) */
export interface ParseResult {
  ok: boolean;
  value?: PlanterTelemetry;
  error?: string;
}

/** 2020-09-13: antes de esto el firmware aún no tiene hora (NTP). */
const TS_MIN = 1_600_000_000;
/** Un reloj adelantado más de esto se descarta. */
const FUTURO_MAX_MS = 24 * 3600 * 1000;

const num = (v: unknown): number | null =>
  typeof v === 'number' && Number.isFinite(v) ? v : null;
const int = (v: unknown): number | null => {
  const n = num(v);
  return n === null ? null : Math.round(n);
};
const str = (v: unknown, max: number): string | null =>
  typeof v === 'string' && v.length > 0 ? v.slice(0, max) : null;

export function parsePlanterTelemetry(
  raw: unknown,
  now: Date = new Date(),
): ParseResult {
  if (!raw || typeof raw !== 'object' || Array.isArray(raw))
    return { ok: false, error: 'invalid_json' };
  const d = raw as Record<string, unknown>;
  if (d.type !== undefined && d.type !== 'SMART_PLANTER')
    return { ok: false, error: 'unsupported_type' };

  const soil = int(d.soil);
  const battery = num(d.battery);
  if (soil === null || soil < 0 || soil > 100)
    return { ok: false, error: 'bad_soil' };
  if (battery === null) return { ok: false, error: 'bad_battery' };
  if (d.tank !== 'ok' && d.tank !== 'empty')
    return { ok: false, error: 'bad_tank' };

  const ts = num(d.ts);
  const tsCreible =
    ts !== null && ts >= TS_MIN && ts * 1000 <= now.getTime() + FUTURO_MAX_MS;
  const faults = Array.isArray(d.faults)
    ? d.faults
        .filter((f): f is string => typeof f === 'string')
        .map((f) => f.slice(0, 40))
        .slice(0, 10)
    : [];

  return {
    ok: true,
    value: {
      fw: str(d.fw, 32) ?? undefined,
      measuredAt: tsCreible ? new Date(ts * 1000) : now,
      tsFromServer: !tsCreible,
      queued: d.queued === true,
      soil,
      soilRaw: int(d.soilRaw),
      tankHasWater: d.tank === 'ok',
      lux: num(d.lux),
      tempC: num(d.tempC),
      hum: int(d.hum),
      battery,
      batteryPct: int(d.batteryPct),
      power: d.power === 'usb' || d.power === 'battery' ? d.power : null,
      mood: str(d.face, 40),
      motion: typeof d.motion === 'boolean' ? d.motion : null,
      tilt: int(d.tilt),
      plantId: str(d.plantId, 64),
      faults,
      rssi: int(d.rssi),
    },
  };
}
