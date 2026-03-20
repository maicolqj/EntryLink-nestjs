import { ObjectType, Field, Float, Int } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';

@ObjectType()
export class UnitFinancialStatusItem {

  @Field()
  unitId: string;

  @Field()
  unitNumber: string;

  @Field({ nullable: true })
  building?: string;

  /** 'UP_TO_DATE' | 'OVERDUE' | 'CREDIT' */
  @Field()
  status: string;

  @Field(() => Float)
  totalDebt: number;

  @Field(() => Float)
  walletBalance: number;

  @Field(() => Int)
  overdueCount: number;

  @Field(() => Int)
  pendingCount: number;
}

@ObjectType()
export class UnitFinancialStatusPaginated {

  @Field(() => [UnitFinancialStatusItem])
  items: UnitFinancialStatusItem[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;
}

@ObjectType()
export class MoraApplicationResult {

  @Field()
  period: string;

  /** Cantidad de cargos de mora creados */
  @Field(() => Int)
  applied: number;

  /** Suma total de mora generada */
  @Field(() => Float)
  totalMoraAmount: number;

  /** Cargos dentro del período de gracia (omitidos) */
  @Field(() => Int)
  skipped: number;
}
