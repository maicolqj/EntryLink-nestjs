import { MarketplaceReportsService } from './marketplace-reports.service';
import { MarketplaceListing } from '../entities/marketplace-listing.entity';
import { MarketplaceListingReport } from '../entities/marketplace-listing-report.entity';
import { MarketplaceListingStatus } from '../enums/marketplace-listing-status.enum';
import { MarketplaceReportReason } from '../enums/marketplace-report-reason.enum';
import { MarketplaceReportStatus } from '../enums/marketplace-report-status.enum';

import { MarketplaceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Lo que sostiene la moderación de la vitrina:
 *
 *   1. La pausa automática por reportes es una medida temporal, no un
 *      veredicto. Entre dejar a la vista un presunto fraude y ocultar algo que
 *      quizá era legítimo, lo segundo se deshace con un clic.
 *   2. Un mismo vecino no puede reportar dos veces el mismo aviso. Con el tope
 *      por número de reportes, sin esa regla bastaría un usuario obstinado para
 *      tumbar cualquier publicación.
 *   3. Desestimar el reporte devuelve el aviso a la vitrina; aceptarlo lo
 *      retira con un motivo que su autor sí recibe —sin decirle nunca quién lo
 *      reportó—.
 */

const userOf = (roles: ValidRoles[], sub = 'vecino-2'): JwtAccessPayload => ({
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

const listingOf = (
  partial: Partial<MarketplaceListing> = {},
): MarketplaceListing =>
  ({
    id: 'listing-1',
    title: 'Préstamos rápidos',
    status: MarketplaceListingStatus.PUBLISHED,
    pendingReportsCount: 0,
    ownerUserId: 'user-1',
    complexId: 'complex-1',
    ...partial,
  }) as MarketplaceListing;

const buildHarness = (
  options: {
    listing?: MarketplaceListing;
    existingReport?: MarketplaceListingReport | null;
    autoPauseAfterReports?: number;
    pendingAfterReport?: number;
  } = {},
) => {
  const {
    listing = listingOf(),
    existingReport = null,
    autoPauseAfterReports = 3,
    pendingAfterReport = 1,
  } = options;

  const savedReports: MarketplaceListingReport[] = [];

  const reportRepo = {
    findOne: jest.fn(() => Promise.resolve(existingReport)),
    create: jest.fn((data: Partial<MarketplaceListingReport>) => data),
    save: jest.fn((entity: MarketplaceListingReport) => {
      savedReports.push(entity);
      return Promise.resolve({ id: 'report-1', ...entity });
    }),
    find: jest.fn(() => Promise.resolve([])),
  };

  const listingsService = {
    findById: jest.fn(() => Promise.resolve(listing)),
    adjustPendingReports: jest.fn(() =>
      Promise.resolve(
        listingOf({ ...listing, pendingReportsCount: pendingAfterReport }),
      ),
    ),
    pauseByReports: jest.fn(() => Promise.resolve(undefined)),
    removeByReport: jest.fn(() => Promise.resolve(undefined)),
    restoreAfterDismissedReport: jest.fn(() => Promise.resolve(undefined)),
  };

  const service = new MarketplaceReportsService(
    reportRepo as never,
    listingsService as never,
    {
      getOrCreate: jest.fn(() =>
        Promise.resolve({ complexId: 'complex-1', autoPauseAfterReports }),
      ),
    } as never,
    { assertComplexAccess: jest.fn(() => Promise.resolve(undefined)) } as never,
    {
      findMyProfile: jest.fn(() => Promise.resolve({ unitId: 'unit-9' })),
    } as never,
    {
      notify: jest.fn(() => Promise.resolve([])),
      findUserIdsByRoles: jest.fn(() => Promise.resolve(['admin-1'])),
    } as never,
    { log: jest.fn() } as never,
  );

  return { service, reportRepo, listingsService, savedReports };
};

describe('MarketplaceReportsService — reportar', () => {
  it('guarda quién reportó y desde qué unidad', async () => {
    const { service, savedReports } = buildHarness();

    await service.report(
      {
        listingId: 'listing-1',
        reason: MarketplaceReportReason.PROHIBITED_ITEM,
        comment: 'Es un gota a gota',
      },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(savedReports[0]).toMatchObject({
      reporterUserId: 'vecino-2',
      reporterUnitId: 'unit-9',
      status: MarketplaceReportStatus.PENDING,
    });
  });

  it('no deja reportar la propia publicación', async () => {
    const { service } = buildHarness();

    await expect(
      service.report(
        {
          listingId: 'listing-1',
          reason: MarketplaceReportReason.OTHER,
        },
        userOf([ValidRoles.RESIDENT_ROL], 'user-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_REPORT_SELF,
    });
  });

  it('no deja reportar dos veces el mismo aviso', async () => {
    const { service } = buildHarness({
      existingReport: { id: 'report-0' } as MarketplaceListingReport,
    });

    await expect(
      service.report(
        {
          listingId: 'listing-1',
          reason: MarketplaceReportReason.SCAM,
        },
        userOf([ValidRoles.RESIDENT_ROL]),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_ALREADY_REPORTED,
    });
  });

  it('al llegar al tope, la publicación se oculta sola', async () => {
    const { service, listingsService } = buildHarness({
      autoPauseAfterReports: 3,
      pendingAfterReport: 3,
    });

    await service.report(
      {
        listingId: 'listing-1',
        reason: MarketplaceReportReason.SCAM,
      },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(listingsService.pauseByReports).toHaveBeenCalled();
  });

  it('antes del tope no se oculta nada', async () => {
    const { service, listingsService } = buildHarness({
      autoPauseAfterReports: 3,
      pendingAfterReport: 2,
    });

    await service.report(
      {
        listingId: 'listing-1',
        reason: MarketplaceReportReason.SCAM,
      },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(listingsService.pauseByReports).not.toHaveBeenCalled();
  });

  it('en cero, la pausa automática queda apagada', async () => {
    const { service, listingsService } = buildHarness({
      autoPauseAfterReports: 0,
      pendingAfterReport: 9,
    });

    await service.report(
      {
        listingId: 'listing-1',
        reason: MarketplaceReportReason.SCAM,
      },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(listingsService.pauseByReports).not.toHaveBeenCalled();
  });
});

describe('MarketplaceReportsService — resolver', () => {
  // Se construye en cada prueba: el servicio muta el reporte que recibe, y una
  // constante compartida llegaría ya resuelta a la siguiente.
  const pendingReport = (): MarketplaceListingReport =>
    ({
      id: 'report-1',
      listingId: 'listing-1',
      complexId: 'complex-1',
      reason: MarketplaceReportReason.PROHIBITED_ITEM,
      status: MarketplaceReportStatus.PENDING,
    }) as MarketplaceListingReport;

  it('aceptar el reporte retira la publicación', async () => {
    const { service, reportRepo, listingsService } = buildHarness();
    reportRepo.findOne.mockResolvedValueOnce(pendingReport());

    await service.resolve(
      { reportId: 'report-1', accept: true, note: 'Gota a gota' },
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(listingsService.removeByReport).toHaveBeenCalled();
    expect(listingsService.restoreAfterDismissedReport).not.toHaveBeenCalled();
  });

  it('desestimarlo la devuelve a la vitrina', async () => {
    const { service, reportRepo, listingsService } = buildHarness();
    reportRepo.findOne.mockResolvedValueOnce(pendingReport());

    await service.resolve(
      { reportId: 'report-1', accept: false },
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(listingsService.restoreAfterDismissedReport).toHaveBeenCalled();
    expect(listingsService.removeByReport).not.toHaveBeenCalled();
  });

  it('un reporte ya resuelto no se vuelve a resolver', async () => {
    const { service, reportRepo } = buildHarness();
    reportRepo.findOne.mockResolvedValueOnce({
      ...pendingReport(),
      status: MarketplaceReportStatus.DISMISSED,
    });

    await expect(
      service.resolve(
        { reportId: 'report-1', accept: true },
        userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
      ),
    ).rejects.toMatchObject({
      errorCode: MarketplaceErrorCode.LISTING_REPORT_ALREADY_RESOLVED,
    });
  });

  it('resolver descuenta el reporte del contador de la publicación', async () => {
    const { service, reportRepo, listingsService } = buildHarness();
    reportRepo.findOne.mockResolvedValueOnce(pendingReport());

    await service.resolve(
      { reportId: 'report-1', accept: false },
      userOf([ValidRoles.COMPLEX_ROL], 'admin-1'),
    );

    expect(listingsService.adjustPendingReports).toHaveBeenCalledWith(
      'listing-1',
      -1,
    );
  });
});
