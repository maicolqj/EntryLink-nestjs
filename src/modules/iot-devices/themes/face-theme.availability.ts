import type { DeviceCapabilities } from '../entities/device.iot-entity';
import type { DeviceFaceTheme } from '../entities/device-face-theme.iot-entity';

export interface FaceThemeAvailability {
  available: boolean;
  /** needs_sd · needs_psram · not_installed · unknown_capabilities · lo que diga la matera */
  reason?: string;
}

/**
 * ¿Puede ESTA matera mostrar este tema? Función pura (criterio 4: la app solo
 * ofrece lo que el equipo puede mostrar). Se cruza el catálogo con lo que la
 * propia matera reporta (ack "themes"):
 *  - sin informe (firmware anterior a los temas): solo classic, que siempre está;
 *  - lo que pide hardware (SD, PSRAM) que la matera no tiene → no;
 *  - si la matera lista el tema, manda su `available` (p. ej. faltan imágenes);
 *  - si no lo lista, no lo tiene instalado.
 */
export function faceThemeAvailability(
  theme: Pick<DeviceFaceTheme, 'id' | 'requires'>,
  caps: DeviceCapabilities | null | undefined,
): FaceThemeAvailability {
  if (theme.id === 'classic') return { available: true };
  if (!caps) return { available: false, reason: 'unknown_capabilities' };
  if (theme.requires === 'sd' && !caps.hasSD)
    return { available: false, reason: 'needs_sd' };
  if (theme.requires === 'psram' && !caps.hasPSRAM)
    return { available: false, reason: 'needs_psram' };
  const reportado = caps.themes?.find((t) => t.id === theme.id);
  if (!reportado) return { available: false, reason: 'not_installed' };
  return reportado.available
    ? { available: true }
    : { available: false, reason: reportado.reason ?? 'unavailable' };
}
