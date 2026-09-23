import { MarketplaceAudienceService } from './marketplace-audience.service';
import { MarketplaceAudienceKind } from '../enums/marketplace-audience-kind.enum';
import { MarketplaceContactPreference } from '../enums/marketplace-contact-preference.enum';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { User } from '../../users/entities/user.entity';
import { Resident } from '../../residents/entities/resident.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';

/**
 * Lo que la administración ve del público de un aviso:
 *
 *   1. Nombre y unidad de cada quien, resueltos aunque la fila no guarde la
 *      unidad (los favoritos no la guardan).
 *   2. En los interesados, la unidad desde la que preguntó manda sobre la de
 *      su ficha actual, y viaja su mensaje.
 *   3. Quien ya no existe no rompe la lista.
 */

const admin: JwtAccessPayload = {
  sub: 'admin-1',
  email: 'admin@test.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles: [ValidRoles.COMPLEX_ROL],
  permissions: [],
  complexId: 'complex-1',
};

const at = new Date('2026-09-20T15:00:00Z');

const buildHarness = () => {
  const favoriteRepo = {
    findAndCount: jest.fn(() =>
      Promise.resolve([
        [
          { userId: 'user-a', createdAt: at },
          { userId: 'user-gone', createdAt: at },
        ],
        2,
      ]),
    ),
  };
  const contactRepo = {
    findAndCount: jest.fn(() =>
      Promise.resolve([
        [
          {
            interestedUserId: 'user-a',
            interestedUnitId: 'unit-old',
            createdAt: at,
            message: '¿Todavía la tienes?',
            channel: MarketplaceContactPreference.WHATSAPP,
          },
        ],
        1,
      ]),
    ),
  };

  const repos = new Map<unknown, { find: jest.Mock }>([
    [
      User,
      {
        find: jest.fn(() =>
          Promise.resolve([{ id: 'user-a', name: 'Ana', lastName: 'Ruiz' }]),
        ),
      },
    ],
    [
      Resident,
      {
        find: jest.fn(() =>
          Promise.resolve([{ userId: 'user-a', unitId: 'unit-now' }]),
        ),
      },
    ],
    [
      Unit,
      {
        find: jest.fn(() =>
          Promise.resolve([
            { id: 'unit-now', number: '502', building: { name: 'Torre 2' } },
            { id: 'unit-old', number: '101', building: { name: 'Torre 1' } },
          ]),
        ),
      },
    ],
  ]);

  const service = new MarketplaceAudienceService(
    favoriteRepo as never,
    contactRepo as never,
    {
      findById: jest.fn(() =>
        Promise.resolve({ id: 'listing-1', complexId: 'complex-1' }),
      ),
    } as never,
    { getRepository: (entity: unknown) => repos.get(entity) } as never,
  );

  return { service, favoriteRepo };
};

describe('MarketplaceAudienceService', () => {
  it('los me gusta llegan con nombre y la unidad de su ficha', async () => {
    const { service } = buildHarness();

    const result = await service.findAudience(
      'listing-1',
      MarketplaceAudienceKind.FAVORITES,
      { page: 1, limit: 20 },
      admin,
    );

    expect(result.items[0]).toMatchObject({
      userId: 'user-a',
      name: 'Ana Ruiz',
      unitLabel: 'Torre 2 · 502',
    });
    expect(result.pagination.totalItems).toBe(2);
  });

  it('quien ya no existe no rompe la lista', async () => {
    const { service } = buildHarness();

    const result = await service.findAudience(
      'listing-1',
      MarketplaceAudienceKind.FAVORITES,
      { page: 1, limit: 20 },
      admin,
    );

    expect(result.items[1]).toMatchObject({
      userId: 'user-gone',
      name: 'Usuario eliminado',
      unitLabel: null,
    });
  });

  it('el interesado conserva la unidad desde la que preguntó y su mensaje', async () => {
    const { service } = buildHarness();

    const result = await service.findAudience(
      'listing-1',
      MarketplaceAudienceKind.INTERESTED,
      { page: 1, limit: 20 },
      admin,
    );

    expect(result.items[0]).toMatchObject({
      unitLabel: 'Torre 1 · 101',
      message: '¿Todavía la tienes?',
      channel: MarketplaceContactPreference.WHATSAPP,
    });
  });

  it('pagina en la base, no en memoria', async () => {
    const { service, favoriteRepo } = buildHarness();

    await service.findAudience(
      'listing-1',
      MarketplaceAudienceKind.FAVORITES,
      { page: 3, limit: 10 },
      admin,
    );

    expect(favoriteRepo.findAndCount).toHaveBeenCalledWith(
      expect.objectContaining({ skip: 20, take: 10 }),
    );
  });
});
