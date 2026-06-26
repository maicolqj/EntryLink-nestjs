import { ChargeCalculatorService, ResolvedChargeRule } from './charge-calculator.service';
import { ChargeCalculationMethod } from '../enums/charge-calculation-method.enum';
import { Unit } from '../../residential-complex/entities/unit.entity';

/**
 * Specs del motor de cálculo PURO. Las unidades se construyen como objetos
 * planos (solo se usan los campos id/number/coefficient/area/atributos).
 */
const u = (partial: Partial<Unit> & { id: string }): Unit => ({
  number: partial.id,
  coefficient: undefined,
  area: undefined,
  parkingSpots: 0,
  storageRooms: 0,
  bedrooms: undefined,
  bathrooms: undefined,
  ...partial,
} as unknown as Unit);

describe('ChargeCalculatorService', () => {
  let service: ChargeCalculatorService;

  beforeEach(() => {
    service = new ChargeCalculatorService();
  });

  // ── FIXED ──────────────────────────────────────────────────────
  describe('FIXED', () => {
    it('asigna el mismo monto a cada unidad del target', () => {
      const units = [u({ id: 'A' }), u({ id: 'B' }), u({ id: 'C' })];
      const rule: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.FIXED,
        units,
        amount: 150000,
      };

      const res = service.calculate([rule], units);

      expect(res.lines).toHaveLength(3);
      expect(res.lines.every(l => l.amount === 150000)).toBe(true);
      expect(res.total).toBe(450000);
      expect(res.uncoveredUnitIds).toHaveLength(0);
    });
  });

  // ── BY_COEFFICIENT (reparto + residuo a mayor coeficiente) ──────
  describe('BY_COEFFICIENT', () => {
    it('reparte por coeficiente y la suma cuadra EXACTAMENTE con totalAmount', () => {
      // 3 unidades con coeficientes que fuerzan residuo de redondeo.
      const units = [
        u({ id: 'A', coefficient: 0.333333 }),
        u({ id: 'B', coefficient: 0.333333 }),
        u({ id: 'C', coefficient: 0.333334 }),
      ];
      const rule: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.BY_COEFFICIENT,
        units,
        totalAmount: 1000000,
      };

      const res = service.calculate([rule], units);
      const sum = res.lines.reduce((s, l) => s + l.amount, 0);

      expect(Math.round(sum * 100) / 100).toBe(1000000);
      expect(res.total).toBe(1000000);
      expect(res.lines).toHaveLength(3);
    });

    it('asigna el residuo a la unidad de MAYOR coeficiente', () => {
      const units = [
        u({ id: 'A', coefficient: 0.1 }),
        u({ id: 'B', coefficient: 0.2 }),
        u({ id: 'C', coefficient: 0.7 }), // mayor coeficiente
      ];
      const rule: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.BY_COEFFICIENT,
        units,
        totalAmount: 100,
      };

      const res = service.calculate([rule], units);
      const byId = Object.fromEntries(res.lines.map(l => [l.unitId, l.amount]));

      // A=10, B=20, C=70 → ya cuadra; el residuo (0) recae en C de todos modos.
      expect(byId.A).toBe(10);
      expect(byId.B).toBe(20);
      expect(byId.C).toBe(70);
      expect(byId.A + byId.B + byId.C).toBe(100);
    });

    it('con redondeo, el ajuste recae en la unidad de mayor coeficiente', () => {
      const units = [
        u({ id: 'A', coefficient: 0.16 }),
        u({ id: 'B', coefficient: 0.17 }),
        u({ id: 'C', coefficient: 0.67 }),
      ];
      const rule: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.BY_COEFFICIENT,
        units,
        totalAmount: 33.33,
      };

      const res = service.calculate([rule], units);
      const byId = Object.fromEntries(res.lines.map(l => [l.unitId, l.amount]));
      const sum = byId.A + byId.B + byId.C;

      expect(Math.round(sum * 100) / 100).toBe(33.33);
      // C (mayor coef) absorbe el residuo: total - (A + B)
      expect(byId.C).toBe(Math.round((33.33 - byId.A - byId.B) * 100) / 100);
    });

    it('omite unidades sin coeficiente y avisa', () => {
      const units = [
        u({ id: 'A', coefficient: 0.5 }),
        u({ id: 'B', coefficient: 0.5 }),
        u({ id: 'C' }), // sin coeficiente
      ];
      const rule: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.BY_COEFFICIENT,
        units,
        totalAmount: 500,
      };

      const res = service.calculate([rule], units);

      expect(res.lines).toHaveLength(2);
      expect(res.lines.reduce((s, l) => s + l.amount, 0)).toBe(500);
      expect(res.warnings.some(w => w.includes('sin coeficiente'))).toBe(true);
      expect(res.uncoveredUnitIds).toContain('C');
    });
  });

  // ── BY_AREA ─────────────────────────────────────────────────────
  describe('BY_AREA', () => {
    it('monto = area × ratePerSqm', () => {
      const units = [u({ id: 'A', area: 80 }), u({ id: 'B', area: 120.5 })];
      const rule: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.BY_AREA,
        units,
        ratePerSqm: 2500,
      };

      const res = service.calculate([rule], units);
      const byId = Object.fromEntries(res.lines.map(l => [l.unitId, l.amount]));

      expect(byId.A).toBe(200000);
      expect(byId.B).toBe(301250);
    });

    it('omite unidades sin área y avisa', () => {
      const units = [u({ id: 'A', area: 50 }), u({ id: 'B' })];
      const rule: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.BY_AREA,
        units,
        ratePerSqm: 1000,
      };

      const res = service.calculate([rule], units);

      expect(res.lines).toHaveLength(1);
      expect(res.lines[0].unitId).toBe('A');
      expect(res.warnings.some(w => w.includes('sin área'))).toBe(true);
    });
  });

  // ── PER_ATTRIBUTE ───────────────────────────────────────────────
  describe('PER_ATTRIBUTE', () => {
    it('monto = atributo × amount; solo genera línea si atributo > 0', () => {
      const units = [
        u({ id: 'A', parkingSpots: 2 }),
        u({ id: 'B', parkingSpots: 1 }),
        u({ id: 'C', parkingSpots: 0 }), // no genera línea
      ];
      const rule: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.PER_ATTRIBUTE,
        units,
        attributeKey: 'parkingSpots',
        amount: 50000,
      };

      const res = service.calculate([rule], units);
      const byId = Object.fromEntries(res.lines.map(l => [l.unitId, l.amount]));

      expect(res.lines).toHaveLength(2);
      expect(byId.A).toBe(100000);
      expect(byId.B).toBe(50000);
      expect(byId.C).toBeUndefined();
    });

    it('lanza error si attributeKey no está permitido', () => {
      const units = [u({ id: 'A', parkingSpots: 1 })];
      const rule: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.PER_ATTRIBUTE,
        units,
        attributeKey: 'hackField',
        amount: 1000,
      };

      expect(() => service.calculate([rule], units)).toThrow(/attributeKey inválido/);
    });
  });

  // ── Solapamiento de reglas ──────────────────────────────────────
  describe('detección de solapamiento', () => {
    it('reporta unidades cubiertas por más de una regla', () => {
      const A = u({ id: 'A', number: '101' });
      const B = u({ id: 'B', number: '102' });
      const C = u({ id: 'C', number: '103' });
      const allUnits = [A, B, C];

      const rule1: ResolvedChargeRule = {
        ruleIndex: 0,
        calculationMethod: ChargeCalculationMethod.FIXED,
        units: [A, B],
        amount: 1000,
      };
      const rule2: ResolvedChargeRule = {
        ruleIndex: 1,
        calculationMethod: ChargeCalculationMethod.FIXED,
        units: [B, C], // B solapa
        amount: 2000,
      };

      const res = service.calculate([rule1, rule2], allUnits);

      expect(res.conflicts).toHaveLength(1);
      expect(res.conflicts[0].unitId).toBe('B');
      expect(res.conflicts[0].unitNumber).toBe('102');
      expect(res.conflicts[0].ruleIndexes).toEqual([0, 1]);
    });

    it('sin solapamiento → conflicts vacío', () => {
      const A = u({ id: 'A' });
      const B = u({ id: 'B' });
      const allUnits = [A, B];

      const res = service.calculate([
        { ruleIndex: 0, calculationMethod: ChargeCalculationMethod.FIXED, units: [A], amount: 100 },
        { ruleIndex: 1, calculationMethod: ChargeCalculationMethod.FIXED, units: [B], amount: 200 },
      ], allUnits);

      expect(res.conflicts).toHaveLength(0);
    });
  });

  // ── Unidades no cubiertas ───────────────────────────────────────
  describe('unidades no cubiertas', () => {
    it('reporta las unidades del complejo sin ninguna regla', () => {
      const A = u({ id: 'A' });
      const B = u({ id: 'B' });
      const C = u({ id: 'C' });
      const allUnits = [A, B, C];

      const res = service.calculate([
        { ruleIndex: 0, calculationMethod: ChargeCalculationMethod.FIXED, units: [A], amount: 100 },
      ], allUnits);

      expect(res.uncoveredUnitIds.sort()).toEqual(['B', 'C']);
    });
  });
});
