import { ObjectType, Field, Float } from '@nestjs/graphql';
import { PaginationReponse } from '../../../shared/dto/responses/pagination-object.response';
import { ComplexExpense }    from '../../entities/complex-expense.entity';
import { ExpenseCategory }   from '../../enums/expense-category.enum';

@ObjectType()
export class ExpenseCategoryBreakdown {
  @Field(() => ExpenseCategory)
  category: ExpenseCategory;

  @Field(() => Float)
  total: number;

  @Field()
  count: number;
}

@ObjectType()
export class PaginatedExpensesResponse {

  @Field(() => [ComplexExpense])
  items: ComplexExpense[];

  @Field(() => PaginationReponse)
  pagination: PaginationReponse;

  /** Suma de los gastos activos en el resultado actual (no revertidos) */
  @Field(() => Float)
  totalAmount: number;

  /** Desglose por categoría del conjunto retornado */
  @Field(() => [ExpenseCategoryBreakdown])
  byCategory: ExpenseCategoryBreakdown[];
}
