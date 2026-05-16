import { InputType, Field } from '@nestjs/graphql';
import { IsOptional, Matches } from 'class-validator';
import { ExpenseCategory } from '../../enums/expense-category.enum';

@InputType()
export class FilterExpensesInput {

  @Field(() => ExpenseCategory, { nullable: true })
  @IsOptional()
  category?: ExpenseCategory;

  /** Filtrar por período YYYY-MM */
  @Field({ nullable: true })
  @IsOptional()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'El período debe tener el formato YYYY-MM' })
  period?: string;

  /** Fecha inicio del rango (inclusiva). Si se usa junto con period, se ignora. */
  @Field(() => Date, { nullable: true })
  @IsOptional()
  startDate?: Date;

  /** Fecha fin del rango (inclusiva). Si se usa junto con period, se ignora. */
  @Field(() => Date, { nullable: true })
  @IsOptional()
  endDate?: Date;

  /** Incluir gastos revertidos (por defecto: false) */
  @Field({ nullable: true })
  @IsOptional()
  includeReversed?: boolean;
}
