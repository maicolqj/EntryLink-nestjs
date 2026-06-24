import { ValueTransformer } from 'typeorm';

/**
 * Columnas numeric/int8 → TypeORM las entrega como string para no perder
 * precisión. Este transformer las normaliza a number en JS.
 *
 * Para montos usamos numeric(18,2). Alternativa estricta: int8 en centavos
 * (sustituir el cuerpo por `Number(value)` dividido/multiplicado por 100).
 */
export class ColumnNumericTransformer implements ValueTransformer {
  to(value: number | null): number | null {
    return value;
  }
  from(value: string | null): number | null {
    return value === null || value === undefined ? null : Number(value);
  }
}

export const moneyColumn = new ColumnNumericTransformer();
