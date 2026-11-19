import type { DeviceCapabilities } from '../entities/device.iot-entity';
import type { DeviceFaceTheme } from '../entities/device-face-theme.iot-entity';

export interface FaceThemeAvailability {
  /** La app lo puede ofrecer (instalado o instalable). */
  available: boolean;
  /** Ya está en la matera, en esta versión o una más nueva. */
  installed: boolean;
  /** firmware_too_old · not_in_firmware · unknown_capabilities · lo que diga la matera */
  reason?: string;
}

/**
 * ¿Puede ESTA matera mostrar este tema? Función pura (criterio 4: la app solo
 * ofrece lo que el equipo puede mostrar). Cruza el catálogo con lo que la
 * propia matera reporta (ack "themes"):
 *  - classic: siempre;
 *  - sin informe (firmware anterior a los temas): solo classic;
 *  - VECTOR: solo si su firmware lo trae;
 *  - PACKAGE: si su firmware entiende paquetes; si no lo tiene (o tiene una
 *    versión vieja) se instala al elegirlo.
 */
export function faceThemeAvailability(
  theme: Pick<DeviceFaceTheme, 'id' | 'kind' | 'version'>,
  caps: DeviceCapabilities | null | undefined,
): FaceThemeAvailability {
  if (theme.id === 'classic') return { available: true, installed: true };
  if (!caps)
    return {
      available: false,
      installed: false,
      reason: 'unknown_capabilities',
    };
  const enMatera = caps.themes?.find((t) => t.id === theme.id);

  if (theme.kind === 'VECTOR') {
    if (!enMatera)
      return { available: false, installed: false, reason: 'not_in_firmware' };
    return enMatera.available
      ? { available: true, installed: true }
      : {
          available: false,
          installed: true,
          reason: enMatera.reason ?? 'unavailable',
        };
  }

  if (!caps.packages)
    return { available: false, installed: false, reason: 'firmware_too_old' };
  const instalado =
    !!enMatera?.available && (enMatera.version ?? 0) >= (theme.version ?? 1);
  return { available: true, installed: instalado };
}
