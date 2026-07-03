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

  /**
   * Cartera ACUMULADA: saldo pendiente (amount − paidAmount) de cargos abiertos
   * de TODOS los períodos, no solo el consultado. Es el total adeudado al corte.
   */
  @Field(() => Float)
  totalOutstanding: number;

  /**
   * Cartera del PERÍODO consultado: saldo pendiente de los cargos cuyo `period`
   * es el período de la consulta. Subconjunto de `totalOutstanding`.
   */
  @Field(() => Float)
  periodOutstanding: number;

  /**
   * Interés de mora causado en el período (cargos con prelación INTEREST_MORA),
   * excluye anulados/condonados.
   */
  @Field(() => Float)
  totalMora: number;

  @Field(() => Float)
  collectionRate: number;  // % cobrado vs total emitido

  @Field(() => Int)
  unitsWithDebt: number;

  @Field(() => Int)
  unitsFullyPaid: number;

  /** Suma de gastos operativos del complejo registrados en el período */
  @Field(() => Float)
  totalExpenses: number;

  /** Suma de ingresos directos caja/banco (no-cuota) registrados en el período */
  @Field(() => Float)
  directIncome: number;

  /** Flujo neto = totalCollected + directIncome - totalExpenses */
  @Field(() => Float)
  netCashFlow: number;
}
