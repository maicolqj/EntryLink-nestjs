import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class AccountMovement {

  @Field()
  id: string;

  @Field()
  date: string;  // ISO string

  /** 'CHARGE' | 'PAYMENT' | 'CREDIT' | 'DEBIT' | 'MORA' */
  @Field()
  type: string;

  @Field()
  description: string;

  /** Monto que aumenta la deuda (0 si no aplica) */
  @Field(() => Float)
  debit: number;

  /** Monto que reduce la deuda (0 si no aplica) */
  @Field(() => Float)
  credit: number;

  /** Saldo acumulado en ese momento (positivo = debe, negativo = a favor) */
  @Field(() => Float)
  balance: number;

  @Field({ nullable: true })
  reference?: string;
}

@ObjectType()
export class UnitAccountStatementResponse {

  @Field()
  unitId: string;

  @Field()
  unitNumber: string;

  @Field({ nullable: true })
  building?: string;

  @Field(() => Float)
  totalDebits: number;

  @Field(() => Float)
  totalCredits: number;

  /** Saldo deudor actual (charges - payments) */
  @Field(() => Float)
  currentBalance: number;

  /** Saldo a favor disponible en wallet */
  @Field(() => Float)
  walletBalance: number;

  @Field(() => [AccountMovement])
  movements: AccountMovement[];

  /** Conteo total de movimientos del período, independiente de limit/offset */
  @Field(() => Int)
  totalMovements: number;

  /** true cuando quedan más páginas: offset + movimientos devueltos < totalMovements */
  @Field(() => Boolean)
  hasMore: boolean;
}
