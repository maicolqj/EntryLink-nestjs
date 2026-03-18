import { registerEnumType } from '@nestjs/graphql';

export enum ComplexPlan {
  FREE       = 'FREE',       // Gratis: hasta 10 unidades
  BASIC      = 'BASIC',      // Básico: hasta 50 unidades
  PRO        = 'PRO',        // Pro: hasta 200 unidades
  ENTERPRISE = 'ENTERPRISE', // Ilimitado + soporte dedicado
}

registerEnumType(ComplexPlan, {
  name: 'ComplexPlan',
  description: 'Plan de suscripción del complejo residencial',
  valuesMap: {
    FREE:       { description: 'Gratuito, hasta 10 unidades' },
    BASIC:      { description: 'Básico, hasta 50 unidades' },
    PRO:        { description: 'Pro, hasta 200 unidades' },
    ENTERPRISE: { description: 'Enterprise, ilimitado' },
  },
});
