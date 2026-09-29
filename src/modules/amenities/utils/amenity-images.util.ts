import { HttpStatus } from '@nestjs/common';

import { CustomError } from '../../shared/utils/errors.utils';
import { AmenityErrorCode } from '../../shared/constans/error-codes.constants';

/**
 * Compara la galería que llega por `updateAmenity` con la que tiene la zona y
 * devuelve las fotos que salen.
 *
 * Por aquí solo se quitan o se reordenan fotos —la primera es la portada—. Una
 * URL que la zona no tenía se rechaza: las fotos nuevas entran por
 * `POST /amenities/:id/images`, que es el único camino que las deja en R2. Sin
 * este control, cualquier enlace externo terminaría como portada en la app.
 */
export function diffAmenityImages(current: string[], next: string[]): string[] {
  const known = new Set(current);

  if (new Set(next).size !== next.length) {
    throw new CustomError({
      message: 'La galería tiene fotos repetidas',
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: AmenityErrorCode.AMENITY_IMAGE_NOT_OWNED,
    });
  }

  if (next.some((url) => !known.has(url))) {
    throw new CustomError({
      message:
        'Solo se pueden quitar o reordenar fotos de la zona; las nuevas se suben aparte',
      statusCode: HttpStatus.BAD_REQUEST,
      errorCode: AmenityErrorCode.AMENITY_IMAGE_NOT_OWNED,
    });
  }

  const kept = new Set(next);
  return current.filter((url) => !kept.has(url));
}
