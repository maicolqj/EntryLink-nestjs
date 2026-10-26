import {
  SubscriptionPaymentsService,
  checkPaymentCovers,
  isRenewalOpen,
  renewalPlan,
} from './subscription-payments.service';
import { SubscriptionPaymentStatus } from '../enums/subscription-payment-status.enum';
import { SubscriptionPeriodKind } from '../enums/subscription-period-kind.enum';
import { BillingCycle } from '../enums/billing-cycle.enum';
import { ComplexPlan } from '../../residential-complex/enums/complex-plan.enum';
import { NotificationType } from '../../notifications/enums/notification-type.enum';
import { SubscriptionErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

const CX = '11111111-1111-1111-1111-111111111111';
const OTHER_CX = '22222222-2222-2222-2222-222222222222';
const ADMIN_ID = '99999999-9999-9999-9999-999999999999';

const complexAccount: JwtAccessPayload = {
  sub: CX,
  email: 'admin@conjunto.co',
  type: 'access',
  entityType: 'complex',
  tokenVersion: 1,
  sessionId: 's1',
  roles: [ValidRoles.COMPLEX_ROL],
  permissions: [],
};

const superAdmin: JwtAccessPayload = {
  ...complexAccount,
  sub: ADMIN_ID,
  entityType: 'user',
  roles: [ValidRoles.SUPER_ADMIN_ROL],
};

const receipt = {
  buffer: Buffer.from('x'),
  originalname: 'comprobante.pdf',
  mimetype: 'application/pdf',
  size: 1024,
} as Express.Multer.File;

const QUOTE_TOTAL = 333200;

function setup(options?: {
  daysLeft?: number | null;
  plan?: ComplexPlan;
  pending?: boolean;
  configured?: boolean;
  submission?: Record<string, unknown> | null;
}) {
  const daysLeft = options && 'daysLeft' in options ? options.daysLeft : 2;

  const submissionRepo = {
    exist: jest.fn().mockResolvedValue(options?.pending ?? false),
    create: jest.fn((data: Record<string, unknown>) => data),
    save: jest.fn((data: Record<string, unknown>) =>
      Promise.resolve({ id: 'sub-1', createdAt: new Date(), ...data }),
    ),
    findOne: jest.fn().mockResolvedValue(options?.submission ?? null),
    update: jest.fn().mockResolvedValue({ affected: 1 }),
    find: jest.fn().mockResolvedValue([]),
  };
  const settingsRepo = {
    findOne: jest.fn().mockResolvedValue(null),
    save: jest.fn().mockResolvedValue(undefined),
  };
  const complexRepo = {
    findOne: jest
      .fn()
      .mockResolvedValue({ id: CX, slug: 'alameda', name: 'Alameda' }),
  };
  const subscriptionsService = {
    getSummary: jest.fn().mockResolvedValue({
      complexId: CX,
      complexName: 'Alameda',
      plan: options?.plan ?? ComplexPlan.PRO,
      daysLeft,
      quote: { cycle: BillingCycle.MONTHLY },
      periods: [],
    }),
    getQuote: jest.fn().mockResolvedValue({
      configured: options?.configured ?? true,
      total: QUOTE_TOTAL,
      cycle: BillingCycle.MONTHLY,
    }),
    renew: jest.fn().mockResolvedValue({
      periods: [
        {
          id: 'old',
          kind: SubscriptionPeriodKind.PAID,
          createdAt: new Date('2026-01-01'),
        },
        {
          id: 'new',
          kind: SubscriptionPeriodKind.PAID,
          createdAt: new Date('2026-10-26'),
        },
      ],
    }),
    notifyComplex: jest.fn().mockResolvedValue(undefined),
  };
  const notificationsService = {
    findSuperAdminUserIds: jest.fn().mockResolvedValue([ADMIN_ID]),
    notify: jest.fn().mockResolvedValue([]),
  };
  const storageService = {
    buildFolder: jest.fn(() => 'EntryLink/alameda/subscriptions/receipts'),
    uploadBuffer: jest.fn().mockResolvedValue({
      url: 'https://files.alternaqj.com/x.pdf',
      publicId: 'EntryLink/alameda/subscriptions/receipts/x.pdf',
    }),
    deleteByPublicId: jest.fn().mockResolvedValue(undefined),
    keyFromPublicUrl: jest.fn(),
  };

  const service = new SubscriptionPaymentsService(
    submissionRepo as never,
    settingsRepo as never,
    complexRepo as never,
    subscriptionsService as never,
    notificationsService as never,
    storageService as never,
  );

  return {
    service,
    submissionRepo,
    subscriptionsService,
    notificationsService,
    storageService,
  };
}

const dto = (amountPaid: number) => ({
  amountPaid,
  paidAt: new Date('2026-10-26T15:00:00Z'),
  reference: ' TX-123 ',
});

describe('reglas', () => {
  it('el botón se abre desde 3 días antes y sigue abierto vencida', () => {
    expect(isRenewalOpen(4)).toBe(false);
    expect(isRenewalOpen(3)).toBe(true);
    expect(isRenewalOpen(0)).toBe(true);
    expect(isRenewalOpen(-6)).toBe(true);
    expect(isRenewalOpen(null)).toBe(false);
  });

  it('quien sale de la prueba gratis renueva al plan Básico', () => {
    expect(renewalPlan(ComplexPlan.FREE)).toBe(ComplexPlan.BASIC);
    expect(renewalPlan(ComplexPlan.PRO)).toBe(ComplexPlan.PRO);
  });

  it('un pago incompleto dice cuánto falta; los centavos no cuentan', () => {
    expect(checkPaymentCovers(333200, 300000)).toEqual({
      complete: false,
      missing: 33200,
    });
    expect(checkPaymentCovers(333200.4, 333200)).toEqual({
      complete: true,
      missing: 0,
    });
    expect(checkPaymentCovers(333200, 400000).complete).toBe(true);
  });
});

describe('SubscriptionPaymentsService.submit', () => {
  it('rechaza el pago incompleto con la diferencia y no sube el comprobante', async () => {
    const { service, storageService, submissionRepo } = setup();

    const error = (await service
      .submit(CX, dto(300000), receipt, complexAccount)
      .catch((e: unknown) => e)) as { errorCode: string; message: string };

    expect(error.errorCode).toBe(
      SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_INCOMPLETE,
    );
    expect(error.message).toContain('faltan $');
    expect(storageService.uploadBuffer).not.toHaveBeenCalled();
    expect(submissionRepo.save).not.toHaveBeenCalled();
  });

  it('el error del pago incompleto trae los valores para la pantalla', async () => {
    const { service } = setup();

    const error = (await service
      .submit(CX, dto(300000), receipt, complexAccount)
      .catch((e: unknown) => e)) as { details: string };

    expect(JSON.parse(error.details)).toEqual({
      amountDue: QUOTE_TOTAL,
      amountPaid: 300000,
      missing: 33200,
    });
  });

  it('fuera de los últimos 3 días no se recibe', async () => {
    const { service } = setup({ daysLeft: 10 });

    await expect(
      service.submit(CX, dto(QUOTE_TOTAL), receipt, complexAccount),
    ).rejects.toMatchObject({
      errorCode: SubscriptionErrorCode.SUBSCRIPTION_RENEWAL_NOT_OPEN,
    });
  });

  it('con un soporte en revisión no se recibe otro', async () => {
    const { service } = setup({ pending: true });

    await expect(
      service.submit(CX, dto(QUOTE_TOTAL), receipt, complexAccount),
    ).rejects.toMatchObject({
      errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_PENDING_EXISTS,
    });
  });

  it('sin comprobante no se recibe', async () => {
    const { service } = setup();

    await expect(
      service.submit(CX, dto(QUOTE_TOTAL), undefined, complexAccount),
    ).rejects.toMatchObject({
      errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_RECEIPT_REQUIRED,
    });
  });

  it('un pago completo queda pendiente y avisa al SUPER_ADMIN', async () => {
    const {
      service,
      submissionRepo,
      notificationsService,
      subscriptionsService,
    } = setup({ plan: ComplexPlan.FREE });

    const saved = await service.submit(
      CX,
      dto(QUOTE_TOTAL),
      receipt,
      complexAccount,
    );

    expect(subscriptionsService.getQuote).toHaveBeenCalledWith(
      CX,
      ComplexPlan.BASIC,
      BillingCycle.MONTHLY,
    );
    expect(submissionRepo.create).toHaveBeenCalledWith(
      expect.objectContaining({
        status: SubscriptionPaymentStatus.PENDING,
        amountDue: QUOTE_TOTAL,
        amountPaid: QUOTE_TOTAL,
        reference: 'TX-123',
        // La cuenta del complejo no es un usuario.
        submittedByUserId: null,
      }),
    );
    expect(saved.status).toBe(SubscriptionPaymentStatus.PENDING);
    expect(notificationsService.notify).toHaveBeenCalledWith(
      expect.objectContaining({
        userIds: [ADMIN_ID],
        type: NotificationType.SUBSCRIPTION_PAYMENT_SUBMITTED,
        entityType: 'subscription_payment',
        entityId: 'sub-1',
      }),
    );
  });
});

describe('SubscriptionPaymentsService revisión', () => {
  const pending = {
    id: 'sub-1',
    complexId: CX,
    plan: ComplexPlan.PRO,
    cycle: BillingCycle.MONTHLY,
    amountPaid: QUOTE_TOTAL,
    paidAt: new Date('2026-10-26'),
    reference: 'TX-123',
    status: SubscriptionPaymentStatus.PENDING,
  };

  it('aprobar registra el pago con la renovación normal y enlaza el periodo', async () => {
    const { service, subscriptionsService, submissionRepo } = setup({
      submission: pending,
    });

    await service.approve('sub-1', ADMIN_ID);

    expect(subscriptionsService.renew).toHaveBeenCalledWith(
      expect.objectContaining({
        complexId: CX,
        plan: ComplexPlan.PRO,
        amount: QUOTE_TOTAL,
        paymentReference: 'TX-123',
      }),
      ADMIN_ID,
    );
    expect(submissionRepo.update).toHaveBeenCalledWith('sub-1', {
      periodId: 'new',
    });
  });

  it('dos aprobaciones a la vez: la segunda no renueva otra vez', async () => {
    const { service, subscriptionsService, submissionRepo } = setup({
      submission: pending,
    });
    submissionRepo.update.mockResolvedValueOnce({ affected: 0 });

    await expect(service.approve('sub-1', ADMIN_ID)).rejects.toMatchObject({
      errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_NOT_PENDING,
    });
    expect(subscriptionsService.renew).not.toHaveBeenCalled();
  });

  it('si la renovación falla el soporte vuelve a quedar pendiente', async () => {
    const { service, subscriptionsService, submissionRepo } = setup({
      submission: pending,
    });
    subscriptionsService.renew.mockRejectedValueOnce(new Error('BD caída'));

    await expect(service.approve('sub-1', ADMIN_ID)).rejects.toThrow(
      'BD caída',
    );
    expect(submissionRepo.update).toHaveBeenLastCalledWith('sub-1', {
      status: SubscriptionPaymentStatus.PENDING,
      reviewedByUserId: null,
      reviewedAt: null,
    });
  });

  it('rechazar avisa al conjunto con el motivo', async () => {
    const { service, subscriptionsService } = setup({ submission: pending });

    await service.reject('sub-1', 'El pago no aparece en la cuenta', ADMIN_ID);

    const [[notice]] = subscriptionsService.notifyComplex.mock.calls as [
      [{ complexId: string; type: string; metadata: { reason: string } }],
    ];
    expect(notice.complexId).toBe(CX);
    expect(notice.type).toBe(NotificationType.SUBSCRIPTION_PAYMENT_REJECTED);
    expect(notice.metadata.reason).toBe('El pago no aparece en la cuenta');
  });

  it('el comprobante solo lo ven el mismo conjunto y la plataforma', async () => {
    const { service } = setup({ submission: pending });

    await expect(
      service.resolveReceipt('sub-1', complexAccount),
    ).resolves.toBeTruthy();
    await expect(
      service.resolveReceipt('sub-1', superAdmin),
    ).resolves.toBeTruthy();
    await expect(
      service.resolveReceipt('sub-1', { ...complexAccount, sub: OTHER_CX }),
    ).rejects.toMatchObject({
      errorCode: SubscriptionErrorCode.SUBSCRIPTION_PAYMENT_NOT_FOUND,
    });
  });
});
