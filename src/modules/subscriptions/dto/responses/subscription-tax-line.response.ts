import { Field, Float, ObjectType } from '@nestjs/graphql';

@ObjectType({ description: 'Impuesto aplicado a un cobro' })
export class SubscriptionTaxLine {
  @Field(() => String)
  name: string;

  @Field(() => Float, { description: 'Tarifa en porcentaje (19 = 19 %)' })
  rate: number;

  @Field(() => Float)
  amount: number;
}
