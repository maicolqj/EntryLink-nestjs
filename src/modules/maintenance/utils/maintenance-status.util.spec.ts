import {
  ALLOWED_MANUAL_TRANSITIONS,
  isMaintenanceModuleEnabled,
  isPreciseLocation,
  readOptionalBoolean,
} from './maintenance-status.util';
import { MaintenanceLocationType } from '../enums/maintenance-location-type.enum';
import { MaintenanceTicketStatus } from '../enums/maintenance-ticket-status.enum';

/**
 * Lo que no puede quedar solo en la pantalla:
 *
 *   1. Un pin impreciso no se dibuja como si fuera exacto. El GPS de un sótano
 *      entrega cien metros de error con la misma cara de seguridad que uno
 *      bueno, y ese pin manda al técnico a la torre equivocada.
 *   2. El tablero no deja saltarse el trámite. Arrastrar la tarjeta de NEW a
 *      CLOSED convertiría en decoración la evidencia de cierre.
 */
describe('isPreciseLocation', () => {
  it('el punto escaneado siempre es confiable: se midió en sitio', () => {
    expect(isPreciseLocation(MaintenanceLocationType.TAG, null, 100)).toBe(
      true,
    );
  });

  it('la zona común ya modelada también', () => {
    expect(isPreciseLocation(MaintenanceLocationType.AMENITY, null, 100)).toBe(
      true,
    );
  });

  it('torre y piso no dan coordenada: no se pinta', () => {
    expect(isPreciseLocation(MaintenanceLocationType.TREE, 5, 100)).toBe(false);
  });

  it('un GPS dentro del umbral sí se pinta', () => {
    expect(isPreciseLocation(MaintenanceLocationType.GPS, 30, 100)).toBe(true);
  });

  it('un GPS de sótano, no', () => {
    expect(isPreciseLocation(MaintenanceLocationType.GPS, 350, 100)).toBe(
      false,
    );
  });

  it('un GPS que no declara su error tampoco: los que miden bien lo informan', () => {
    expect(isPreciseLocation(MaintenanceLocationType.GPS, null, 100)).toBe(
      false,
    );
  });
});

describe('ALLOWED_MANUAL_TRANSITIONS', () => {
  it('no deja saltar de NEW a CLOSED arrastrando la tarjeta', () => {
    expect(
      ALLOWED_MANUAL_TRANSITIONS[MaintenanceTicketStatus.NEW],
    ).not.toContain(MaintenanceTicketStatus.CLOSED);
  });

  it('resolver no es un movimiento del tablero: exige evidencia', () => {
    expect(
      ALLOWED_MANUAL_TRANSITIONS[MaintenanceTicketStatus.IN_PROGRESS],
    ).not.toContain(MaintenanceTicketStatus.RESOLVED);
  });

  it('un ticket detenido puede retomarse', () => {
    expect(
      ALLOWED_MANUAL_TRANSITIONS[MaintenanceTicketStatus.ON_HOLD],
    ).toContain(MaintenanceTicketStatus.IN_PROGRESS);
  });

  it('lo cerrado no se mueve desde el tablero', () => {
    expect(ALLOWED_MANUAL_TRANSITIONS[MaintenanceTicketStatus.CLOSED]).toEqual(
      [],
    );
  });
});

describe('isMaintenanceModuleEnabled', () => {
  it('sin lista de módulos, todos están activos', () => {
    expect(isMaintenanceModuleEnabled({ enabledModules: null })).toBe(true);
    expect(isMaintenanceModuleEnabled({ enabledModules: [] })).toBe(true);
  });

  it('con lista, manda la lista', () => {
    expect(
      isMaintenanceModuleEnabled({ enabledModules: ['MANTENIMIENTO'] }),
    ).toBe(true);
    expect(isMaintenanceModuleEnabled({ enabledModules: ['MASCOTAS'] })).toBe(
      false,
    );
  });
});

describe('readOptionalBoolean', () => {
  it('"false" que llega de un multipart no es verdadero', () => {
    expect(readOptionalBoolean('false')).toBe(false);
  });

  it('omitir el campo no es lo mismo que decir que no', () => {
    expect(readOptionalBoolean(undefined)).toBeUndefined();
    expect(readOptionalBoolean('')).toBeUndefined();
  });

  it('"true" y "1" sí marcan', () => {
    expect(readOptionalBoolean('true')).toBe(true);
    expect(readOptionalBoolean('1')).toBe(true);
  });
});
