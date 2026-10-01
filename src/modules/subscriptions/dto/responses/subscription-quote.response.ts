import { Field, Float, Int, ObjectType } from '@nestjs/graphql';

import { ComplexPlan } from '../../../residential-complex/enums/complex-plan.enum';
import { BillingCycle } from '../../enums/billing-cycle.enum';
import { SubscriptionPricingMode } from '../../enums/subscription-pricing-mode.enum';
import { SubscriptionTaxLine } from './subscription-tax-line.response';

@ObjectType({ description: 'Valor a cobrar al conjunto, con su desglose' })
export class SubscriptionQuote {
  @Field(() => Boolean, {
    description: 'false si falta configurar el precio: no hay valor que cobrar',
  })
  configured: boolean;

  @Field(() => SubscriptionPricingMode)
  pricingMode: SubscriptionPricingMode;

  @Field(() => ComplexPlan)
  plan: ComplexPlan;

  @Field(() => BillingCycle)
  cycle: BillingCycle;

  @Field(() => Int, { description: 'Unidades que se cobran (por unidad)' })
  unitCount: number;

  @Field(() => String, {
    description:
      'De dónde salen las unidades: REGISTERED (registradas) o DECLARED (declaradas al inscribirse)',
  })
  unitCountSource: 'REGISTERED' | 'DECLARED';

  @Field(() => Float, {
    nullable: true,
    description: 'Valor por unidad o valor fijo mensual configurado',
  })
  price?: number | null;

  @Field(() => Float, { description: 'Valor de un mes antes de impuestos' })
  monthlySubtotal: number;

  @Field(() => Int, { description: 'Meses que se cobran (anual = 10)' })
  monthsCharged: number;

  @Field(() => Float)
  subtotal: number;

  @Field(() => [SubscriptionTaxLine])
  taxes: SubscriptionTaxLine[];

  @Field(() => Float)
  taxAmount: number;

  @Field(() => Float, { description: 'Total a pagar, impuestos incluidos' })
  total: number;
}
