import { ObjectType, Field, Float } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';

@ObjectType()
export class WalletEntryObject {

  @Field()
  id: string;

  @Field()
  type: string;  // 'CREDIT' | 'DEBIT' | 'ADJUSTMENT'

  @Field(() => Float)
  amount: number;

  @Field()
  description: string;

  @Field()
  unitId: string;

  @Field({ nullable: true })
  chargeId?: string;

  @Field()
  createdAt: string;  // ISO string
}

@ObjectType()
export class UnitWalletResponse {

  @Field()
  unitId: string;

  @Field()
  unitNumber: string;

  @Field({ nullable: true })
  building?: string;

  @Field(() => Float)
  currentBalance: number;

  @Field(() => Float)
  totalCredits: number;

  @Field(() => Float)
  totalDebits: number;

  @Field(() => [WalletEntryObject])
  entries: WalletEntryObject[];
}

@ObjectType()
export class WalletSummaryItem {

  @Field()
  unitId: string;

  @Field()
  unitNumber: string;

  @Field({ nullable: true })
  building?: string;

  @Field(() => Float)
  currentBalance: number;

  @Field(() => Float)
  totalCredits: number;

  @Field(() => Float)
  totalDebits: number;
}

@ObjectType()
export class WalletSummaryPaginated {

  @Field(() => [WalletSummaryItem])
  items: WalletSummaryItem[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

@ObjectType()
export class ApplyWalletResult {

  @Field()
  chargeId: string;

  @Field(() => Float)
  appliedAmount: number;

  @Field(() => Float)
  remainingWalletBalance: number;

  @Field()
  chargeStatus: string;
}
