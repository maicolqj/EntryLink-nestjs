import { registerEnumType } from '@nestjs/graphql';

/**
 * Ciclo de vida de una emisión de cargos.
 *
 *  - DRAFT:     creada con sus reglas; permite previsualizar sin persistir cargos.
 *  - CONFIRMED: los UnitCharge (FeeCharge) ya fueron generados en transacción.
 *  - CANCELLED: descartada antes de confirmar (o anulada manualmente).
 */
export enum ChargeEmissionStatus {
  DRAFT     = 'DRAFT',
  CONFIRMED = 'CONFIRMED',
  CANCELLED = 'CANCELLED',
}

registerEnumType(ChargeEmissionStatus, {
  name: 'ChargeEmissionStatus',
  description: 'Estado de una emisión de cargos',
});
