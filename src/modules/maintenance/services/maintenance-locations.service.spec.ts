import { MaintenanceLocationsService } from './maintenance-locations.service';
import { ResidentialComplex } from '../../residential-complex/entities/residential-complex.entity';

/**
 * Las apps muestran "Escanear el código" y "Leer chip NFC" según lo que el
 * conjunto tenga pegado en las paredes. Lo decide la administración.
 */

const admin = { sub: 'admin-1', roles: ['COMPLEX_ROL'] } as never;

const build = (complex: Partial<ResidentialComplex>) => {
  const update = jest.fn(async () => undefined);
  const service = new MaintenanceLocationsService(
    { find: jest.fn(async () => []), manager: { update } } as never,
    {
      findById: jest.fn(async () => ({
        id: 'complex-1',
        enabledModules: [],
        maintenanceResidentReportingEnabled: true,
        maintenanceGpsAccuracyMeters: 100,
        ...complex,
      })),
    } as never,
    { findByComplex: jest.fn(async () => ({ items: [] })) } as never,
    { findByComplex: jest.fn(async () => ({ items: [] })) } as never,
  );
  return { service, update };
};

describe('MaintenanceLocationsService — cómo se identifica el sitio', () => {
  it('las opciones del formulario dicen qué medios usa el conjunto', async () => {
    const h = build({ maintenanceQrEnabled: false, maintenanceNfcEnabled: true });

    const options = await h.service.findReportOptions('complex-1', admin);

    expect(options).toMatchObject({ qrEnabled: false, nfcEnabled: true });
  });

  it('un conjunto sin configurar ofrece QR y no NFC', async () => {
    const h = build({});

    const options = await h.service.findReportOptions('complex-1', admin);

    expect(options).toMatchObject({ qrEnabled: true, nfcEnabled: false });
  });

  it('la administración cambia los medios del conjunto', async () => {
    const h = build({});

    const result = await h.service.setScanMethods('complex-1', false, true, admin);

    expect(result).toEqual({ qrEnabled: false, nfcEnabled: true });
    expect(h.update).toHaveBeenCalledWith(ResidentialComplex, 'complex-1', {
      maintenanceQrEnabled: false,
      maintenanceNfcEnabled: true,
    });
  });
});
