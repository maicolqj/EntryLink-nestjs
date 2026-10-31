import {
  GrowthInterestSignal,
  GrowthScoreBasis,
  GrowthScoringPredicate as Pred,
} from '../prospects.enums';

/** Hechos de un prospecto que pueden evaluar las reglas. */
export interface ProspectFacts {
  properties: { value: number; basis: GrowthScoreBasis };
  units: { value: number; basis: GrowthScoreBasis };
  verifiedChannel: boolean;
  interestSignal: { value: GrowthInterestSignal; basis: GrowthScoreBasis };
}

export interface RuleLike {
  predicate: Pred;
  params: Record<string, unknown>;
}

const int = (v: unknown): v is number =>
  typeof v === 'number' && Number.isInteger(v) && v >= 0;

/**
 * Valida los parámetros de una regla según su predicado. Devuelve el motivo
 * del error o null si son válidos. Las reglas nunca evalúan expresiones
 * libres: solo estos predicados con estos parámetros.
 */
export function validateRuleParams(rule: RuleLike): string | null {
  const p = rule.params ?? {};
  const keys = Object.keys(p).sort().join(',');
  switch (rule.predicate) {
    case Pred.PROPERTIES_GTE:
      return keys === 'min' && int(p.min)
        ? null
        : 'Requiere { min: entero ≥ 0 }';
    case Pred.PROPERTIES_BETWEEN:
      return keys === 'max,min' && int(p.min) && int(p.max) && p.min <= p.max
        ? null
        : 'Requiere { min, max: enteros ≥ 0, min ≤ max }';
    case Pred.UNITS_GT:
      return keys === 'value' && int(p.value)
        ? null
        : 'Requiere { value: entero ≥ 0 }';
    case Pred.VERIFIED_CHANNEL:
      return keys === '' ? null : 'No lleva parámetros';
    case Pred.INTEREST_SIGNAL_IN: {
      const values = p.values;
      const valid =
        keys === 'values' &&
        Array.isArray(values) &&
        values.length > 0 &&
        values.every((v) =>
          Object.values(GrowthInterestSignal).includes(
            v as GrowthInterestSignal,
          ),
        );
      return valid
        ? null
        : 'Requiere { values: [NONE | EXPRESSED | DEMO_REQUESTED] }';
    }
    default:
      return 'Predicado desconocido';
  }
}

/**
 * Evalúa una regla. Devuelve null si no aplica, o la base (verificado o
 * estimado) y el valor evaluado si aplica.
 */
export function evaluateRule(
  rule: RuleLike,
  facts: ProspectFacts,
): { basis: GrowthScoreBasis; value: string } | null {
  const p = rule.params;
  switch (rule.predicate) {
    case Pred.PROPERTIES_GTE:
      return facts.properties.value >= (p.min as number)
        ? {
            basis: facts.properties.basis,
            value: String(facts.properties.value),
          }
        : null;
    case Pred.PROPERTIES_BETWEEN:
      return facts.properties.value >= (p.min as number) &&
        facts.properties.value <= (p.max as number)
        ? {
            basis: facts.properties.basis,
            value: String(facts.properties.value),
          }
        : null;
    case Pred.UNITS_GT:
      return facts.units.value > (p.value as number)
        ? { basis: facts.units.basis, value: String(facts.units.value) }
        : null;
    case Pred.VERIFIED_CHANNEL:
      return facts.verifiedChannel
        ? { basis: GrowthScoreBasis.VERIFIED, value: 'sí' }
        : null;
    case Pred.INTEREST_SIGNAL_IN:
      return (p.values as string[]).includes(facts.interestSignal.value)
        ? {
            basis: facts.interestSignal.basis,
            value: facts.interestSignal.value,
          }
        : null;
    default:
      return null;
  }
}
