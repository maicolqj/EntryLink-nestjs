import { Field, Int, ObjectType } from '@nestjs/graphql';

import { ComplexPlan } from '../../../residential-complex/enums/complex-plan.enum';
import { SubscriptionStatus } from '../../enums/subscription-status.enum';
import { SubscriptionPeriod } from '../../entities/subscription-period.entity';

@ObjectType({ description: 'Estado de la suscripción de un complejo' })
export class SubscriptionSummary {
  @Field(() => String)
  complexId: string;

  @Field(() => String)
  complexName: string;

  @Field(() => ComplexPlan)
  plan: ComplexPlan;

  @Field(() => SubscriptionStatus)
  status: SubscriptionStatus;

  @Field(() => Date, { nullable: true })
  endsAt?: Date | null;

  @Field(() => Int, {
    nullable: true,
    description: 'Días para vencer; 0 o negativo si ya venció',
  })
  daysLeft?: number | null;

  @Field(() => Date, {
    nullable: true,
    description: 'Hasta cuándo corre la gracia antes de suspender',
  })
  graceEndsAt?: Date | null;

  @Field(() => SubscriptionPeriod, { nullable: true })
  currentPeriod?: SubscriptionPeriod | null;

  @Field(() => Boolean, { description: 'Si ya usó la prueba gratis' })
  trialUsed: boolean;

  @Field(() => [SubscriptionPeriod], {
    description: 'Historial, el más reciente primero',
  })
  periods: SubscriptionPeriod[];
}
