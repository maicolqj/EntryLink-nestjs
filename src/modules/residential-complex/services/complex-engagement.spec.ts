import { ResidentialComplexService } from './residential-complex.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { ComplexEngagement } from '../enums/complex-engagement.enum';
import { ComplexStatus } from '../enums/complex-status.enum';
import { DpaValidationStatus } from '../enums/dpa-validation-status.enum';
import { ResidentialComplex } from '../entities/residential-complex.entity';

/**
 * Vinculación piloto / comercial. Al pasar a comercial el acuerdo de piloto
 * firmado se archiva (si no, la subida del B2B lo borraría de R2) y el cupo
 * del documento firmado queda libre. Un conjunto comercial activo no vuelve a
 * la prueba gratis.
 */
const service = Object.create(
  ResidentialComplexService.prototype,
) as ResidentialComplexService;

const apply = (complex: Partial<ResidentialComplex>, next: ComplexEngagement) =>
  (
    service as unknown as {
      applyEngagementChange: (
        c: Partial<ResidentialComplex>,
        n: ComplexEngagement,
      ) => void;
    }
  ).applyEngagementChange(complex, next);

describe('ResidentialComplexService — vinculación piloto / comercial', () => {
  it('piloto → comercial: archiva el acuerdo firmado y libera el cupo', () => {
    const uploadedAt = new Date('2026-10-01T15:00:00Z');
    const complex: Partial<ResidentialComplex> = {
      slug: 'torres-del-parque',
      status: ComplexStatus.ACTIVE,
      engagement: ComplexEngagement.PILOT,
      signedDpaUrl: 'https://r2/x.pdf',
      signedDpaPublicId: 'torres/documents/signed-dpa/x.pdf',
      signedDpaFileName: 'acuerdo.pdf',
      signedDpaUploadedAt: uploadedAt,
      signedDpaStatus: DpaValidationStatus.APPROVED,
    };

    apply(complex, ComplexEngagement.COMMERCIAL);

    expect(complex.engagement).toBe(ComplexEngagement.COMMERCIAL);
    expect(complex.pilotAgreementPublicId).toBe(
      'torres/documents/signed-dpa/x.pdf',
    );
    expect(complex.pilotAgreementFileName).toBe('acuerdo.pdf');
    expect(complex.pilotAgreementSignedAt).toBe(uploadedAt);
    expect(complex.signedDpaPublicId).toBeNull();
    expect(complex.signedDpaStatus).toBeNull();
    expect(complex.convertedToCommercialAt).toBeInstanceOf(Date);
  });

  it('comercial → piloto antes de activar: se permite', () => {
    const complex: Partial<ResidentialComplex> = {
      status: ComplexStatus.PENDING_SETUP,
      engagement: ComplexEngagement.COMMERCIAL,
    };

    apply(complex, ComplexEngagement.PILOT);

    expect(complex.engagement).toBe(ComplexEngagement.PILOT);
  });

  it('comercial activo → piloto: se rechaza', () => {
    const complex: Partial<ResidentialComplex> = {
      status: ComplexStatus.ACTIVE,
      engagement: ComplexEngagement.COMMERCIAL,
    };

    expect(() => apply(complex, ComplexEngagement.PILOT)).toThrow(CustomError);
    expect(complex.engagement).toBe(ComplexEngagement.COMMERCIAL);
  });

  it('ya convertido a comercial → piloto: se rechaza aunque esté sin activar', () => {
    const complex: Partial<ResidentialComplex> = {
      status: ComplexStatus.PENDING_SETUP,
      engagement: ComplexEngagement.COMMERCIAL,
      convertedToCommercialAt: new Date(),
    };

    expect(() => apply(complex, ComplexEngagement.PILOT)).toThrow(CustomError);
  });
});

describe('ResidentialComplexService — prueba piloto al activar', () => {
  const build = (trialUsed: boolean) => {
    const grantTrial = jest.fn(async () => ({}));
    const svc = Object.create(
      ResidentialComplexService.prototype,
    ) as ResidentialComplexService;
    Object.assign(svc, {
      dataSource: {
        getRepository: () => ({ exists: jest.fn(async () => trialUsed) }),
      },
      moduleRef: { get: () => ({ grantTrial }) },
      logger: { log: jest.fn(), error: jest.fn() },
    });
    const run = (complex: Partial<ResidentialComplex>) =>
      (
        svc as unknown as {
          grantPilotTrial: (
            c: Partial<ResidentialComplex>,
            u: { sub: string },
          ) => Promise<void>;
        }
      ).grantPilotTrial(complex, { sub: 'admin-1' });
    return { run, grantTrial };
  };

  it('otorga la prueba con los días elegidos', async () => {
    const { run, grantTrial } = build(false);
    await run({ id: 'c1', slug: 'c1', pilotTrialDays: 45 });
    expect(grantTrial).toHaveBeenCalledWith(
      expect.objectContaining({ complexId: 'c1', days: 45, reason: 'TRIAL' }),
      'admin-1',
    );
  });

  it('sin días elegidos: 30', async () => {
    const { run, grantTrial } = build(false);
    await run({ id: 'c1', slug: 'c1', pilotTrialDays: null });
    expect(grantTrial).toHaveBeenCalledWith(
      expect.objectContaining({ days: 30 }),
      'admin-1',
    );
  });

  it('si ya usó la prueba (reactivación) no la repite', async () => {
    const { run, grantTrial } = build(true);
    await run({ id: 'c1', slug: 'c1' });
    expect(grantTrial).not.toHaveBeenCalled();
  });
});
