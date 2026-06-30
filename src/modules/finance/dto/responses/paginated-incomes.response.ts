import { ObjectType, Field, Float } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { DirectIncome }     from '../../entities/direct-income.entity';
import { IncomeCategory }    from '../../enums/income-category.enum';

@ObjectType()
export class IncomeCategoryBreakdown {
  @Field(() => IncomeCategory)
  category: IncomeCategory;

  @Field(() => Float)
  total: number;

  @Field()
  count: number;
}

@ObjectType()
export class PaginatedIncomesResponse {

  @Field(() => [DirectIncome])
  items: DirectIncome[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;

  /** Suma de los ingresos activos en el resultado actual (no revertidos) */
  @Field(() => Float)
  totalAmount: number;

  /** Desglose por categoría del conjunto retornado */
  @Field(() => [IncomeCategoryBreakdown])
  byCategory: IncomeCategoryBreakdown[];
}
