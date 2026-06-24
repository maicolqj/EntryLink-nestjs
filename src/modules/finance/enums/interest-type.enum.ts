import { registerEnumType } from '@nestjs/graphql';

/** Tipo de tasa de interés de mora configurada por la copropiedad. */
export enum InterestType {
  NOMINAL_MONTHLY  = 'nominal_monthly',
  EFFECTIVE_ANNUAL = 'effective_annual',
}

registerEnumType(InterestType, {
  name: 'InterestType',
  description: 'Tipo de tasa de interés de mora',
});
