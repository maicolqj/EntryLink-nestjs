import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';

import { MyResidencesService } from './my-residences.service';
import { Resident } from '../entities/resident.entity';
import { ResidentStatus } from '../enums/resident-status.enum';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { NotificationChannel } from '../../notifications/enums/notification-channel.enum';

jest.setTimeout(30_000);

/**
 * Lista del selector de conjunto de RemoteLink: dónde vive la persona y
 * cuántos avisos sin leer tiene en cada conjunto.
 */
describe('MyResidencesService', () => {
  let service: MyResidencesService;
  let lastFind: any;

  const residence = (complexId: string, complexName: string, unit = '101') => ({
    id: `res-${complexId}`,
    complexId,
    complex: { id: complexId, name: complexName },
    unit: { number: unit, building: { name: 'Torre 1' } },
  });

  const residentRepo = {
    find: jest.fn(async (opts: any): Promise<any[]> => {
      lastFind = opts;
      return [];
    }),
  };
  const unreadByComplex: Record<string, number> = {};
  const notifications = {
    getUnreadCount: jest.fn(async (complexId: string) => ({
      count: unreadByComplex[complexId] ?? 0,
    })),
  };

  const currentUser: any = { sub: 'user-1', complexId: 'complex-b' };

  beforeEach(async () => {
    jest.clearAllMocks();
    lastFind = undefined;
    const module = await Test.createTestingModule({
      providers: [
        MyResidencesService,
        { provide: getRepositoryToken(Resident), useValue: residentRepo },
        { provide: NotificationsService, useValue: notifications },
      ],
    }).compile();
    service = module.get(MyResidencesService);
  });

  it('solo pide residencias ACTIVE y no borradas del usuario autenticado', async () => {
    await service.findMine(currentUser);

    expect(lastFind.where).toMatchObject({
      userId: 'user-1',
      status: ResidentStatus.ACTIVE,
    });
    expect(lastFind.where.deletedAt).toBeDefined();
  });

  it('marca el conjunto de la sesión como actual y lo pone primero; el resto por nombre', async () => {
    residentRepo.find.mockResolvedValueOnce([
      residence('complex-c', 'Zafiro'),
      residence('complex-a', 'Alameda'),
      residence('complex-b', 'Mirador'),
    ]);

    const list = await service.findMine(currentUser);

    expect(list.map((r) => [r.complexId, r.isCurrent])).toEqual([
      ['complex-b', true],
      ['complex-a', false],
      ['complex-c', false],
    ]);
    expect(list[0]).toMatchObject({
      complexName: 'Mirador',
      buildingName: 'Torre 1',
      unitNumber: '101',
    });
  });

  it('cuenta los avisos sin leer de cada conjunto con su complexId y canal APP', async () => {
    unreadByComplex['complex-a'] = 3;
    unreadByComplex['complex-b'] = 0;
    residentRepo.find.mockResolvedValueOnce([
      residence('complex-a', 'Alameda'),
      residence('complex-b', 'Mirador'),
    ]);

    const list = await service.findMine(currentUser);

    expect(notifications.getUnreadCount).toHaveBeenCalledWith(
      'complex-a',
      currentUser,
      NotificationChannel.APP,
    );
    expect(list.find((r) => r.complexId === 'complex-a')?.unreadCount).toBe(3);
    expect(list.find((r) => r.complexId === 'complex-b')?.unreadCount).toBe(0);
  });

  it('dos fichas en el mismo conjunto salen una sola vez', async () => {
    residentRepo.find.mockResolvedValueOnce([
      residence('complex-a', 'Alameda', '101'),
      residence('complex-a', 'Alameda', '202'),
    ]);

    const list = await service.findMine(currentUser);

    expect(list).toHaveLength(1);
    expect(notifications.getUnreadCount).toHaveBeenCalledTimes(1);
  });
});
