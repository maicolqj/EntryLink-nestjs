import { ValidRoles } from '../../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import {
  GrowthLegalReviewStatus as Legal,
  GrowthSourceKind,
  GrowthSourceStatus as Status,
} from '../../shared/growth.enums';
import { GrowthDataSource } from '../entities/growth-data-source.entity';
import { DataSourcesService } from './data-sources.service';

const actor: JwtAccessPayload = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'admin@alternaqj.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's',
  roles: [ValidRoles.SUPER_ADMIN_ROL],
  permissions: [],
};

const base = (over: Partial<GrowthDataSource> = {}): GrowthDataSource =>
  ({
    id: 'src-1',
    code: 'GOOGLE_PLACES',
    name: 'Google Places',
    kind: GrowthSourceKind.PAID_API,
    termsSummary: 'Términos de uso de la API de pago de Google',
    processingPurpose: 'Contacto comercial B2B de administradoras',
    allowsAutomation: false,
    legalReviewStatus: Legal.PENDING,
    requiresCostApproval: true,
    status: Status.PENDING_APPROVAL,
    ...over,
  }) as GrowthDataSource;

function setup(source: GrowthDataSource | null) {
  const manager = {
    findOne: jest.fn(async () => (source ? { ...source } : null)),
    save: jest.fn(async (e: any): Promise<any> => e),
    create: jest.fn((_: unknown, d: object) => d),
  };
  const dataSource = {
    transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const activity = { record: jest.fn() };
  const service = new DataSourcesService(
    {} as never,
    dataSource as never,
    activity as never,
  );
  return { service, manager, activity };
}

describe('DataSourcesService', () => {
  it('una fuente nueva nace pendiente; si es de pago exige aprobación de costo', async () => {
    const { service, manager } = setup(null);
    await service.create(
      {
        code: 'NUEVA_API',
        name: 'API nueva',
        kind: GrowthSourceKind.PAID_API,
        termsSummary: 'Términos de uso de la API nueva de pago',
        processingPurpose: 'Contacto comercial B2B de administradoras',
        allowsAutomation: true,
      },
      actor,
    );
    expect(manager.save.mock.calls[0][0]).toMatchObject({
      status: Status.PENDING_APPROVAL,
      legalReviewStatus: Legal.PENDING,
      requiresCostApproval: true,
    });
  });

  describe('activar', () => {
    it('sin revisión jurídica aprobada no se activa', async () => {
      const { service } = setup(
        base({
          kind: GrowthSourceKind.MANUAL_RESEARCH,
          requiresCostApproval: false,
        }),
      );
      await expect(
        service.setStatus('src-1', { status: Status.ACTIVE }, actor),
      ).rejects.toThrow('revisión jurídica');
    });

    it('una fuente de pago con revisión jurídica pero sin presupuesto aprobado no se activa', async () => {
      const { service } = setup(base({ legalReviewStatus: Legal.APPROVED }));
      await expect(
        service.setStatus('src-1', { status: Status.ACTIVE }, actor),
      ).rejects.toThrow('aprobación de costo');
    });

    it('con revisión jurídica y costo aprobado sí se activa', async () => {
      const { service, manager } = setup(
        base({
          legalReviewStatus: Legal.APPROVED,
          costApprovedAt: new Date(),
          monthlyBudgetCop: 100000,
          monthlyRequestCap: 1000,
        }),
      );
      await service.setStatus('src-1', { status: Status.ACTIVE }, actor);
      expect(manager.save.mock.calls[0][0].status).toBe(Status.ACTIVE);
    });
  });

  it('aprobar el costo no activa la fuente', async () => {
    const { service, manager } = setup(
      base({ legalReviewStatus: Legal.APPROVED }),
    );
    await service.approveCost(
      'src-1',
      {
        monthlyBudgetCop: 50000,
        monthlyRequestCap: 500,
        costEstimateNotes: 'Estimado de 500 consultas a 100 COP',
      },
      actor,
    );
    expect(manager.save.mock.calls[0][0]).toMatchObject({
      status: Status.PENDING_APPROVAL,
      costApprovedByUserId: actor.sub,
    });
  });

  it('cambiar términos o finalidad anula la revisión jurídica, el costo y la activación', async () => {
    const { service, manager, activity } = setup(
      base({
        legalReviewStatus: Legal.APPROVED,
        legalReviewReference: 'Concepto 1',
        legalReviewedAt: new Date(),
        legalReviewedByUserId: actor.sub,
        costApprovedAt: new Date(),
        costApprovedByUserId: actor.sub,
        monthlyBudgetCop: 1,
        monthlyRequestCap: 1,
        status: Status.ACTIVE,
      }),
    );
    await service.update(
      'src-1',
      { processingPurpose: 'Otra finalidad comercial distinta' },
      actor,
    );
    expect(manager.save.mock.calls[0][0]).toMatchObject({
      status: Status.PENDING_APPROVAL,
      legalReviewStatus: Legal.PENDING,
      legalReviewReference: null,
      costApprovedAt: null,
      requiresCostApproval: true,
    });
    expect(activity.record.mock.calls[0][2].action).toBe('SOURCE_REDEFINED');
  });

  it('cambiar solo el nombre no anula las aprobaciones', async () => {
    const { service, manager } = setup(
      base({
        legalReviewStatus: Legal.APPROVED,
        status: Status.ACTIVE,
        costApprovedAt: new Date(),
      }),
    );
    await service.update('src-1', { name: 'Google Places (Bogotá)' }, actor);
    expect(manager.save.mock.calls[0][0]).toMatchObject({
      status: Status.ACTIVE,
      legalReviewStatus: Legal.APPROVED,
    });
  });

  it('el rechazo jurídico deshabilita la fuente', async () => {
    const { service, manager } = setup(base());
    await service.reviewLegal(
      'src-1',
      { decision: Legal.REJECTED, reference: 'Concepto jurídico 2026-10' },
      actor,
    );
    expect(manager.save.mock.calls[0][0]).toMatchObject({
      status: Status.DISABLED,
      legalReviewStatus: Legal.REJECTED,
    });
  });
});
