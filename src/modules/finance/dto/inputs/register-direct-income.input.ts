import { InputType, Field, Float } from '@nestjs/graphql';
import { IsUUID, IsPositive, IsNotEmpty, IsOptional, IsUrl, MaxLength, Matches, IsEnum, IsDate } from 'class-validator';
import { IncomeCategory } from '../../enums/income-category.enum';

@InputType()
export class RegisterDirectIncomeInput {

  @Field()
  @IsUUID()
  complexId: string;

  @Field(() => Float)
  @IsPositive()
  amount: number;

  @Field()
  @IsNotEmpty()
  @MaxLength(500)
  description: string;

  @Field(() => IncomeCategory)
  @IsEnum(IncomeCategory)
  category: IncomeCategory;

  /** Período contable YYYY-MM */
  @Field()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'El período debe tener el formato YYYY-MM' })
  period: string;

  /** Fecha real del ingreso */
  @Field(() => Date)
  @IsDate()
  incomeDate: Date;

  @Field({ nullable: true })
  @IsOptional()
  @IsUrl()
  @MaxLength(2048)
  receiptUrl?: string;

  @Field({ nullable: true })
  @IsOptional()
  @MaxLength(1000)
  notes?: string;
}
