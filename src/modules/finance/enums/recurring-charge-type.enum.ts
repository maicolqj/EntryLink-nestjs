import { registerEnumType } from '@nestjs/graphql';

/** Modalidad de un cobro recurrente programado. */
export enum RecurringChargeType {
  INDEFINITE = 'indefinite', // cuota ordinaria sin fin (mes a mes)
  DEFERRED   = 'deferred',   // diferido en N cuotas (extraordinaria a plazos)
  ONE_TIME   = 'one_time',   // cobro único
}

registerEnumType(RecurringChargeType, {
  name: 'RecurringChargeType',
  description: 'Modalidad de recurrencia de un cobro programado',
});
