import { Field, Float, ObjectType } from '@nestjs/graphql';

import { SubscriptionTaxKind } from '../../enums/subscription-tax-kind.enum';

@ObjectType({ description: 'Impuesto aplicado a un cobro' })
export class SubscriptionTaxLine {
  @Field(() => String)
  name: string;

  @Field(() => Float, { description: 'Tarifa en porcentaje (19 = 19 %)' })
  rate: number;

  @Field(() => SubscriptionTaxKind, {
    description: 'CHARGE se sumó al cobro; WITHHOLDING lo retuvo el conjunto',
  })
  kind: SubscriptionTaxKind;

  @Field(() => Float)
  amount: number;
}
