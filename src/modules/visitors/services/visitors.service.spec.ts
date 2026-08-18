import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { VisitorsService } from './visitors.service';
import { Visitor } from '../entities/visitor.entity';
import { NotificationsService } from '../../notifications/services/notifications.service';

/**
 * Los datos que portería lee del documento se guardan en el visitante, no en la
 * visita: describen a la persona y deben sobrevivir entre entradas. Lo que se
 * garantiza aquí es que acumular esos datos no destruya los ya guardados —cada
 * escaneo lee lo que alcanza a leer— y que visitar dos veces no genere una
 * escritura por visita.
 */
describe('VisitorsService.findOrCreate — metadata del documento', () => {
  let service: VisitorsService;
  let rows: any[];

  const DOC = {
    birthDate: '2007-09-01',
    birthPlace: 'BOGOTA D.C. (CUNDINAMARCA)',
    nationality: 'COL',
    height: '1.68',
  };

  const visitorRepo = {
    create: jest.fn((data: any) => ({ ...data })),
    save: jest.fn(async (data: any) => {
      const existing = rows.find(r => r.id === data.id);
      if (existing) { Object.assign(existing, data); return existing; }
      const row = { id: `vis-${rows.length + 1}`, ...data };
      rows.push(row);
      return row;
    }),
    findOne: jest.fn(async ({ where }: any) =>
      rows.find(r =>
        r.complexId === where.complexId &&
        r.identity === where.identity &&
        r.identityType === where.identityType,
      ) ?? null,
    ),
  };

  const base = {
    name: 'LAURA VALENTINA',
    lastName: 'CARDONA SANCHEZ',
    identity: '1012356111',
  };

  const findOrCreate = (metadata?: Record<string, any>) =>
    service.findOrCreate('complex-1', { ...base, metadata });

  beforeEach(async () => {
    rows = [];
    jest.clearAllMocks();

    const moduleRef = await Test.createTestingModule({
      providers: [
        VisitorsService,
        { provide: getRepositoryToken(Visitor), useValue: visitorRepo },
        { provide: NotificationsService, useValue: { create: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(VisitorsService);
  });

  it('guarda los datos del documento al crear el visitante', async () => {
    const visitor = await findOrCreate(DOC);
    expect(visitor.metadata).toEqual(DOC);
  });

  it('conserva los campos previos cuando el siguiente escaneo lee menos', async () => {
    await findOrCreate(DOC);
    const visitor = await findOrCreate({ nationality: 'COL' });

    expect(visitor.metadata).toEqual(DOC);
  });

  it('incorpora los campos nuevos que trae un escaneo posterior', async () => {
    await findOrCreate({ nationality: 'COL' });
    const visitor = await findOrCreate({ birthPlace: 'BOGOTA D.C. (CUNDINAMARCA)' });

    expect(visitor.metadata).toEqual({
      nationality: 'COL',
      birthPlace: 'BOGOTA D.C. (CUNDINAMARCA)',
    });
  });

  it('deja que un dato corregido pise al anterior', async () => {
    await findOrCreate({ height: '1.60' });
    const visitor = await findOrCreate({ height: '1.68' });

    expect(visitor.metadata!.height).toBe('1.68');
  });

  it('no escribe en la BD si la visita no aporta nada nuevo', async () => {
    await findOrCreate(DOC);
    visitorRepo.save.mockClear();

    await findOrCreate(DOC);
    expect(visitorRepo.save).not.toHaveBeenCalled();
  });

  it('no toca el metadata guardado cuando la visita llega sin documento', async () => {
    await findOrCreate(DOC);
    const visitor = await findOrCreate(undefined);

    expect(visitor.metadata).toEqual(DOC);
  });

  it('reutiliza el visitante en vez de duplicarlo', async () => {
    const first = await findOrCreate(DOC);
    const second = await findOrCreate(DOC);

    expect(second.id).toBe(first.id);
    expect(rows).toHaveLength(1);
  });
});
