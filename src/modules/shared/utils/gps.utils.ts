import { HttpStatus } from '@nestjs/common';
import { CustomError } from './errors.utils';
import { SupervisorErrorCode } from '../constans/error-codes.constants';

export interface GpsComplexReference {
  id: string;
  latitude?: number | null;
  longitude?: number | null;
  gpsRadius?: number | null;
}

/**
 * Fórmula de Haversine — distancia en metros entre dos puntos GPS.
 */
export function calculateHaversineDistance(
  lat1: number,
  lng1: number,
  lat2: number,
  lng2: number,
): number {
  const R = 6_371_000;
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Valida que (lat, lng) estén dentro del radio GPS del complejo.
 * Si el complejo no tiene coordenadas configuradas, la validación se omite.
 */
export function assertGpsWithinComplex(
  complex: GpsComplexReference,
  lat: number,
  lng: number,
): void {
  if (complex.latitude == null || complex.longitude == null) return;

  const radius = complex.gpsRadius ?? 200;
  const distance = calculateHaversineDistance(
    Number(complex.latitude),
    Number(complex.longitude),
    lat,
    lng,
  );

  if (distance > radius) {
    throw new CustomError({
      message: `Estás demasiado lejos del complejo (${Math.round(distance)} m). Debes estar dentro de un radio de ${radius} m`,
      statusCode: HttpStatus.FORBIDDEN,
      errorCode: SupervisorErrorCode.SUPERVISOR_OUT_OF_RANGE,
    });
  }
}
