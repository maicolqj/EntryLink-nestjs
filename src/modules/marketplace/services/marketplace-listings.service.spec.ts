import { MarketplaceListingsService } from './marketplace-listings.service';
import { MarketplaceListing } from '../entities/marketplace-listing.entity';
import { MarketplaceSettings } from '../entities/marketplace-settings.entity';
import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { MarketplaceListingType } from '../enums/marketplace-listing-type.enum';
import { MarketplacePriceType } from '../enums/marketplace-price-type.enum';
import { MarketplaceModerationMode } from '../enums/marketplace-moderation-mode.enum';
import { MarketplaceContactPreference } from '../enums/marketplace-contact-preference.enum';

import { CustomError } from '../../shared/utils/errors.utils';
import { MarketplaceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Las reglas de la vitrina que no pueden quedarse en la pantalla:
 *
 *   1. El teléfono no sale por publicar. Depende del consentimiento de su dueño
 *      Y de que el conjunto permita el canal, y las dos se evalúan al LEER: el
 *      día que la administración apaga el canal, los avisos que ya lo mostraban
 *      dejan de hacerlo sin tocar ninguna publicación.
 *   2. Con moderación previa, editar un aviso publicado lo devuelve a la cola.
 *      Si no, editar sería la puerta para publicar una cosa y dejar otra.
 *   3. Un booleano que llega como texto no destapa el teléfono: el alta entra
 *      por multipart y `"false"` es una cadena no vacía —verdadera para
 *      JavaScript—.
 */

const userOf = (roles: ValidRoles[], sub = 'user-1'): JwtAccessPayload => ({
  sub,
  email: 'quien@test.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles,
  permissions: [],
  complexId: 'complex-1',
});

const settingsOf = (
  partial: Partial<MarketplaceSettings> = {},
): MarketplaceSettings =>
  ({
    complexId: 'complex-1',
    moderationMode: MarketplaceModerationMode.PREVIA,
    listingDurationDays: 30,
    maxActiveListingsPerUnit: 5,
    maxImagesPerListing: 5,
    autoPauseAfterReports: 3,
    allowPhoneContact: true,
    allowWantedListings: true,
    ...partial,
  }) as MarketplaceSettings;

const listingOf = (
  partial: Partial<MarketplaceListing> = {},
): MarketplaceListing =>
  ({
    id: 'listing-1',
    type: MarketplaceListingType.PRODUCT,
    title: 'Nevera Haceb',
    description: 'Poco uso, funcionando',
    categoryId: 'cat-1',
    imageUrls: ['https://files.alternaqj.com/nevera.jpg'],
    priceAmount: 800000,
    priceType: MarketplacePriceType.FIXED,
    currency: 'COP',
    contactPreference: MarketplaceContactPreference.WHATSAPP,
    showPhone: true,
    status: MarketplaceListingStatus.PUBLISHED,
    viewsCount: 0,
    contactsCount: 0,
    favoritesCount: 0,
    pendingReportsCount: 0,
    ownerUserId: 'user-1',
    unitId: 'unit-1',
    complexId: 'complex-1',
    owner: {
      name: 'Ana',
      lastName: 'Ruiz',
      phoneNumber: '3001234567',
      // `countryCode` es jsonb con la forma de `Country`, no una cadena: con
      // '+57' pelado el teléfono salía sin indicativo.
      countryCode: {
        code: 'CO',
        name: 'Colombia',
        dialCode: '+57',
        flag: '🇨🇴',
      },
    },
    unit: { number: '502', building: { name: 'Torre 2' } },
    ...partial,
  }) as MarketplaceListing;

const buildHarness = (
  listing: MarketplaceListing = listingOf(),
  settings: MarketplaceSettings = settingsOf(),
) => {
  const saved: MarketplaceListing[] = [];

  const listingRepo = {
    findOne: jest.fn(() => Promise.resolve(listing)),
    find: jest.fn(() => Promise.resolve([])),
    count: jest.fn(() => Promise.resolve(0)),
    create: jest.fn((data: Partial<MarketplaceListing>) => data),
    save: jest.fn((entity: MarketplaceListing) => {
      saved.push(entity);
      return Promise.resolve({ id: 'listing-1', ...entity });
    }),
    increment: jest.fn(() => Promise.resolve(undefined)),
    decrement: jest.fn(() => Promise.resolve(undefined)),
    createQueryBuilder: jest.fn(() => ({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn(() => Promise.resolve(0)),
    })),
  };

  const contactRepo = {
    findOne: jest.fn(() => Promise.resolve(null)),
    count: jest.fn(() => Promise.resolve(0)),
    createQueryBuilder: jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn(() => Promise.resolve({ identifiers: [] })),
    })),
  };

  const favoriteRepo = {
    findOne: jest.fn(() => Promise.resolve(null)),
    count: jest.fn(() => Promise.resolve(0)),
    delete: jest.fn(() => Promise.resolve(undefined)),
    createQueryBuilder: jest.fn(() => ({
      insert: jest.fn().mockReturnThis(),
      into: jest.fn().mockReturnThis(),
      values: jest.fn().mockReturnThis(),
      orIgnore: jest.fn().mockReturnThis(),
      execute: jest.fn(() => Promise.resolve({ identifiers: [] })),
    })),
  };

  const notify = jest.fn(() => Promise.resolve([]));

  const service = new MarketplaceListingsService(
    listingRepo as never,
    contactRepo as never,
    favoriteRepo as never,
    { getOrCreate: jest.fn(() => Promise.resolve(settings)) } as never,
    {
      ensureDefaults: jest.fn(() => Promise.resolve(undefined)),
      findPublishable: jest.fn(() => Promise.resolve({ id: 'cat-1' })),
    } as never,
    {
      findById: jest.fn(() =>
        Promise.resolve({
          id: 'complex-1',
          slug: 'complejo',
          enabledModules: ['CLASIFICADOS'],
        }),
      ),
      assertComplexAccess: jest.fn(() => Promise.resolve(undefined)),
    } as never,
    { findById: jest.fn() } as never,
    {
      findMyProfile: jest.fn(() =>
        Promise.resolve({
          id: 'resident-1',
          unitId: 'unit-1',
          user: { name: 'Ana', lastName: 'Ruiz' },
          unit: { number: '502' },
        }),
      ),
    } as never,
    {
      notify,
      findUserIdsByRoles: jest.fn(() => Promise.resolve(['admin-1'])),
    } as never,
    { log: jest.fn() } as never,
    { emitToComplex: jest.fn() } as never,
  );

  return { service, listingRepo, contactRepo, favoriteRepo, saved, notify };
};

describe('MarketplaceListingsService — el teléfono no sale por publicar', () => {
  it('lo muestra cuando su dueño lo destapó y el conjunto lo permite', async () => {
    const { service } = buildHarness();

    const contact = await service.resolveContact(
      listingOf(),
      userOf([ValidRoles.RESIDENT_ROL], 'otro-user'),
    );

    expect(contact.phone).toBe('+573001234567');
    expect(contact.inAppOnly).toBe(false);
  });

  it('lo oculta si la administración apagó el canal, aunque el aviso lo tenga destapado', async () => {
    const { service } = buildHarness(
      listingOf(),
      settingsOf({ allowPhoneContact: false }),
    );

    const contact = await service.resolveContact(
      listingOf(),
      userOf([ValidRoles.RESIDENT_ROL], 'otro-user'),
    );

    expect(contact.phone).toBeNull();
    expect(contact.inAppOnly).toBe(true);
    expect(contact.preference).toBe(MarketplaceContactPreference.IN_APP);
  });

  it('lo oculta si su dueño no lo destapó', async () => {
    const listing = listingOf({ showPhone: false });
    const { service } = buildHarness(listing);

    const contact = await service.resolveContact(
      listing,
      userOf([ValidRoles.RESIDENT_ROL], 'otro-user'),
    );

    expect(contact.phone).toBeNull();
  });

  it('a su propio autor sí se lo muestra: es su número', async () => {
    const listing = listingOf({ showPhone: false });
    const { service } = buildHarness(listing);

    const contact = await service.resolveContact(
      listing,
      userOf([ValidRoles.RESIDENT_ROL], 'user-1'),
    );

    expect(contact.phone).toBe('+573001234567');
  });
});

describe('MarketplaceListingsService — alta', () => {
  const baseInput = {
    complexId: 'complex-1',
    type: MarketplaceListingType.PRODUCT,
    categoryId: 'cat-1',
    title: 'Nevera Haceb',
    description: 'Poco uso, funcionando bien',
    priceAmount: 800000,
    priceType: MarketplacePriceType.FIXED,
    imageUrls: ['https://files.alternaqj.com/nevera.jpg'],
    acceptTerms: true,
  };

  it('con moderación previa nace esperando aprobación y avisa a la administración', async () => {
    const { service, saved, notify } = buildHarness();

    await service.create(baseInput, userOf([ValidRoles.RESIDENT_ROL]));

    expect(saved[0].status).toBe(MarketplaceListingStatus.PENDING_REVIEW);
    expect(saved[0].publishedAt).toBeNull();
    expect(notify).toHaveBeenCalled();
  });

  it('con moderación automática sale publicada y con vigencia', async () => {
    const { service, saved } = buildHarness(
      listingOf(),
      settingsOf({ moderationMode: MarketplaceModerationMode.AUTO }),
    );

    await service.create(baseInput, userOf([ValidRoles.RESIDENT_ROL]));

    expect(saved[0].status).toBe(MarketplaceListingStatus.PUBLISHED);
    expect(saved[0].expiresAt).toBeInstanceOf(Date);
  });

  it('"false" en multipart NO destapa el teléfono', async () => {
    const { service, saved } = buildHarness();

    await service.create(
      {
        ...baseInput,
        // Lo que llega de un multipart que no pasó por el DTO.
        showPhone: 'false' as unknown as boolean,
      },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(saved[0].showPhone).toBe(false);
  });

  it('sin fotos no se publica', async () => {
    const { service } = buildHarness();

    await expect(
      service.create(
        { ...baseInput, imageUrls: [] },
        userOf([ValidRoles.RESIDENT_ROL]),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_IMAGES_REQUIRED,
    });
  });

  it('un aviso de "busco" sí puede ir sin fotos', async () => {
    const { service, saved } = buildHarness();

    await service.create(
      {
        ...baseInput,
        type: MarketplaceListingType.WANTED,
        imageUrls: [],
      },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(saved[0].type).toBe(MarketplaceListingType.WANTED);
  });

  it('si el conjunto apagó los avisos de "busco", no deja publicarlos', async () => {
    const { service } = buildHarness(
      listingOf(),
      settingsOf({ allowWantedListings: false }),
    );

    await expect(
      service.create(
        { ...baseInput, type: MarketplaceListingType.WANTED, imageUrls: [] },
        userOf([ValidRoles.RESIDENT_ROL]),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_WANTED_DISABLED,
    });
  });

  it('un precio fijo sin monto no pasa', async () => {
    const { service } = buildHarness();

    await expect(
      service.create(
        { ...baseInput, priceAmount: undefined },
        userOf([ValidRoles.RESIDENT_ROL]),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_PRICE_REQUIRED,
    });
  });

  it('sin aceptar las condiciones —y sin haberlas aceptado antes— no se publica', async () => {
    const { service, listingRepo } = buildHarness();
    listingRepo.findOne.mockResolvedValueOnce(null);

    await expect(
      service.create(
        { ...baseInput, acceptTerms: false },
        userOf([ValidRoles.RESIDENT_ROL]),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_TERMS_NOT_ACCEPTED,
    });
  });

  it('respeta el tope de publicaciones por unidad', async () => {
    const { service, listingRepo } = buildHarness(
      listingOf(),
      settingsOf({ maxActiveListingsPerUnit: 2 }),
    );

    listingRepo.createQueryBuilder.mockReturnValueOnce({
      where: jest.fn().mockReturnThis(),
      andWhere: jest.fn().mockReturnThis(),
      getCount: jest.fn(() => Promise.resolve(2)),
    });

    await expect(
      service.create(baseInput, userOf([ValidRoles.RESIDENT_ROL])),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_MAX_PER_UNIT_REACHED,
    });
  });
});

describe('MarketplaceListingsService — edición y moderación', () => {
  it('con moderación previa, editar lo publicado lo devuelve a la cola', async () => {
    const { service, saved, notify } = buildHarness();

    await service.update(
      { listingId: 'listing-1', title: 'Nevera Haceb 320L' },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(saved[0].status).toBe(MarketplaceListingStatus.PENDING_REVIEW);
    expect(notify).toHaveBeenCalled();
  });

  it('con moderación automática, editar no lo baja de la vitrina', async () => {
    const { service, saved } = buildHarness(
      listingOf(),
      settingsOf({ moderationMode: MarketplaceModerationMode.AUTO }),
    );

    await service.update(
      { listingId: 'listing-1', title: 'Nevera Haceb 320L' },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(saved[0].status).toBe(MarketplaceListingStatus.PUBLISHED);
  });

  it('no deja meter una foto que no pasó por R2', async () => {
    const { service } = buildHarness();

    await expect(
      service.update(
        {
          listingId: 'listing-1',
          imageUrls: ['https://sitio-ajeno.com/lo-que-sea.jpg'],
        },
        userOf([ValidRoles.RESIDENT_ROL]),
      ),
    ).rejects.toBeInstanceOf(CustomError);
  });

  it('el aviso ajeno no se edita', async () => {
    const { service } = buildHarness();

    await expect(
      service.update(
        { listingId: 'listing-1', title: 'Mío ahora' },
        userOf([ValidRoles.RESIDENT_ROL], 'vecino-2'),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_ACCESS_DENIED,
    });
  });

  it('rechazar sin motivo no procede: su autor no sabría qué corregir', async () => {
    const listing = listingOf({
      status: MarketplaceListingStatus.PENDING_REVIEW,
    });
    const { service } = buildHarness(listing);

    await expect(
      service.reject(
        { listingId: 'listing-1' },
        userOf([ValidRoles.COMPLEX_ROL]),
      ),
    ).rejects.toBeInstanceOf(CustomError);
  });

  it('aprobar deja la publicación visible y con vigencia', async () => {
    const listing = listingOf({
      status: MarketplaceListingStatus.PENDING_REVIEW,
      publishedAt: null,
    });
    const { service, saved } = buildHarness(listing);

    await service.approve(
      { listingId: 'listing-1' },
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(saved[0].status).toBe(MarketplaceListingStatus.PUBLISHED);
    expect(saved[0].publishedAt).toBeInstanceOf(Date);
    expect(saved[0].expiresAt).toBeInstanceOf(Date);
  });

  it('solo se aprueba lo que está pendiente', async () => {
    const { service } = buildHarness();

    await expect(
      service.approve(
        { listingId: 'listing-1' },
        userOf([ValidRoles.COMPLEX_ROL]),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
    });
  });

  it('con reportes sin resolver, su autor no puede devolverla a la vitrina', async () => {
    const listing = listingOf({
      status: MarketplaceListingStatus.PAUSED,
      pendingReportsCount: 2,
    });
    const { service } = buildHarness(listing);

    await expect(
      service.resume('listing-1', userOf([ValidRoles.RESIDENT_ROL])),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_INVALID_STATUS,
    });
  });
});

describe('MarketplaceListingsService — acceso a la ficha', () => {
  it('el borrador del vecino no se abre', async () => {
    const listing = listingOf({ status: MarketplaceListingStatus.DRAFT });
    const { service } = buildHarness(listing);

    await expect(
      service.findById(
        'listing-1',
        userOf([ValidRoles.RESIDENT_ROL], 'vecino-2'),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_ACCESS_DENIED,
    });
  });

  it('quien modera sí lo abre', async () => {
    const listing = listingOf({ status: MarketplaceListingStatus.DRAFT });
    const { service } = buildHarness(listing);

    await expect(
      service.findById(
        'listing-1',
        userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
      ),
    ).resolves.toMatchObject({ id: 'listing-1' });
  });

  it('la visita de quien modera no infla el contador del vecino', async () => {
    const { service, listingRepo } = buildHarness();

    await service.findByIdAndCountView(
      'listing-1',
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(listingRepo.increment).not.toHaveBeenCalled();
  });

  it('la de otro residente sí', async () => {
    const { service, listingRepo } = buildHarness();

    await service.findByIdAndCountView(
      'listing-1',
      userOf([ValidRoles.RESIDENT_ROL], 'vecino-2'),
    );

    expect(listingRepo.increment).toHaveBeenCalledWith(
      { id: 'listing-1' },
      'viewsCount',
      1,
    );
  });
});

describe('MarketplaceListingsService — interés', () => {
  it('no deja registrar interés en la propia publicación', async () => {
    const { service } = buildHarness();

    await expect(
      service.registerInterest(
        { listingId: 'listing-1' },
        userOf([ValidRoles.RESIDENT_ROL], 'user-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_CONTACT_SELF,
    });
  });

  it('no deja preguntar por algo que ya no está publicado', async () => {
    const listing = listingOf({ status: MarketplaceListingStatus.SOLD });
    const { service } = buildHarness(listing);

    await expect(
      service.registerInterest(
        { listingId: 'listing-1' },
        userOf([ValidRoles.RESIDENT_ROL], 'vecino-2'),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_CONTACT_NOT_AVAILABLE,
    });
  });

  it('el segundo "me interesa" del mismo vecino no vuelve a subir el contador', async () => {
    const { service, contactRepo, listingRepo, notify } = buildHarness();
    contactRepo.findOne.mockResolvedValueOnce({ id: 'contact-1' });

    await service.registerInterest(
      { listingId: 'listing-1' },
      userOf([ValidRoles.RESIDENT_ROL], 'vecino-2'),
    );

    expect(listingRepo.increment).not.toHaveBeenCalled();
    // Pero el aviso sí se reenvía: el publicador puede no haberlo visto.
    expect(notify).toHaveBeenCalled();
  });
});
