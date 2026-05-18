import { assertGpsWithinComplex, calculateHaversineDistance, GpsComplexReference } from './gps.utils';
import { CustomError } from './errors.utils';

describe('calculateHaversineDistance', () => {
  it('retorna 0 cuando los puntos son idénticos', () => {
    expect(calculateHaversineDistance(4.711, -74.072, 4.711, -74.072)).toBe(0);
  });

  it('calcula distancia aproximada entre dos puntos conocidos', () => {
    // ~111 km por grado de latitud
    const dist = calculateHaversineDistance(0, 0, 1, 0);
    expect(dist).toBeGreaterThan(110_000);
    expect(dist).toBeLessThan(112_000);
  });
});

describe('assertGpsWithinComplex', () => {
  const complex = { id: 'c1', latitude: 4.711, longitude: -74.072, gpsRadius: 200 };

  it('no lanza error cuando el supervisor está dentro del radio', () => {
    expect(() => assertGpsWithinComplex(complex, 4.711, -74.072)).not.toThrow();
  });

  it('lanza CustomError cuando el supervisor está fuera del radio', () => {
    // ~1.1 km al norte
    expect(() => assertGpsWithinComplex(complex, 4.721, -74.072)).toThrow(CustomError);
  });

  it('no lanza error cuando el complejo no tiene coordenadas', () => {
    const noGps: GpsComplexReference = { id: 'c2', latitude: null, longitude: null, gpsRadius: 200 };
    expect(() => assertGpsWithinComplex(noGps, 0, 0)).not.toThrow();
  });
});
