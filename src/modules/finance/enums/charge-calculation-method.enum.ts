import { registerEnumType } from '@nestjs/graphql';

/**
 * Método de cálculo del monto por unidad dentro de una regla de emisión.
 *
 *  - FIXED:         cada unidad del target recibe `amount`.
 *  - BY_COEFFICIENT: `totalAmount` se prorratea por el coeficiente de copropiedad
 *                    del subgrupo (renormalizado); el residuo de redondeo se asigna
 *                    a la unidad de MAYOR coeficiente para cuadrar exacto.
 *  - BY_AREA:        monto = area (m²) × `ratePerSqm`.
 *  - PER_ATTRIBUTE:  monto = (atributo[attributeKey] ?? 0) × `amount`.
 */
export enum ChargeCalculationMethod {
  FIXED          = 'FIXED',
  BY_COEFFICIENT = 'BY_COEFFICIENT',
  BY_AREA        = 'BY_AREA',
  PER_ATTRIBUTE  = 'PER_ATTRIBUTE',
}

registerEnumType(ChargeCalculationMethod, {
  name: 'ChargeCalculationMethod',
  description: 'Método de cálculo del monto por unidad en una regla de emisión',
});
