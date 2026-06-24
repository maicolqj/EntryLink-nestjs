import { registerEnumType } from '@nestjs/graphql';

/**
 * Concepto contable del cargo para la PRELACIÓN DE PAGOS (Ley 675).
 * El orden legal de imputación de un abono es:
 *   1. Intereses de mora → 2. Multas/otros → 3. Cuota extraordinaria → 4. Cuota ordinaria.
 */
export enum PrelacionConcept {
  INTEREST_MORA = 'INTEREST_MORA', // 1. intereses de mora
  FINE          = 'FINE',          // 2. multas y otros
  EXTRAORDINARY = 'EXTRAORDINARY', // 3. cuota extraordinaria
  ORDINARY      = 'ORDINARY',      // 4. cuota ordinaria (administración)
}

registerEnumType(PrelacionConcept, {
  name: 'PrelacionConcept',
  description: 'Concepto del cargo para la prelación legal de imputación de pagos',
});

/** Peso de prelación: menor número = se paga primero. */
export const PRELACION_ORDER: Record<PrelacionConcept, number> = {
  [PrelacionConcept.INTEREST_MORA]: 0,
  [PrelacionConcept.FINE]:          1,
  [PrelacionConcept.EXTRAORDINARY]: 2,
  [PrelacionConcept.ORDINARY]:      3,
};

/** Compara dos cargos por prelación: concepto, luego período más antiguo, luego antigüedad. */
export function comparePrelacion(
  a: { prelacionConcept: PrelacionConcept; period: string; createdAt: Date },
  b: { prelacionConcept: PrelacionConcept; period: string; createdAt: Date },
): number {
  const byConcept = PRELACION_ORDER[a.prelacionConcept] - PRELACION_ORDER[b.prelacionConcept];
  if (byConcept !== 0) return byConcept;
  if (a.period !== b.period) return a.period < b.period ? -1 : 1;
  return a.createdAt.getTime() - b.createdAt.getTime();
}
