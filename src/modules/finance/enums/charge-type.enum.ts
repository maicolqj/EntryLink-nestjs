import { registerEnumType } from '@nestjs/graphql';

export enum ChargeType {
  MONTHLY = 'MONTHLY',  // Recurrente indefinido (mes a mes)
  ONCE    = 'ONCE',     // Cobro único, se genera una sola vez
  LIMITED = 'LIMITED',  // Recurrente por un número fijo de cuotas
}

registerEnumType(ChargeType, {
  name: 'ChargeType',
  description: 'Tipo de recurrencia de la configuración de cuota',
  valuesMap: {
    MONTHLY: { description: 'Recurrente indefinido (mes a mes hasta cancelación manual)' },
    ONCE:    { description: 'Cobro único, se genera una sola vez' },
    LIMITED: { description: 'Recurrente por un número fijo de cuotas' },
  },
});
