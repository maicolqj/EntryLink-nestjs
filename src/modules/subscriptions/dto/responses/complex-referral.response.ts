import { Field, ID, Int, ObjectType } from '@nestjs/graphql';

import { ComplexStatus } from '../../../residential-complex/enums/complex-status.enum';

@ObjectType({ description: 'Conjunto que llegó por una recomendación' })
export class ReferredComplex {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => ComplexStatus)
  status: ComplexStatus;

  @Field(() => Date, { description: 'Cuándo se registró' })
  registeredAt: Date;

  @Field(() => Date, {
    nullable: true,
    description:
      'Cuándo se otorgó la cortesía por esta recomendación. Vacío = aún no hace su primer pago.',
  })
  rewardedAt?: Date | null;
}

@ObjectType({
  description: 'Código de recomendación de un conjunto y lo que ha traído',
})
export class ComplexReferralSummary {
  @Field(() => String, {
    description: 'Código que el conjunto comparte para recomendarnos',
  })
  code: string;

  @Field(() => Int, {
    description:
      'Días gratis que recibe por cada conjunto recomendado que hace su primer pago',
  })
  rewardDays: number;

  @Field(() => ReferredComplex, {
    nullable: true,
    description: 'Conjunto que recomendó a este',
  })
  referredBy?: ReferredComplex | null;

  @Field(() => [ReferredComplex], {
    description: 'Conjuntos que se registraron con su código',
  })
  referrals: ReferredComplex[];
}
