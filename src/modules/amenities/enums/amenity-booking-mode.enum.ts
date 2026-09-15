import { registerEnumType } from '@nestjs/graphql';

/**
 * Cómo se parte el horario disponible de la zona.
 *
 * SLOT  → franjas fijas de `slotDurationMinutes` (ej. BBQ cada 2 h). El residente
 *         elige una franja completa; el backend rechaza cualquier otro inicio.
 * RANGE → el residente elige inicio y fin libres dentro del horario abierto,
 *         acotado por `minDurationMinutes` / `maxDurationMinutes` (ej. salón comunal).
 */
export enum AmenityBookingMode {
  SLOT = 'SLOT',
  RANGE = 'RANGE',
}

registerEnumType(AmenityBookingMode, {
  name: 'AmenityBookingMode',
  description: 'Modo en que se reservan las franjas horarias de la zona común',
});
