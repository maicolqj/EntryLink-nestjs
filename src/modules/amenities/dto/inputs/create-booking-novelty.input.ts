import {
  IsBoolean,
  IsOptional,
  IsString,
  MaxLength,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { readOptionalBoolean } from '../../../pets/utils/pets-module.util';

/**
 * Body de POST /api/v1/amenities/bookings/:bookingId/novelties (multipart).
 *
 * En multipart todo llega como texto: `"false"` es una cadena verdadera. El
 * booleano se convierte aquí y el controlador lo vuelve a leer con el mismo
 * helper, como en mascotas, para que un daño no quede marcado sin serlo.
 */
export class CreateBookingNoveltyDto {
  @IsString()
  @MinLength(5)
  @MaxLength(2000)
  description: string;

  @IsOptional()
  @Transform(({ obj, key }: { obj: Record<string, unknown>; key: string }) =>
    readOptionalBoolean(obj?.[key]),
  )
  @IsBoolean()
  hasDamage?: boolean;
}
