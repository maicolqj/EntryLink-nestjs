import { Injectable } from '@nestjs/common';

import { Unit } from '../../residential-complex/entities/unit.entity';
import { ChargeCalculationMethod } from '../enums/charge-calculation-method.enum';
import { round2 } from '../utils/numeric.transformer';

/** Atributos de Unit habilitados para PER_ATTRIBUTE. */
export const PER_ATTRIBUTE_KEYS = ['parkingSpots', 'storageRooms', 'bedrooms', 'bathrooms'] as const;
export type PerAttributeKey = typeof PER_ATTRIBUTE_KEYS[number];

/** Regla con su target ya resuelto a unidades concretas (el calculador no toca BD). */
export interface ResolvedChargeRule {
  ruleIndex: number;
  calculationMethod: ChargeCalculationMethod;
  units: Unit[];
  amount?: number | null;
  totalAmount?: number | null;
  ratePerSqm?: number | null;
  attributeKey?: string | null;
}

export interface CalculatedLine {
  unitId: string;
  ruleIndex: number;
  amount: number;
}

export interface RuleConflict {
  unitId: string;
  unitNumber: string;
  ruleIndexes: number[];
}

export interface CalculationResult {
  lines: CalculatedLine[];
  /** Unidades cubiertas por más de una regla (solapamiento). */
  conflicts: RuleConflict[];
  /** Unidades del complejo no cubiertas por ninguna regla (warning). */
  uncoveredUnitIds: string[];
  /** Avisos no bloqueantes (ej. unidad sin área/coeficiente omitida). */
  warnings: string[];
  total: number;
}

/**
 * Motor de cálculo PURO de cargos por unidad. No accede a BD: recibe las reglas
 * con sus unidades ya resueltas y devuelve el monto por unidad, los
 * solapamientos y las unidades no cubiertas. Centraliza el redondeo monetario.
 */
@Injectable()
export class ChargeCalculatorService {

  /**
   * @param rules     reglas con `units` ya resueltas.
   * @param allUnits  universo de unidades del complejo (para reportar no cubiertas).
   */
  calculate(rules: ResolvedChargeRule[], allUnits: Unit[]): CalculationResult {
    const warnings: string[] = [];
    const lines: CalculatedLine[] = [];

    // unitId → reglas que lo cubren (para detectar solapamiento)
    const coverage = new Map<string, number[]>();
    for (const rule of rules) {
      for (const unit of rule.units) {
        const arr = coverage.get(unit.id) ?? [];
        arr.push(rule.ruleIndex);
        coverage.set(unit.id, arr);
      }
    }

    const unitById = new Map(allUnits.map(u => [u.id, u]));
    const conflicts: RuleConflict[] = [];
    for (const [unitId, ruleIndexes] of coverage) {
      if (ruleIndexes.length > 1) {
        conflicts.push({
          unitId,
          unitNumber: unitById.get(unitId)?.number ?? unitId,
          ruleIndexes,
        });
      }
    }

    for (const rule of rules) {
      lines.push(...this.calculateRule(rule, warnings));
    }

    const coveredIds = new Set(lines.map(l => l.unitId));
    const uncoveredUnitIds = allUnits.filter(u => !coveredIds.has(u.id)).map(u => u.id);

    const total = round2(lines.reduce((s, l) => s + l.amount, 0));

    return { lines, conflicts, uncoveredUnitIds, warnings, total };
  }

  // ─── Métodos de cálculo por regla ───────────────────────────────

  private calculateRule(rule: ResolvedChargeRule, warnings: string[]): CalculatedLine[] {
    switch (rule.calculationMethod) {
      case ChargeCalculationMethod.FIXED:          return this.fixed(rule);
      case ChargeCalculationMethod.BY_COEFFICIENT: return this.byCoefficient(rule, warnings);
      case ChargeCalculationMethod.BY_AREA:        return this.byArea(rule, warnings);
      case ChargeCalculationMethod.PER_ATTRIBUTE:  return this.perAttribute(rule, warnings);
      default:
        throw new Error(`Método de cálculo no soportado: ${rule.calculationMethod}`);
    }
  }

  /** FIXED: cada unidad del target recibe `amount`. */
  private fixed(rule: ResolvedChargeRule): CalculatedLine[] {
    const amount = round2(Number(rule.amount ?? 0));
    return rule.units.map(u => ({ unitId: u.id, ruleIndex: rule.ruleIndex, amount }));
  }

  /**
   * BY_COEFFICIENT: `totalAmount` prorrateado por coeficiente renormalizado al
   * subgrupo. El residuo de redondeo se asigna a la unidad de MAYOR coeficiente
   * para que la suma cuadre EXACTAMENTE con totalAmount.
   */
  private byCoefficient(rule: ResolvedChargeRule, warnings: string[]): CalculatedLine[] {
    const total = Number(rule.totalAmount ?? 0);
    const units = rule.units.filter(u => u.coefficient != null && Number(u.coefficient) > 0);

    if (units.length === 0) {
      warnings.push(`Regla #${rule.ruleIndex} (BY_COEFFICIENT): ninguna unidad del target tiene coeficiente > 0; omitida.`);
      return [];
    }
    if (units.length < rule.units.length) {
      warnings.push(
        `Regla #${rule.ruleIndex} (BY_COEFFICIENT): ${rule.units.length - units.length} unidad(es) sin coeficiente excluidas del prorrateo.`,
      );
    }

    const totalCoef = units.reduce((s, u) => s + Number(u.coefficient), 0);

    // Unidad de mayor coeficiente recibe el residuo de redondeo.
    let maxIdx = 0;
    for (let i = 1; i < units.length; i++) {
      if (Number(units[i].coefficient) > Number(units[maxIdx].coefficient)) maxIdx = i;
    }

    const lines: CalculatedLine[] = [];
    let distributed = 0;
    units.forEach((u, i) => {
      if (i === maxIdx) return; // se calcula al final con el residuo
      const amount = round2(total * Number(u.coefficient) / totalCoef);
      distributed = round2(distributed + amount);
      lines.push({ unitId: u.id, ruleIndex: rule.ruleIndex, amount });
    });

    const maxUnit = units[maxIdx];
    lines.push({
      unitId: maxUnit.id,
      ruleIndex: rule.ruleIndex,
      amount: round2(total - distributed),
    });

    return lines;
  }

  /** BY_AREA: monto = area × ratePerSqm. Omite unidades sin área. */
  private byArea(rule: ResolvedChargeRule, warnings: string[]): CalculatedLine[] {
    const rate = Number(rule.ratePerSqm ?? 0);
    const lines: CalculatedLine[] = [];
    let skipped = 0;

    for (const u of rule.units) {
      if (u.area == null || Number(u.area) <= 0) { skipped++; continue; }
      lines.push({
        unitId: u.id,
        ruleIndex: rule.ruleIndex,
        amount: round2(Number(u.area) * rate),
      });
    }

    if (skipped > 0) {
      warnings.push(`Regla #${rule.ruleIndex} (BY_AREA): ${skipped} unidad(es) sin área fueron omitidas.`);
    }
    return lines;
  }

  /** PER_ATTRIBUTE: monto = (unidad[attributeKey] ?? 0) × amount. Solo genera línea si > 0. */
  private perAttribute(rule: ResolvedChargeRule, warnings: string[]): CalculatedLine[] {
    const key = rule.attributeKey as PerAttributeKey;
    if (!PER_ATTRIBUTE_KEYS.includes(key)) {
      throw new Error(
        `attributeKey inválido "${rule.attributeKey}". Permitidos: ${PER_ATTRIBUTE_KEYS.join(', ')}`,
      );
    }
    const unitAmount = Number(rule.amount ?? 0);
    const lines: CalculatedLine[] = [];

    for (const u of rule.units) {
      const qty = Number((u as any)[key] ?? 0);
      if (qty <= 0) continue;
      lines.push({
        unitId: u.id,
        ruleIndex: rule.ruleIndex,
        amount: round2(qty * unitAmount),
      });
    }
    return lines;
  }
}
