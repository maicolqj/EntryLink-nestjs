import { ObjectType, Field, Float, Int } from '@nestjs/graphql';

@ObjectType()
export class UnitBalanceResponse {

  @Field()
  unitId: string;

  @Field()
  unitNumber: string;

  /** Deuda total pendiente (PENDING + OVERDUE + PARTIALLY_PAID) */
  @Field(() => Float)
  totalDebt: number;

  /** Cuántos cargos están vencidos */
  @Field(() => Int)
  overdueCount: number;

  /** Cuántos cargos están pendientes (no vencidos aún) */
  @Field(() => Int)
  pendingCount: number;

  /** Total pagado en el período consultado */
  @Field(() => Float)
  totalPaid: number;
}

@ObjectType()
export class ComplexFinancialSummaryResponse {

  @Field()
  complexId: string;

  @Field()
  period: string;

  @Field(() => Float)
  totalCharged: number;

  @Field(() => Float)
  totalCollected: number;

  @Field(() => Float)
  totalOutstanding: number;

  @Field(() => Float)
  collectionRate: number;  // % cobrado vs total emitido

  @Field(() => Int)
  unitsWithDebt: number;

  @Field(() => Int)
  unitsFullyPaid: number;

  /** Suma de gastos operativos del complejo registrados en el período */
  @Field(() => Float)
  totalExpenses: number;

  /** Flujo neto = totalCollected - totalExpenses */
  @Field(() => Float)
  netCashFlow: number;
}
