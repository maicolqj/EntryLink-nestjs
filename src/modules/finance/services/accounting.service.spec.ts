import { Test } from '@nestjs/testing';
import { getRepositoryToken } from '@nestjs/typeorm';
import { DataSource } from 'typeorm';

import { AccountingService } from './accounting.service';
import { PucAccount } from '../entities/puc-account.entity';
import { AccountingHeader } from '../entities/accounting-header.entity';
import { FeeCharge } from '../entities/fee-charge.entity';
import { WalletEntry } from '../entities/wallet-entry.entity';
import { PropertyAccountStatus } from '../entities/property-account-status.entity';
import { RecurringCharge } from '../entities/recurring-charge.entity';
import { DocumentSequence } from '../entities/document-sequence.entity';
import { Unit } from '../../residential-complex/entities/unit.entity';

import { AccountingDocumentType } from '../enums/accounting-document-type.enum';
import { PrelacionConcept } from '../enums/prelacion-concept.enum';
import { ChargeStatus } from '../enums/charge-status.enum';
import { RecurringChargeType } from '../enums/recurring-charge-type.enum';
import { PaymentMethod } from '../enums/payment-method.enum';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { ResidentsService } from '../../residents/services/residents.service';
import { NotificationsService } from '../../notifications/services/notifications.service';
import { AuditService } from '../../audit/services/audit.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { FinanceErrorCode } from '../../shared/constans/error-codes.constants';
import { AccountClass, AccountNature } from '../enums/account-nature.enum';

/**
 * Specs de las transacciones contables. Mockeamos un EntityManager mínimo que
 * despacha find/findOne/save por nombre de entidad, y un DataSource cuyo
 * `transaction(cb)` ejecuta el callback con ese em. Las cuentas PUC se resuelven
 * desde un mapa por código/id.
 */
describe('AccountingService', () => {
  let service: AccountingService;
  let pucRepo: { find: jest.Mock; findOne: jest.Mock; create: jest.Mock; save: jest.Mock; remove: jest.Mock; count: jest.Mock };
  let recurringRepo: { find: jest.Mock; create: jest.Mock; save: jest.Mock; count: jest.Mock };
  let em: any;
  let saved: Record<string, any[]>;
  let store: Record<string, any[]>;
  let pucByCode: Record<string, any>;

  const user = { sub: 'user-1', email: 'admin@test.com', roles: ['COMPLEX_ROL'] } as any;
  const CPX = 'cpx-1';

  const puc = (code: string) => ({ id: `acc-${code}`, code, complexId: CPX, isPostable: true, isActive: true });

  beforeEach(async () => {
    saved = { AccountingHeader: [], WalletEntry: [], FeeCharge: [], PropertyAccountStatus: [], DocumentSequence: [], RecurringCharge: [] };
    store = { FeeCharge: [], WalletEntry: [], PropertyAccountStatus: [], RecurringCharge: [], Unit: [] };
    pucByCode = {};

    em = {
      create: (_E: any, obj: any) => ({ ...obj }),
      save: jest.fn(async (E: any, obj: any) => {
        if (Array.isArray(obj)) return obj;
        if (!obj.id) obj.id = `${E.name}-${(saved[E.name]?.length ?? 0) + 1}`;
        (saved[E.name] ??= []).push(obj);
        return obj;
      }),
      find: jest.fn(async (E: any) => store[E.name] ?? []),
      count: jest.fn(async (E: any) => (store[E.name] ?? []).length),
      findOne: jest.fn(async (E: any, opts: any) => {
        const where = opts?.where ?? {};
        if (E.name === 'PucAccount') {
          if (where.code) return pucByCode[where.code] ?? null;
          if (where.id) return Object.values(pucByCode).find((a: any) => a.id === where.id) ?? null;
          return null;
        }
        if (E.name === 'DocumentSequence') return null; // siempre arranca consecutivo en 1
        if (E.name === 'PropertyAccountStatus') return null; // getOrCreateStatus crea nuevo
        if (E.name === 'FeeCharge') return null; // sin duplicado previo
        return null;
      }),
    };

    const dataSource = {
      transaction: jest.fn(async (cb: any) => cb(em)),
      manager: em,
    } as unknown as DataSource;

    pucRepo = {
      find: jest.fn(),
      findOne: jest.fn(),
      create: jest.fn((o: any) => ({ ...o })),
      save: jest.fn(async (o: any) => (o.id ? o : { ...o, id: 'acc-new' })),
      remove: jest.fn(async (o: any) => o),
      count: jest.fn(async () => 0),
    };
    recurringRepo = {
      find: jest.fn(async () => store.RecurringCharge),
      create: jest.fn((o: any) => ({ ...o })),
      save: jest.fn(async (o: any) => o),
      count: jest.fn(async () => 0),
    };

    const moduleRef = await Test.createTestingModule({
      providers: [
        AccountingService,
        { provide: getRepositoryToken(PucAccount), useValue: pucRepo },
        { provide: getRepositoryToken(RecurringCharge), useValue: recurringRepo },
        { provide: DataSource, useValue: dataSource },
        { provide: ResidentialComplexService, useValue: { findById: jest.fn() } },
        { provide: ResidentsService, useValue: { findActiveByUnitInternal: jest.fn(async () => []) } },
        { provide: NotificationsService, useValue: { notify: jest.fn(async () => []) } },
        { provide: AuditService, useValue: { log: jest.fn() } },
      ],
    }).compile();

    service = moduleRef.get(AccountingService);
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('registerExpense', () => {
    const input = {
      complexId: CPX,
      documentDate: new Date('2025-03-10'),
      period: '2025-03',
      memo: 'Pago servicios',
      paymentAccountId: 'acc-1110',
      thirdPartyName: 'EPM',
      lines: [
        { pucAccountId: 'acc-5135', amount: 100, memo: 'Energía' },
        { pucAccountId: 'acc-5135b', amount: 50, memo: 'Agua' },
      ],
    } as any;

    it('asienta partida doble balanceada (N débitos = 1 crédito a caja/banco)', async () => {
      pucRepo.find.mockResolvedValue([
        { id: 'acc-1110' }, { id: 'acc-5135' }, { id: 'acc-5135b' },
      ]);

      const header = await service.registerExpense(input, user);

      expect(header.documentType).toBe(AccountingDocumentType.EXPENSE_VOUCHER);
      expect(header.totalDebit).toBe(150);
      expect(header.totalCredit).toBe(150);
      expect(header.createdByUserId).toBe(user.sub);

      const debits = header.lines.filter((l: any) => l.debit > 0);
      const credits = header.lines.filter((l: any) => l.credit > 0);
      expect(debits).toHaveLength(2);
      expect(credits).toHaveLength(1);
      expect(credits[0].credit).toBe(150);
      expect(credits[0].pucAccountId).toBe('acc-1110');
      // Justificación por línea preservada
      expect(debits.map((l: any) => l.memo)).toEqual(['Energía', 'Agua']);
    });

    it('rechaza monto total no positivo', async () => {
      pucRepo.find.mockResolvedValue([{ id: 'acc-1110' }, { id: 'acc-5135' }]);
      const bad = { ...input, lines: [{ pucAccountId: 'acc-5135', amount: 0, memo: 'x' }] };
      await expect(service.registerExpense(bad, user)).rejects.toMatchObject({
        errorCode: FinanceErrorCode.INVALID_AMOUNT,
      });
    });

    it('rechaza cuentas PUC inválidas', async () => {
      pucRepo.find.mockResolvedValue([]); // ninguna cuenta resuelta
      await expect(service.registerExpense(input, user)).rejects.toMatchObject({
        errorCode: FinanceErrorCode.PUC_ACCOUNT_INVALID,
      });
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('recomputeUnitStatus', () => {
    it('currentBalance = deuda de cargos abiertos; prepaidBalance = wallet neto', async () => {
      store.FeeCharge = [
        { amount: 100, paidAmount: 30, status: ChargeStatus.PENDING },
        { amount: 50, paidAmount: 0, status: ChargeStatus.OVERDUE },
      ];
      store.WalletEntry = [
        { type: 'CREDIT', amount: 80 },
        { type: 'DEBIT', amount: 20 },
      ];

      const st = await service.recomputeUnitStatus(em, CPX, 'unit-1');

      expect(st.currentBalance).toBe(120); // 70 + 50
      expect(st.prepaidBalance).toBe(60);  // 80 - 20
    });

    it('prepaidBalance nunca es negativo', async () => {
      store.FeeCharge = [];
      store.WalletEntry = [{ type: 'DEBIT', amount: 40 }];
      const st = await service.recomputeUnitStatus(em, CPX, 'unit-1');
      expect(st.prepaidBalance).toBe(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('applyPrepaidBalances', () => {
    beforeEach(() => {
      pucByCode['2805'] = puc('2805');
      pucByCode['1311'] = puc('1311');
    });

    it('imputa el anticipo respetando la prelación (mora antes que ordinaria)', async () => {
      store.PropertyAccountStatus = [{ complexId: CPX, unitId: 'unit-1', prepaidBalance: 100, currentBalance: 80 }];
      store.FeeCharge = [
        { id: 'ch-ord', amount: 50, paidAmount: 0, status: ChargeStatus.PENDING, period: '2025-01', createdAt: new Date('2025-01-05'), prelacionConcept: PrelacionConcept.ORDINARY, description: 'Admin' },
        { id: 'ch-mora', amount: 30, paidAmount: 0, status: ChargeStatus.OVERDUE, period: '2025-01', createdAt: new Date('2025-01-06'), prelacionConcept: PrelacionConcept.INTEREST_MORA, description: 'Mora' },
      ];

      const res = await service.applyPrepaidBalances(
        { complexId: CPX, period: '2025-02', dryRun: false } as any, user,
      );

      expect(res.totalApplied).toBe(80);
      expect(res.items[0].appliedAmount).toBe(80);

      // El primer WalletEntry DEBIT consumido es el de la mora (prelación)
      const debits = saved.WalletEntry.filter((w) => w.type === 'DEBIT');
      expect(debits[0].chargeId).toBe('ch-mora');
      expect(debits[0].amount).toBe(30);
      expect(debits[1].chargeId).toBe('ch-ord');
      expect(debits[1].amount).toBe(50);

      // Nota contable 2805 (débito) = 1311 (crédito) por el total aplicado
      const note = saved.AccountingHeader.find((h) => h.documentType === AccountingDocumentType.ACCOUNTING_NOTE);
      expect(note.totalDebit).toBe(80);
      expect(note.totalCredit).toBe(80);
      expect(note.lines.find((l: any) => l.debit > 0).pucAccountId).toBe('acc-2805');
      expect(note.lines.find((l: any) => l.credit > 0).pucAccountId).toBe('acc-1311');
    });

    it('dryRun no persiste asientos ni movimientos de wallet', async () => {
      store.PropertyAccountStatus = [{ complexId: CPX, unitId: 'unit-1', prepaidBalance: 100, currentBalance: 50 }];
      store.FeeCharge = [
        { id: 'ch-1', amount: 50, paidAmount: 0, status: ChargeStatus.PENDING, period: '2025-01', createdAt: new Date('2025-01-05'), prelacionConcept: PrelacionConcept.ORDINARY, description: 'Admin' },
      ];

      const res = await service.applyPrepaidBalances(
        { complexId: CPX, period: '2025-02', dryRun: true } as any, user,
      );

      expect(res.dryRun).toBe(true);
      expect(res.totalApplied).toBe(50);
      expect(saved.WalletEntry).toHaveLength(0);
      expect(saved.AccountingHeader).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('emitCashReceipt', () => {
    it('asienta Débito caja/banco = Crédito 1311 (cartera) + 2805 (anticipo)', async () => {
      pucByCode['1110'] = puc('1110');
      pucByCode['1311'] = puc('1311');
      pucByCode['2805'] = puc('2805');

      const id = await service.emitCashReceipt(em, {
        complexId: CPX, unitId: 'unit-1', documentDate: new Date('2025-03-10'),
        period: '2025-03', appliedToCharges: 100, prepaidExcess: 20,
        method: PaymentMethod.BANK_TRANSFER, createdByUserId: user.sub,
      });

      expect(id).not.toBeNull();
      const receipt = saved.AccountingHeader[0];
      expect(receipt.documentType).toBe(AccountingDocumentType.CASH_RECEIPT);
      expect(receipt.totalDebit).toBe(120);
      expect(receipt.totalCredit).toBe(120);
      const debit = receipt.lines.find((l: any) => l.debit > 0);
      expect(debit.pucAccountId).toBe('acc-1110'); // banco (no efectivo)
      expect(debit.debit).toBe(120);
      expect(receipt.lines.find((l: any) => l.pucAccountId === 'acc-1311').credit).toBe(100);
      expect(receipt.lines.find((l: any) => l.pucAccountId === 'acc-2805').credit).toBe(20);
    });

    it('usa caja (1105) cuando el método es efectivo', async () => {
      pucByCode['1105'] = puc('1105');
      pucByCode['1311'] = puc('1311');

      await service.emitCashReceipt(em, {
        complexId: CPX, unitId: 'unit-1', documentDate: new Date(), period: '2025-03',
        appliedToCharges: 60, prepaidExcess: 0, method: PaymentMethod.CASH, createdByUserId: user.sub,
      });

      const debit = saved.AccountingHeader[0].lines.find((l: any) => l.debit > 0);
      expect(debit.pucAccountId).toBe('acc-1105');
    });

    it('best-effort: omite el recibo (null) si la copropiedad no tiene PUC', async () => {
      // pucByCode vacío → requireAccount lanza PUC_ACCOUNT_NOT_FOUND
      const id = await service.emitCashReceipt(em, {
        complexId: CPX, unitId: 'unit-1', documentDate: new Date(), period: '2025-03',
        appliedToCharges: 100, prepaidExcess: 0, method: PaymentMethod.CASH, createdByUserId: user.sub,
      });
      expect(id).toBeNull();
      expect(saved.AccountingHeader).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('emitPrepaidApplicationNote', () => {
    it('asienta Débito 2805 (anticipo) = Crédito 1311 (cartera)', async () => {
      pucByCode['2805'] = puc('2805');
      pucByCode['1311'] = puc('1311');

      const id = await service.emitPrepaidApplicationNote(em, {
        complexId: CPX, unitId: 'unit-1', amount: 40, period: '2025-03',
        createdByUserId: user.sub, memo: 'Aplicación manual',
      });

      expect(id).not.toBeNull();
      const note = saved.AccountingHeader[0];
      expect(note.documentType).toBe(AccountingDocumentType.ACCOUNTING_NOTE);
      expect(note.totalDebit).toBe(40);
      expect(note.totalCredit).toBe(40);
      expect(note.lines.find((l: any) => l.debit > 0).pucAccountId).toBe('acc-2805');
      expect(note.lines.find((l: any) => l.credit > 0).pucAccountId).toBe('acc-1311');
    });

    it('best-effort: devuelve null si la copropiedad no tiene PUC', async () => {
      const id = await service.emitPrepaidApplicationNote(em, {
        complexId: CPX, unitId: 'unit-1', amount: 40, period: '2025-03',
        createdByUserId: user.sub,
      });
      expect(id).toBeNull();
      expect(saved.AccountingHeader).toHaveLength(0);
    });

    it('no asienta nada si el monto es 0', async () => {
      const id = await service.emitPrepaidApplicationNote(em, {
        complexId: CPX, unitId: 'unit-1', amount: 0, period: '2025-03',
        createdByUserId: user.sub,
      });
      expect(id).toBeNull();
      expect(saved.AccountingHeader).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('emitMoraNote', () => {
    it('asienta Débito 1345 (intereses por cobrar) = Crédito 4210 (intereses de mora)', async () => {
      pucByCode['1345'] = puc('1345');
      pucByCode['4210'] = puc('4210');

      const id = await service.emitMoraNote(em, {
        complexId: CPX, unitId: 'unit-1', amount: 12.5, period: '2025-06',
        createdByUserId: user.sub, memo: 'Interés mora — Admin (2025-04)',
      });

      expect(id).not.toBeNull();
      const note = saved.AccountingHeader[0];
      expect(note.documentType).toBe(AccountingDocumentType.INVOICE);
      expect(note.totalDebit).toBe(12.5);
      expect(note.totalCredit).toBe(12.5);
      expect(note.lines.find((l: any) => l.debit > 0).pucAccountId).toBe('acc-1345');
      expect(note.lines.find((l: any) => l.credit > 0).pucAccountId).toBe('acc-4210');
    });

    it('best-effort: devuelve null si la copropiedad no tiene PUC', async () => {
      const id = await service.emitMoraNote(em, {
        complexId: CPX, unitId: 'unit-1', amount: 12.5, period: '2025-06',
        createdByUserId: user.sub,
      });
      expect(id).toBeNull();
      expect(saved.AccountingHeader).toHaveLength(0);
    });

    it('no asienta nada si el monto es 0', async () => {
      const id = await service.emitMoraNote(em, {
        complexId: CPX, unitId: 'unit-1', amount: 0, period: '2025-06',
        createdByUserId: user.sub,
      });
      expect(id).toBeNull();
      expect(saved.AccountingHeader).toHaveLength(0);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('causeRecurringChargesInternal', () => {
    beforeEach(() => {
      pucByCode['1311'] = puc('1311');
      pucByCode['4225'] = puc('4225');
      store.Unit = [{ id: 'unit-1', complexId: CPX }];
    });

    it('idempotencia: omite el recurrente ya causado en el período', async () => {
      store.RecurringCharge = [{
        id: 'rc-1', complexId: CPX, isActive: true, billingDay: 5,
        lastBilledPeriod: '2025-03', type: RecurringChargeType.INDEFINITE,
        amount: 100, incomeAccountId: 'acc-4225', unitId: 'unit-1', concept: 'Administración',
      }];

      const res = await service.causeRecurringChargesInternal(CPX, '2025-03', 'sys');
      expect(res.caused).toBe(0);
      expect(saved.AccountingHeader).toHaveLength(0);
      expect(saved.FeeCharge).toHaveLength(0);
    });

    it('causa INVOICE + FeeCharge por unidad y avanza el contador', async () => {
      store.RecurringCharge = [{
        id: 'rc-1', complexId: CPX, isActive: true, billingDay: 5,
        lastBilledPeriod: null, type: RecurringChargeType.INDEFINITE,
        amount: 100, incomeAccountId: 'acc-4225', unitId: 'unit-1', concept: 'Administración',
        currentInstallment: 0,
      }];

      const res = await service.causeRecurringChargesInternal(CPX, '2025-03', 'sys');

      expect(res.caused).toBe(1);
      expect(res.totalAmount).toBe(100);
      const invoice = saved.AccountingHeader.find((h) => h.documentType === AccountingDocumentType.INVOICE);
      expect(invoice.totalDebit).toBe(100);
      expect(invoice.lines.find((l: any) => l.debit > 0).pucAccountId).toBe('acc-1311'); // CxC
      expect(invoice.lines.find((l: any) => l.credit > 0).pucAccountId).toBe('acc-4225'); // ingreso
      expect(saved.FeeCharge).toHaveLength(1);
      expect(saved.FeeCharge[0].prelacionConcept).toBe(PrelacionConcept.ORDINARY);
    });

    it('prorratea por coeficiente de copropiedad a nivel de complejo', async () => {
      store.Unit = [
        { id: 'unit-1', complexId: CPX, coefficient: 0.6 },
        { id: 'unit-2', complexId: CPX, coefficient: 0.4 },
      ];
      store.RecurringCharge = [{
        id: 'rc-1', complexId: CPX, isActive: true, billingDay: 5,
        lastBilledPeriod: null, type: RecurringChargeType.INDEFINITE,
        amount: 100, incomeAccountId: 'acc-4225', unitId: null,
        prorateByCoefficient: true, concept: 'Administración', currentInstallment: 0,
      }];

      const res = await service.causeRecurringChargesInternal(CPX, '2025-03', 'sys');

      expect(res.caused).toBe(2);
      expect(res.totalAmount).toBe(100);
      expect(saved.FeeCharge.map((c) => c.amount)).toEqual([60, 40]); // 0.6 / 0.4
    });

    it('reparte en partes iguales si faltan coeficientes (fallback)', async () => {
      store.Unit = [
        { id: 'unit-1', complexId: CPX, coefficient: null },
        { id: 'unit-2', complexId: CPX, coefficient: null },
      ];
      store.RecurringCharge = [{
        id: 'rc-1', complexId: CPX, isActive: true, billingDay: 5,
        lastBilledPeriod: null, type: RecurringChargeType.INDEFINITE,
        amount: 100, incomeAccountId: 'acc-4225', unitId: null,
        prorateByCoefficient: true, concept: 'Administración', currentInstallment: 0,
      }];

      const res = await service.causeRecurringChargesInternal(CPX, '2025-03', 'sys');

      expect(res.caused).toBe(2);
      expect(saved.FeeCharge.map((c) => c.amount)).toEqual([50, 50]);
    });
  });

  // ───────────────────────────────────────────────────────────────────────────
  describe('PUC CRUD — integridad', () => {
    const baseInput = {
      complexId: CPX, code: '413505', name: 'Cuotas administración',
      accountClass: AccountClass.INCOME, nature: AccountNature.CREDIT,
    } as any;

    it('createPucAccount: crea cuenta hoja cuando el código es único', async () => {
      pucRepo.findOne.mockResolvedValue(null); // sin duplicado
      const acc = await service.createPucAccount(baseInput, user);
      expect(acc.code).toBe('413505');
      expect(acc.level).toBe(1);
      expect(acc.isPostable).toBe(true);
      expect(pucRepo.save).toHaveBeenCalled();
    });

    it('createPucAccount: rechaza código duplicado', async () => {
      pucRepo.findOne.mockResolvedValue({ id: 'acc-x', code: '413505', complexId: CPX });
      await expect(service.createPucAccount(baseInput, user)).rejects.toMatchObject({
        errorCode: FinanceErrorCode.PUC_ACCOUNT_CODE_DUPLICATE,
      });
    });

    it('createPucAccount: con padre deriva level y vuelve al padre no-hoja', async () => {
      const parent = { id: 'acc-41', code: '41', complexId: CPX, level: 1, isPostable: true };
      pucRepo.findOne
        .mockResolvedValueOnce(null)      // dup check
        .mockResolvedValueOnce(parent);   // parent lookup
      const acc = await service.createPucAccount({ ...baseInput, parentId: 'acc-41' }, user);
      expect(acc.level).toBe(2);
      // el padre se guardó con isPostable=false
      expect(pucRepo.save).toHaveBeenCalledWith(expect.objectContaining({ id: 'acc-41', isPostable: false }));
    });

    it('updatePucAccount: bloquea cambio de naturaleza si hay movimientos', async () => {
      pucRepo.findOne.mockResolvedValue({ id: 'acc-1', code: '413505', complexId: CPX, nature: AccountNature.CREDIT });
      store.AccountingLine = [{ id: 'l1', pucAccountId: 'acc-1' }];
      await expect(
        service.updatePucAccount({ id: 'acc-1', complexId: CPX, nature: AccountNature.DEBIT } as any, user),
      ).rejects.toMatchObject({ errorCode: FinanceErrorCode.PUC_ACCOUNT_HAS_MOVEMENTS });
    });

    it('togglePucAccount: bloquea desactivar cuenta con movimientos', async () => {
      pucRepo.findOne.mockResolvedValue({ id: 'acc-1', code: '413505', complexId: CPX, isActive: true });
      store.AccountingLine = [{ id: 'l1', pucAccountId: 'acc-1' }];
      await expect(service.togglePucAccount('acc-1', CPX, user)).rejects.toMatchObject({
        errorCode: FinanceErrorCode.PUC_ACCOUNT_HAS_MOVEMENTS,
      });
    });

    it('deletePucAccount: borra cuenta sin dependencias', async () => {
      pucRepo.findOne.mockResolvedValue({ id: 'acc-1', code: '413505', complexId: CPX });
      store.AccountingLine = [];
      pucRepo.count.mockResolvedValue(0);     // sin hijos
      recurringRepo.count.mockResolvedValue(0); // sin recurrentes
      const ok = await service.deletePucAccount('acc-1', CPX, user);
      expect(ok).toBe(true);
      expect(pucRepo.remove).toHaveBeenCalled();
    });

    it('deletePucAccount: bloquea si es cuenta de ingreso de un recurrente', async () => {
      pucRepo.findOne.mockResolvedValue({ id: 'acc-1', code: '413505', complexId: CPX });
      store.AccountingLine = [];
      pucRepo.count.mockResolvedValue(0);
      recurringRepo.count.mockResolvedValue(1); // en uso
      await expect(service.deletePucAccount('acc-1', CPX, user)).rejects.toMatchObject({
        errorCode: FinanceErrorCode.PUC_ACCOUNT_IN_USE,
      });
    });
  });
});
