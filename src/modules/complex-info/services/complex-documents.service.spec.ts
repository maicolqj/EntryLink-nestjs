import { ComplexDocumentsService } from './complex-documents.service';
import { ComplexInfoAccessService } from './complex-info-access.service';
import {
  ComplexDocumentAudience,
  ComplexDocumentCategory,
} from '../enums/complex-info.enums';
import { ResidentType } from '../../residents/enums/resident-type.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';

// sanitize-html trae htmlparser2 en ESM y Jest no lo carga; la conversión del
// Word no es lo que se prueba aquí.
jest.mock('../../shared/utils/docx-html.utils', () => ({
  docxBase64ToHtml: jest.fn().mockResolvedValue('<p>Texto</p>'),
}));

/**
 * Reglas de "Mi Conjunto":
 * - publicar exige texto o PDF, y avisa a quienes va dirigido;
 * - cambiar el contenido de algo publicado sube la versión (el acuse viejo ya
 *   no cuenta); en borrador no;
 * - el residente no ve borradores ni lo que es solo para propietarios, y para
 *   él eso "no existe";
 * - abrir un documento que pide acuse cuenta como leído;
 * - el informe de lecturas cuenta unidades, no personas.
 */

const COMPLEX_ID = 'complex-1';
const admin = { sub: 'complex-1', roles: ['COMPLEX_ROL'] } as never;
const resident = { sub: 'user-me', roles: ['RESIDENT_ROL'] } as never;

const doc = (overrides: Record<string, unknown> = {}) => ({
  id: 'doc-1',
  complexId: COMPLEX_ID,
  category: ComplexDocumentCategory.COEXISTENCE_MANUAL,
  title: 'Manual de convivencia',
  contentHtml: '<p>Normas</p>',
  fileKey: null,
  fileName: null,
  audience: ComplexDocumentAudience.ALL_RESIDENTS,
  isPublished: false,
  publishedAt: null,
  isPinned: false,
  requiresAcknowledgement: false,
  version: 1,
  createdAt: new Date('2026-09-01'),
  ...overrides,
});

const residence = (overrides: Record<string, unknown> = {}) => ({
  id: 'res-me',
  userId: 'user-me',
  unitId: 'unit-1',
  type: ResidentType.TENANT,
  isMainResident: true,
  unit: { number: '502', building: { name: 'Torre 1' } },
  user: { name: 'Ana', lastName: 'Pérez' },
  ...overrides,
});

const build = (opts: {
  found?: unknown;
  myResidences?: unknown[];
  audience?: unknown[];
  acks?: unknown[];
}) => {
  const docRepo = {
    findOne: jest.fn().mockResolvedValue(opts.found ?? null),
    save: jest.fn((d: unknown) => Promise.resolve(d)),
    create: jest.fn((d: unknown) => d),
  };
  const ackInsert = { values: jest.fn() };
  const ackQuery = {
    insert: jest.fn(() => ackQuery),
    values: jest.fn((v: unknown) => {
      ackInsert.values(v);
      return ackQuery;
    }),
    orIgnore: jest.fn(() => ackQuery),
    execute: jest.fn().mockResolvedValue(undefined),
  };
  const ackRepo = {
    find: jest.fn().mockResolvedValue(opts.acks ?? []),
    findOne: jest.fn().mockResolvedValue(null),
    createQueryBuilder: jest.fn(() => ackQuery),
  };
  const residentRepo = {
    find: jest
      .fn()
      .mockImplementation(({ where }: { where: { userId?: string } }) =>
        Promise.resolve(
          where.userId ? (opts.myResidences ?? []) : (opts.audience ?? []),
        ),
      ),
  };
  const complexService = {
    assertComplexAccess: jest.fn().mockResolvedValue(undefined),
    getSlugById: jest.fn().mockResolvedValue('conjunto'),
  };
  const notificationsService = { notify: jest.fn().mockResolvedValue([]) };
  const storage = { deleteByPublicId: jest.fn().mockResolvedValue(undefined) };

  const access = new ComplexInfoAccessService(
    residentRepo as never,
    complexService as never,
  );
  const service = new ComplexDocumentsService(
    docRepo as never,
    ackRepo as never,
    access,
    complexService as never,
    storage as never,
    notificationsService as never,
  );
  return { service, docRepo, notificationsService, residentRepo, ackInsert };
};

const flush = () => new Promise((r) => setImmediate(r));

describe('ComplexDocumentsService', () => {
  describe('publicar', () => {
    it('no deja publicar un documento sin texto ni PDF', async () => {
      const h = build({ found: doc({ contentHtml: null }) });
      await expect(
        h.service.update('doc-1', { isPublished: true }, admin),
      ).rejects.toThrow('carga el texto desde un Word o adjunta un PDF');
    });

    it('al publicar marca la fecha y avisa a los residentes', async () => {
      const h = build({
        found: doc(),
        audience: [
          residence(),
          residence({ userId: 'user-2', unitId: 'unit-2' }),
        ],
      });

      const saved = await h.service.update(
        'doc-1',
        { isPublished: true },
        admin,
      );
      await flush();

      expect(saved.publishedAt).toBeInstanceOf(Date);
      expect(h.notificationsService.notify).toHaveBeenCalledWith(
        expect.objectContaining({
          type: NotificationType.COMPLEX_DOCUMENT_PUBLISHED,
          userIds: ['user-me', 'user-2'],
          entityType: 'complex_document',
        }),
      );
    });

    it('con notifyResidents=false publica sin avisar', async () => {
      const h = build({ found: doc(), audience: [residence()] });
      await h.service.update(
        'doc-1',
        { isPublished: true, notifyResidents: false },
        admin,
      );
      await flush();
      expect(h.notificationsService.notify).not.toHaveBeenCalled();
    });

    it('solo para propietarios: el aviso filtra por tipo OWNER', async () => {
      const h = build({
        found: doc({ audience: ComplexDocumentAudience.OWNERS_ONLY }),
        audience: [residence({ type: ResidentType.OWNER })],
      });
      await h.service.update('doc-1', { isPublished: true }, admin);
      await flush();

      const calls = h.residentRepo.find.mock.calls as [
        { where: Record<string, unknown> },
      ][];
      const audienceCall = calls.find(([{ where }]) => !where.userId);
      expect(audienceCall?.[0].where).toMatchObject({
        type: ResidentType.OWNER,
      });
    });
  });

  describe('versión', () => {
    it('quitar el texto de un publicado sube la versión', async () => {
      const h = build({
        found: doc({
          isPublished: true,
          publishedAt: new Date(),
          fileKey: 'k',
          fileName: 'manual.pdf',
        }),
        audience: [],
      });
      const saved = await h.service.update(
        'doc-1',
        { removeContent: true },
        admin,
      );
      expect(saved.version).toBe(2);
    });

    it('en borrador la versión no cambia', async () => {
      const h = build({ found: doc({ fileKey: 'k', fileName: 'm.pdf' }) });
      const saved = await h.service.update(
        'doc-1',
        { removeContent: true },
        admin,
      );
      expect(saved.version).toBe(1);
    });

    it('no deja un publicado sin contenido', async () => {
      const h = build({
        found: doc({ isPublished: true, publishedAt: new Date() }),
      });
      await expect(
        h.service.update('doc-1', { removeContent: true }, admin),
      ).rejects.toThrow('carga el texto desde un Word o adjunta un PDF');
    });
  });

  describe('residente', () => {
    it('un borrador no existe para el residente', async () => {
      const h = build({ found: doc(), myResidences: [residence()] });
      await expect(h.service.getForResident('doc-1', resident)).rejects.toThrow(
        'Documento no encontrado',
      );
    });

    it('un arrendatario no ve lo que es solo para propietarios', async () => {
      const h = build({
        found: doc({
          isPublished: true,
          audience: ComplexDocumentAudience.OWNERS_ONLY,
        }),
        myResidences: [residence({ type: ResidentType.TENANT })],
      });
      await expect(h.service.getForResident('doc-1', resident)).rejects.toThrow(
        'Documento no encontrado',
      );
    });

    it('propietario en cualquiera de sus unidades sí lo ve', async () => {
      const h = build({
        found: doc({
          isPublished: true,
          audience: ComplexDocumentAudience.OWNERS_ONLY,
        }),
        myResidences: [
          residence({ type: ResidentType.TENANT }),
          residence({ type: ResidentType.OWNER, unitId: 'unit-9' }),
        ],
      });
      const result = await h.service.getForResident('doc-1', resident);
      expect(result.hasContent).toBe(true);
    });

    it('abrir un documento que pide acuse lo deja leído para esa versión y unidad', async () => {
      const h = build({
        found: doc({
          isPublished: true,
          requiresAcknowledgement: true,
          version: 2,
        }),
        myResidences: [residence()],
      });
      await h.service.getForResident('doc-1', resident);
      expect(h.ackInsert.values).toHaveBeenCalledWith({
        documentId: 'doc-1',
        version: 2,
        userId: 'user-me',
        unitId: 'unit-1',
      });
    });

    it('abrir uno que no pide acuse no registra nada', async () => {
      const h = build({
        found: doc({ isPublished: true }),
        myResidences: [residence()],
      });
      await h.service.getForResident('doc-1', resident);
      expect(h.ackInsert.values).not.toHaveBeenCalled();
    });

    it('confirmar lectura exige que el documento lo pida', async () => {
      const h = build({
        found: doc({ isPublished: true }),
        myResidences: [residence()],
      });
      await expect(h.service.acknowledge('doc-1', resident)).rejects.toThrow(
        'no pide confirmación',
      );
    });
  });

  describe('informe de lecturas', () => {
    it('cuenta unidades: basta un integrante del hogar, pendientes primero', async () => {
      const h = build({
        found: doc({ isPublished: true, version: 3 }),
        audience: [
          residence({ userId: 'u-a', unitId: 'unit-1' }),
          residence({ userId: 'u-b', unitId: 'unit-1', isMainResident: false }),
          residence({
            userId: 'u-c',
            unitId: 'unit-2',
            unit: { number: '101', building: { name: 'Torre 2' } },
          }),
        ],
        acks: [
          {
            unitId: 'unit-1',
            userId: 'u-b',
            version: 3,
            acknowledgedAt: new Date('2026-09-20'),
          },
        ],
      });

      const report = await h.service.ackReport('doc-1', admin);

      expect(report).toMatchObject({
        version: 3,
        totalUnits: 2,
        acknowledgedUnits: 1,
      });
      expect(report.units[0]).toMatchObject({
        unitLabel: 'Torre 2 - 101',
        acknowledgedAt: null,
      });
      expect(report.units[1].unitLabel).toBe('Torre 1 - 502');
    });
  });
});
