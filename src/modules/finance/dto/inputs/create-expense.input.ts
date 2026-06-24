import { InputType, Field, Float } from '@nestjs/graphql';
import {
  IsUUID, IsPositive, IsNotEmpty, IsOptional, IsString,
  MaxLength, Matches, ValidateNested, ArrayMinSize, IsArray, IsDate,
} from 'class-validator';
import { Type } from 'class-transformer';

/** Una línea de gasto del comprobante de egreso (se DEBITA). */
@InputType()
export class ExpenseLineInput {

  /** Cuenta de gasto / CxP a DEBITAR (PUC clase 5, o pasivo 2335). */
  @Field()
  @IsUUID()
  pucAccountId: string;

  @Field(() => Float)
  @IsPositive()
  amount: number;

  /** Justificación contable de ESTA línea (obligatoria en egresos). */
  @Field()
  @IsNotEmpty()
  @IsString()
  @MaxLength(1000)
  memo: string;

  /** Unidad afectada si el gasto es imputable a una unidad. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  unitId?: string;
}

@InputType()
export class CreateExpenseInput {

  @Field()
  @IsUUID()
  complexId: string;

  @Field(() => Date)
  @IsDate()
  documentDate: Date;

  /** Período contable YYYY-MM */
  @Field()
  @Matches(/^\d{4}-(0[1-9]|1[0-2])$/, { message: 'El período debe tener el formato YYYY-MM' })
  period: string;

  /** Justificación a nivel de CABECERA del documento. */
  @Field()
  @IsNotEmpty()
  @MaxLength(1000)
  memo: string;

  /** Cuenta de Caja/Banco a ACREDITAR (sale el dinero). PUC 1105/1110. */
  @Field()
  @IsUUID()
  paymentAccountId: string;

  @Field({ nullable: true })
  @IsOptional()
  @MaxLength(200)
  thirdPartyName?: string;

  @Field(() => [ExpenseLineInput])
  @IsArray()
  @ArrayMinSize(1)
  @ValidateNested({ each: true })
  @Type(() => ExpenseLineInput)
  lines: ExpenseLineInput[];
}
