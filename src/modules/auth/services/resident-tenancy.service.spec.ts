import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { ResidentTenancyService } from './resident-tenancy.service';
import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';

/**
 * En qué conjunto entra quien inicia sesión como residente.
 *
 * `users.complex_id` no sirve para esto: dice a qué conjunto pertenece la
 * cuenta de trabajo, y para quien administra viene vacío aunque tenga su
 * apartamento registrado.
 */
describe('ResidentTenancyService', () => {
  let service: ResidentTenancyService;
  let lastQuery: any;

  const residentRepo = {
    findOne: jest.fn(async (opts: any) => {
      lastQuery = opts;
      return null;
    }),
  };

  beforeEach(async () => {
    lastQuery = undefined;
    jest.clearAllMocks();

    const module = await Test.createTestingModule({
      providers: [
        ResidentTenancyService,
        { provide: getRepositoryToken(Resident), useValue: residentRepo },
      ],
    }).compile();

    service = module.get(ResidentTenancyService);
  });

  it('devuelve el complejo de la ficha de residente', async () => {
    residentRepo.findOne.mockResolvedValueOnce({
      id: 'res-1',
      complexId: 'complejo-de-su-casa',
    } as any);

    await expect(service.resolveComplexId('user-1')).resolves.toBe(
      'complejo-de-su-casa',
    );
  });

  it('solo mira residencias ACTIVE y no eliminadas', async () => {
    await service.resolveComplexId('user-1');

    expect(lastQuery.where).toMatchObject({
      userId: 'user-1',
      status: ResidentStatus.ACTIVE,
    });
    // Una ficha con move-out no puede seguir abriendo sesión en ese conjunto.
    expect(lastQuery.where.deletedAt).toBeDefined();
  });

  it('con varias residencias manda la principal, y a igualdad la más reciente', async () => {
    await service.resolveComplexId('user-1');

    expect(lastQuery.order).toEqual({
      isMainResident: 'DESC',
      startDate: 'DESC',
    });
  });

  it('sin residencia activa devuelve undefined en vez de fallar', async () => {
    // Es el caso del personal sin apartamento: entra sin complejo de
    // residencia, igual que antes de este cambio.
    await expect(service.resolveComplexId('user-1')).resolves.toBeUndefined();
  });
});
