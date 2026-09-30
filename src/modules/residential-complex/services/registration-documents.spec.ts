import { NotFoundException } from '@nestjs/common';
import { ResidentialComplexService } from './residential-complex.service';

/**
 * El RUT y el documento del representante legal se guardaron como URL pública
 * de R2. La web ya no la recibe: el backend saca la llave de esa URL y sirve el
 * archivo. Si R2_PUBLIC_URL cambió desde el registro, la llave igual debe salir.
 */
const PUBLIC = 'https://files.alternaqj.com';

const build = (complex: Record<string, unknown> | null) => {
  const service = Object.create(
    ResidentialComplexService.prototype,
  ) as ResidentialComplexService;
  Object.assign(service, {
    complexRepo: { findOne: jest.fn(async () => complex) },
    storageService: {
      keyFromPublicUrl: (url: string) =>
        url.startsWith(`${PUBLIC}/`) ? url.slice(PUBLIC.length + 1) : null,
    },
  });
  return service;
};

describe('ResidentialComplexService — documentos del registro', () => {
  it('saca la llave de la URL pública actual', async () => {
    const service = build({
      id: 'c1',
      slug: 'torres-del-parque',
      rutFileUrl: `${PUBLIC}/entrylink/torres-del-parque/documents/a.pdf`,
    });

    await expect(
      service.resolveRegistrationDocument('c1', 'rut'),
    ).resolves.toEqual({
      key: 'entrylink/torres-del-parque/documents/a.pdf',
      fileName: 'rut-torres-del-parque.pdf',
    });
  });

  it('usa la ruta cuando la URL es de otro dominio público', async () => {
    const service = build({
      id: 'c1',
      slug: 'torres',
      legalRepDocumentUrl:
        'https://pub-123.r2.dev/entrylink/torres/documents/b.pdf',
    });

    const { key } = await service.resolveRegistrationDocument(
      'c1',
      'legal-rep',
    );
    expect(key).toBe('entrylink/torres/documents/b.pdf');
  });

  it('usa la ruta cuando R2_PUBLIC_URL estaba vacía', async () => {
    const service = build({
      id: 'c1',
      slug: 'torres',
      rutFileUrl: '/entrylink/torres/documents/c.pdf',
    });

    const { key } = await service.resolveRegistrationDocument('c1', 'rut');
    expect(key).toBe('entrylink/torres/documents/c.pdf');
  });

  it('404 si el complejo no tiene el documento', async () => {
    const service = build({ id: 'c1', slug: 'torres', rutFileUrl: null });

    await expect(
      service.resolveRegistrationDocument('c1', 'rut'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });

  it('404 si el complejo no existe', async () => {
    const service = build(null);

    await expect(
      service.resolveRegistrationDocument('c1', 'legal-rep'),
    ).rejects.toBeInstanceOf(NotFoundException);
  });
});
