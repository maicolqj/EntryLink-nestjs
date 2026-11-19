import { parsePlanterTelemetry } from './planter-telemetry.parser';

/** JSON real que publicó la placa en las pruebas de la Fase 4. */
const REAL = {
  type: 'SMART_PLANTER',
  fw: '0.4.0',
  ts: 1792892603,
  soil: 0,
  soilRaw: 30,
  tank: 'ok',
  lux: 7,
  tempC: 24.0,
  hum: 60,
  battery: 4.65,
  batteryPct: 100,
  power: 'battery',
  face: 'Dehydrated',
  motion: true,
  tilt: 3,
  plantId: 'epipremnum-aureum',
  plantProfile: 'species',
  soilIdeal: [40, 60],
  rssi: -71,
};

describe('parsePlanterTelemetry', () => {
  const ahora = new Date('2026-10-24T21:00:00Z');

  it('interpreta el JSON real del firmware', () => {
    const r = parsePlanterTelemetry(REAL, ahora);
    expect(r.ok).toBe(true);
    expect(r.value).toMatchObject({
      fw: '0.4.0',
      soil: 0,
      tankHasWater: true,
      mood: 'Dehydrated',
      power: 'battery',
      plantId: 'epipremnum-aureum',
      queued: false,
      tsFromServer: false,
    });
    expect(r.value.measuredAt.getTime()).toBe(1792892603 * 1000);
  });

  it('lectura de la cola: queued y su ts original; sin soilRaw ni rssi', () => {
    const cola: Record<string, unknown> = { ...REAL };
    delete cola.soilRaw;
    delete cola.rssi;
    const r = parsePlanterTelemetry(
      { ...cola, queued: true, ts: 1792890000 },
      ahora,
    );
    expect(r.value.queued).toBe(true);
    expect(r.value.soilRaw).toBeNull();
    expect(r.value.measuredAt.getTime()).toBe(1792890000 * 1000);
  });

  it('sin hora (ts null, antes del NTP) → hora de llegada', () => {
    const r = parsePlanterTelemetry({ ...REAL, ts: null }, ahora);
    expect(r.value.tsFromServer).toBe(true);
    expect(r.value.measuredAt).toEqual(ahora);
  });

  it('tank "empty" y sensores sin dato (null)', () => {
    const r = parsePlanterTelemetry(
      { ...REAL, tank: 'empty', lux: null, tempC: null, tilt: null },
      ahora,
    );
    expect(r.value).toMatchObject({
      tankHasWater: false,
      lux: null,
      tempC: null,
      tilt: null,
    });
  });

  it('faults del firmware', () => {
    const r = parsePlanterTelemetry(
      { ...REAL, faults: ['imu', 'battery_sensor'] },
      ahora,
    );
    expect(r.value.faults).toEqual(['imu', 'battery_sensor']);
  });

  it.each([
    ['no es un objeto', 'hola', 'invalid_json'],
    [
      'otro tipo de aparato',
      { ...REAL, type: 'SMART_LOCK' },
      'unsupported_type',
    ],
    ['suelo fuera de 0-100', { ...REAL, soil: 140 }, 'bad_soil'],
    ['sin batería', { ...REAL, battery: undefined }, 'bad_battery'],
    ['depósito con valor raro', { ...REAL, tank: true }, 'bad_tank'],
  ])('rechaza: %s', (_, entrada, error) => {
    expect(parsePlanterTelemetry(entrada, ahora)).toEqual({ ok: false, error });
  });
});
