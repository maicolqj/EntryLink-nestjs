import { GrowthIdentifierType } from '../../shared/growth.enums';
import { normalizeIdentifier } from '../../shared/identifier-normalizer';
import { maskEmail, maskPhone } from '../../prospects/shared/masking';

/**
 * Una celda que empieza por = + - @ (o tab / retorno) se interpretaría como
 * fórmula al abrir el informe en Excel: se antepone un apóstrofo.
 */
export function neutralizeFormula(value: string): string {
  return /^[=+\-@\t\r]/.test(value) ? `'${value}` : value;
}

/**
 * Enmascara en una fila cruda lo que parezca correo o teléfono, para quien
 * no tiene VIEW_GROWTH_CONTACT_DATA. Se mira el valor, no el mapeo: el
 * archivo puede traer datos de contacto en columnas sin asignar.
 */
export function maskRawRow(values: string[]): string[] {
  return values.map((v) => {
    if (!v) return v;
    if (normalizeIdentifier(GrowthIdentifierType.EMAIL, v)) return maskEmail(v);
    if (normalizeIdentifier(GrowthIdentifierType.PHONE, v)) return maskPhone(v);
    return v;
  });
}

export interface ReportRow {
  rowNumber: number;
  decision: string | null;
  result: string | null;
  issues: string;
  raw: string[];
}

export interface ReportSummary {
  label: string;
  value: string | number;
}

/** Informe XLSX: hoja Resumen y hoja Filas, con celdas neutralizadas. */
export async function buildImportReport(
  headers: string[],
  summary: ReportSummary[],
  rows: ReportRow[],
): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  const resumen = workbook.addWorksheet('Resumen');
  resumen.columns = [
    { header: 'Concepto', key: 'label', width: 36 },
    { header: 'Valor', key: 'value', width: 40 },
  ];
  for (const s of summary) {
    resumen.addRow({
      label: neutralizeFormula(s.label),
      value: typeof s.value === 'number' ? s.value : neutralizeFormula(s.value),
    });
  }

  const filas = workbook.addWorksheet('Filas');
  filas.addRow(
    ['Fila', 'Decisión', 'Resultado', 'Errores y avisos', ...headers].map(
      neutralizeFormula,
    ),
  );
  for (const r of rows) {
    filas.addRow([
      r.rowNumber,
      ...[r.decision ?? '', r.result ?? '', r.issues, ...r.raw].map(
        neutralizeFormula,
      ),
    ]);
  }
  filas.getRow(1).font = { bold: true };
  resumen.getRow(1).font = { bold: true };
  return Buffer.from(await workbook.xlsx.writeBuffer());
}
