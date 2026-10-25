import {
  decidePlanterAlerts,
  GENERIC_THRESHOLDS,
  isQuietTime,
  isThrottled,
  thresholdsFrom,
} from './planter-alert.rules';

/**
 * Reglas de alerta de la matera (PARTE D): qué se avisa con cada lectura, el
 * throttling de 6 h por tipo (24 h para offline) y las horas de silencio.
 */
describe('planter-alert.rules', () => {
  const potus = thresholdsFrom({
    thresholds: { suelo_sed: 30, suelo_exceso: 75, temp_min: 18, temp_max: 29 },
  });

  describe('decidePlanterAlerts', () => {
    it('sed por debajo de suelo_sed del perfil', () => {
      expect(decidePlanterAlerts({ soil: 20, tankHasWater: true }, [], potus)).toEqual(['thirsty']);
    });

    it('sin perfil usa los umbrales genéricos del firmware', () => {
      expect(thresholdsFrom(null)).toEqual(GENERIC_THRESHOLDS);
      expect(decidePlanterAlerts({ soil: 80, tankHasWater: true }, [], GENERIC_THRESHOLDS)).toEqual([]);
      expect(decidePlanterAlerts({ soil: 80, tankHasWater: true }, [], potus)).toEqual(['overwatered']);
    });

    it('depósito vacío', () => {
      expect(decidePlanterAlerts({ soil: 50, tankHasWater: false }, [], potus)).toEqual(['tank_empty']);
    });

    it('una subida de 15 puntos es "acaban de regar" y no también "sed"', () => {
      expect(
        decidePlanterAlerts({ soil: 28, tankHasWater: true }, [{ soil: 10, tankHasWater: true }], potus),
      ).toEqual(['watering']);
    });

    it('calor solo si se sostiene 3 lecturas seguidas', () => {
      const caliente = { soil: 50, tankHasWater: true, tempC: 33 };
      const normal = { soil: 50, tankHasWater: true, tempC: 24 };
      expect(decidePlanterAlerts(caliente, [caliente], potus)).toEqual([]);
      expect(decidePlanterAlerts(caliente, [caliente, normal], potus)).toEqual([]);
      expect(decidePlanterAlerts(caliente, [caliente, caliente], potus)).toEqual(['hot']);
    });

    it('frío sostenido; un sensor sin dato rompe la racha', () => {
      const frio = { soil: 50, tankHasWater: true, tempC: 10 };
      expect(decidePlanterAlerts(frio, [frio, frio], potus)).toEqual(['cold']);
      expect(decidePlanterAlerts(frio, [{ ...frio, tempC: null }, frio], potus)).toEqual([]);
    });
  });

  describe('isThrottled', () => {
    const ahora = new Date('2026-10-24T12:00:00Z');

    it('nunca enviado → no está limitado', () => {
      expect(isThrottled('thirsty', null, ahora)).toBe(false);
    });

    it('6 h por tipo', () => {
      expect(isThrottled('thirsty', new Date('2026-10-24T07:00:00Z'), ahora)).toBe(true);
      expect(isThrottled('thirsty', new Date('2026-10-24T05:59:00Z'), ahora)).toBe(false);
    });

    it('offline: 24 h', () => {
      expect(isThrottled('offline', new Date('2026-10-24T00:00:00Z'), ahora)).toBe(true);
      expect(isThrottled('offline', new Date('2026-10-23T11:00:00Z'), ahora)).toBe(false);
    });
  });

  describe('isQuietTime', () => {
    // 2026-10-24 03:30 UTC = 22:30 en Bogotá (UTC-5)
    const nocheBogota = new Date('2026-10-24T03:30:00Z');
    const mediodiaBogota = new Date('2026-10-24T17:00:00Z');

    it('franja que cruza la medianoche, en la zona horaria del conjunto', () => {
      const q = { start: '22:00', end: '07:00' };
      expect(isQuietTime(nocheBogota, q, 'America/Bogota')).toBe(true);
      expect(isQuietTime(mediodiaBogota, q, 'America/Bogota')).toBe(false);
    });

    it('franja dentro del mismo día y zona propia del aparato', () => {
      const q = { start: '12:00', end: '13:00', timeZone: 'America/Bogota' };
      expect(isQuietTime(mediodiaBogota, q, 'UTC')).toBe(true);
    });

    it('sin franja, franja vacía o zona inválida → no hay silencio', () => {
      expect(isQuietTime(nocheBogota, null, 'America/Bogota')).toBe(false);
      expect(isQuietTime(nocheBogota, { start: '22:00', end: '22:00' }, 'America/Bogota')).toBe(false);
      expect(isQuietTime(nocheBogota, { start: '22:00', end: '07:00', timeZone: 'Marte/Olympus' }, 'UTC')).toBe(false);
    });
  });
});
