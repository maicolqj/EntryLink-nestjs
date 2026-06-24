import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class PrepaidApplicationItem {

  @Field()
  unitId: string;

  @Field(() => Float)
  appliedAmount: number;

  @Field(() => Float)
  remainingPrepaid: number;

  @Field(() => Float)
  remainingDebt: number;

  /** Header de la nota contable generada (null si dryRun o sin aplicación). */
  @Field(() => String, { nullable: true })
  accountingHeaderId?: string;
}

@ObjectType()
export class PrepaidApplicationResult {

  @Field(() => Int)
  unitsProcessed: number;

  @Field(() => Float)
  totalApplied: number;

  @Field()
  dryRun: boolean;

  @Field(() => [PrepaidApplicationItem])
  items: PrepaidApplicationItem[];
}
