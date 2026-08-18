import { FinanceService } from './finance.service';
import { FeeConfigBillingMode } from '../enums/fee-config-billing-mode.enum';

/**
 * Specs de los helpers puros de fechas. Son la base de toda la regla de
 * vencimiento, así que se prueban sin levantar el grafo de dependencias del
 * service: `Object.create` da una instancia con los métodos del prototipo y sin
 * constructor, que es todo lo que estos helpers necesitan.
 */
describe('FinanceService — fechas de vencimiento', () => {
  const service = Object.create(FinanceService.prototype) as any;

  const dueDate = (period: string, mode?: FeeConfigBillingMode): Date =>
    service.buildDueDate(period, mode);

  describe('buildDueDate', () => {
    it('ADVANCE (default): último instante del mismo período', () => {
      const d = dueDate('2026-07');
      expect(d.getFullYear()).toBe(2026);
      expect(d.getMonth()).toBe(6);   // julio
      expect(d.getDate()).toBe(31);
      expect(d.getHours()).toBe(23);
      expect(d.getMinutes()).toBe(59);
      expect(d.getSeconds()).toBe(59);
    });

    it('ARREARS: último instante del mes siguiente', () => {
      const d = dueDate('2026-07', FeeConfigBillingMode.ARREARS);
      expect(d.getMonth()).toBe(7);   // agosto
      expect(d.getDate()).toBe(31);
    });

    it('ARREARS en diciembre rueda al año siguiente', () => {
      const d = dueDate('2026-12', FeeConfigBillingMode.ARREARS);
      expect(d.getFullYear()).toBe(2027);
      expect(d.getMonth()).toBe(0);
      expect(d.getDate()).toBe(31);
    });

    it('respeta meses cortos', () => {
      expect(dueDate('2026-02').getDate()).toBe(28);
      expect(dueDate('2026-04').getDate()).toBe(30);
    });

    it('el cargo no está vencido durante su propio último día', () => {
      const d = dueDate('2026-07');
      expect(d < new Date(2026, 6, 31, 12, 0, 0)).toBe(false);
      expect(d < new Date(2026, 7, 1, 0, 0, 0)).toBe(true);
    });
  });

  describe('buildPeriodDayDate — corte de pronto pago', () => {
    it('cae en el día configurado, al final del día', () => {
      const d = service.buildPeriodDayDate('2026-07', 10);
      expect(d.getMonth()).toBe(6);
      expect(d.getDate()).toBe(10);
      expect(d.getHours()).toBe(23);
    });

    it('el descuento vale durante todo el día del corte', () => {
      const d = service.buildPeriodDayDate('2026-07', 10);
      expect(d > new Date(2026, 6, 10, 18, 0, 0)).toBe(true);   // el 10 aún aplica
      expect(d < new Date(2026, 6, 11, 0, 0, 1)).toBe(true);    // el 11 ya no
    });

    it('un día mayor al último del mes se recorta', () => {
      expect(service.buildPeriodDayDate('2026-02', 31).getDate()).toBe(28);
    });

    it('nunca adelanta el vencimiento del cargo', () => {
      const corte = service.buildPeriodDayDate('2026-07', 10);
      expect(corte < dueDate('2026-07')).toBe(true);
    });
  });

  describe('nextPeriod', () => {
    it('avanza un mes', () => {
      expect(service.nextPeriod('2026-07')).toBe('2026-08');
    });

    it('cruza el fin de año', () => {
      expect(service.nextPeriod('2026-12')).toBe('2027-01');
    });

    it('mantiene el padding de dos dígitos', () => {
      expect(service.nextPeriod('2026-08')).toBe('2026-09');
    });
  });

  describe('nota de mora', () => {
    it('vence el último día del mes en que se emite, no N días después', () => {
      // La nota se emite con period = mes en curso y usa el mismo helper que
      // cualquier cargo, así que nunca vence antes que la cuota que la originó.
      const notaDeMora = dueDate('2026-08');
      const cuotaDeAgosto = dueDate('2026-08');
      expect(notaDeMora.getTime()).toBe(cuotaDeAgosto.getTime());
      expect(notaDeMora.getDate()).toBe(31);
    });
  });
});
