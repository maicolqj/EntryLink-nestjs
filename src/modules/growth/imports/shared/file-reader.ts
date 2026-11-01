import { GrowthImportFileKind } from '../imports.enums';

/**
 * Lectura de archivos importados (CSV y XLSX) con límites. Todo es puro:
 * recibe el buffer y devuelve encabezados y filas como texto. Nunca evalúa
 * fórmulas: de una celda con fórmula se toma el valor que Excel guardó.
 */

export const IMPORT_MAX_BYTES = 5 * 1024 * 1024;
export const IMPORT_MAX_ROWS = 5000;
export const IMPORT_MAX_COLUMNS = 100;
export const IMPORT_MAX_CELL_CHARS = 2000;
/**
 * Tope de texto de todo el lote. Un XLSX puede repetir una cadena compartida
 * en miles de celdas: 68 KB de archivo llegaron a 60 MB de texto. Sin este
 * tope, el caso extremo ronda 1 GB en la memoria del proceso de la API.
 */
export const IMPORT_MAX_TOTAL_CHARS = 15_000_000;
/** Tope de lo que puede ocupar un XLSX descomprimido (bombas zip). */
export const XLSX_MAX_UNCOMPRESSED = 50 * 1024 * 1024;
export const XLSX_MAX_ENTRIES = 200;

export class ImportFileError extends Error {
  constructor(
    readonly code:
      | 'EMPTY'
      | 'TOO_LARGE'
      | 'UNSUPPORTED'
      | 'CORRUPT'
      | 'ZIP_BOMB'
      | 'NO_HEADERS'
      | 'NO_ROWS'
      | 'TOO_MANY_ROWS'
      | 'TOO_MANY_COLUMNS'
      | 'TOO_MUCH_TEXT',
    message: string,
  ) {
    super(message);
  }
}

export interface ParsedSheet {
  kind: GrowthImportFileKind;
  headers: string[];
  /** Filas con datos, con su número de fila en el archivo (1 = encabezados). */
  rows: Array<{ rowNumber: number; values: string[] }>;
}

/** El tipo se decide por el contenido, nunca por el mimetype del cliente. */
export function detectKind(buffer: Buffer): GrowthImportFileKind {
  if (buffer.length >= 4 && buffer.readUInt32LE(0) === 0x04034b50) {
    return GrowthImportFileKind.XLSX;
  }
  // Un CSV es texto: sin bytes nulos en el primer bloque.
  if (buffer.subarray(0, 8192).includes(0)) {
    throw new ImportFileError(
      'UNSUPPORTED',
      'El archivo no es CSV ni XLSX (los .xls antiguos no se aceptan: guárdelo como .xlsx)',
    );
  }
  return GrowthImportFileKind.CSV;
}

export async function readSpreadsheet(buffer: Buffer): Promise<ParsedSheet> {
  if (!buffer.length)
    throw new ImportFileError('EMPTY', 'El archivo está vacío');
  if (buffer.length > IMPORT_MAX_BYTES) {
    throw new ImportFileError('TOO_LARGE', 'El archivo supera 5 MB');
  }
  const kind = detectKind(buffer);
  const matrix =
    kind === GrowthImportFileKind.XLSX
      ? await readXlsx(buffer)
      : parseCsv(decodeText(buffer));
  return toSheet(kind, matrix);
}

function toSheet(
  kind: GrowthImportFileKind,
  matrix: Array<{ rowNumber: number; values: string[] }>,
): ParsedSheet {
  const [head, ...body] = matrix.filter((r) => r.values.some((v) => v !== ''));
  if (!head)
    throw new ImportFileError('NO_HEADERS', 'El archivo no tiene encabezados');
  let width = head.values.length;
  while (width > 0 && head.values[width - 1] === '') width--;
  if (width === 0)
    throw new ImportFileError('NO_HEADERS', 'El archivo no tiene encabezados');
  if (width > IMPORT_MAX_COLUMNS) {
    throw new ImportFileError(
      'TOO_MANY_COLUMNS',
      `Máximo ${IMPORT_MAX_COLUMNS} columnas`,
    );
  }
  if (!body.length)
    throw new ImportFileError('NO_ROWS', 'El archivo no tiene filas de datos');
  if (body.length > IMPORT_MAX_ROWS) {
    throw new ImportFileError(
      'TOO_MANY_ROWS',
      `Máximo ${IMPORT_MAX_ROWS} filas`,
    );
  }
  const headers = head.values
    .slice(0, width)
    .map((h, i) => h.slice(0, 120) || `Columna ${i + 1}`);
  const budget = textBudget();
  const rows = body.map((r) => ({
    rowNumber: r.rowNumber,
    values: Array.from({ length: width }, (_, i) =>
      budget((r.values[i] ?? '').slice(0, IMPORT_MAX_CELL_CHARS)),
    ),
  }));
  return { kind, headers, rows };
}

/** Cuenta el texto acumulado y corta en cuanto pasa el tope. */
function textBudget(): (value: string) => string {
  let total = 0;
  return (value) => {
    total += value.length;
    if (total > IMPORT_MAX_TOTAL_CHARS) {
      throw new ImportFileError(
        'TOO_MUCH_TEXT',
        'El archivo tiene demasiado texto (máx. 15 millones de caracteres)',
      );
    }
    return value;
  };
}

// ── CSV ─────────────────────────────────────────────────────────────────────

/** UTF-8 (con o sin BOM); si no es UTF-8 válido, Windows-1252 (Excel en ANSI). */
export function decodeText(buffer: Buffer): string {
  let text: string;
  try {
    text = new TextDecoder('utf-8', { fatal: true }).decode(buffer);
  } catch {
    text = new TextDecoder('windows-1252').decode(buffer);
  }
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** Excel en español usa `;`. Se elige el separador más frecuente fuera de comillas en la primera línea. */
export function detectDelimiter(text: string): ',' | ';' | '\t' {
  const counts = { ',': 0, ';': 0, '\t': 0 };
  let quoted = false;
  for (const ch of text.slice(0, 64 * 1024)) {
    if (ch === '"') quoted = !quoted;
    else if (!quoted && (ch === '\n' || ch === '\r')) break;
    else if (!quoted && ch in counts) counts[ch as keyof typeof counts]++;
  }
  const best = (
    Object.entries(counts) as Array<[',' | ';' | '\t', number]>
  ).sort((a, b) => b[1] - a[1])[0];
  return best[1] > 0 ? best[0] : ',';
}

/**
 * RFC 4180: campos entre comillas con `""` escapado y saltos de línea dentro
 * de comillas. Los números de fila son los del archivo (una fila con un salto
 * dentro de comillas cuenta como una).
 */
export function parseCsv(
  text: string,
  delimiter = detectDelimiter(text),
): Array<{ rowNumber: number; values: string[] }> {
  const rows: Array<{ rowNumber: number; values: string[] }> = [];
  let row: string[] = [];
  let field = '';
  let quoted = false;
  let rowNumber = 1;
  const pushField = () => {
    row.push(field.trim());
    field = '';
  };
  const pushRow = () => {
    pushField();
    rows.push({ rowNumber, values: row });
    row = [];
    rowNumber++;
    // Tope temprano: no seguir leyendo un archivo con demasiadas filas.
    if (rows.length > IMPORT_MAX_ROWS + 1) {
      throw new ImportFileError(
        'TOO_MANY_ROWS',
        `Máximo ${IMPORT_MAX_ROWS} filas`,
      );
    }
  };

  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"') {
        if (text[i + 1] === '"') {
          field += '"';
          i++;
        } else {
          quoted = false;
        }
      } else {
        field += ch;
      }
      continue;
    }
    if (ch === '"' && field.trim() === '') {
      field = '';
      quoted = true;
    } else if (ch === delimiter) {
      pushField();
      if (row.length > IMPORT_MAX_COLUMNS) {
        throw new ImportFileError(
          'TOO_MANY_COLUMNS',
          `Máximo ${IMPORT_MAX_COLUMNS} columnas`,
        );
      }
    } else if (ch === '\n' || ch === '\r') {
      if (ch === '\r' && text[i + 1] === '\n') i++;
      pushRow();
    } else {
      field += ch;
    }
  }
  if (field !== '' || row.length) pushRow();
  return rows;
}

// ── XLSX ────────────────────────────────────────────────────────────────────

/**
 * Revisa el directorio central del zip ANTES de descomprimir: tope de
 * entradas y de tamaño descomprimido declarado. ZIP64 se rechaza (un XLSX de
 * 5 MB no lo necesita).
 */
export function assertZipSafe(buffer: Buffer): void {
  const EOCD = 0x06054b50;
  const CEN = 0x02014b50;
  let eocd = -1;
  for (
    let i = buffer.length - 22;
    i >= Math.max(0, buffer.length - 22 - 0xffff);
    i--
  ) {
    if (buffer.readUInt32LE(i) === EOCD) {
      eocd = i;
      break;
    }
  }
  if (eocd < 0)
    throw new ImportFileError('CORRUPT', 'El archivo XLSX está dañado');
  const entries = buffer.readUInt16LE(eocd + 10);
  const cdOffset = buffer.readUInt32LE(eocd + 16);
  if (entries === 0xffff || cdOffset === 0xffffffff) {
    throw new ImportFileError('ZIP_BOMB', 'Formato XLSX no admitido (ZIP64)');
  }
  if (entries > XLSX_MAX_ENTRIES) {
    throw new ImportFileError(
      'ZIP_BOMB',
      'El archivo XLSX tiene demasiadas partes',
    );
  }
  let offset = cdOffset;
  let total = 0;
  for (let n = 0; n < entries; n++) {
    if (offset + 46 > buffer.length || buffer.readUInt32LE(offset) !== CEN) {
      throw new ImportFileError('CORRUPT', 'El archivo XLSX está dañado');
    }
    const uncompressed = buffer.readUInt32LE(offset + 24);
    if (uncompressed === 0xffffffff) {
      throw new ImportFileError('ZIP_BOMB', 'Formato XLSX no admitido (ZIP64)');
    }
    total += uncompressed;
    if (total > XLSX_MAX_UNCOMPRESSED) {
      throw new ImportFileError(
        'ZIP_BOMB',
        'El archivo XLSX descomprimido es demasiado grande',
      );
    }
    offset +=
      46 +
      buffer.readUInt16LE(offset + 28) +
      buffer.readUInt16LE(offset + 30) +
      buffer.readUInt16LE(offset + 32);
  }
}

async function readXlsx(
  buffer: Buffer,
): Promise<Array<{ rowNumber: number; values: string[] }>> {
  assertZipSafe(buffer);
  const ExcelJS = await import('exceljs');
  const workbook = new ExcelJS.Workbook();
  try {
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
  } catch {
    throw new ImportFileError('CORRUPT', 'No se pudo leer el archivo XLSX');
  }
  // Solo la primera hoja.
  const sheet = workbook.worksheets[0];
  if (!sheet)
    throw new ImportFileError('NO_HEADERS', 'El archivo no tiene hojas');
  if (sheet.actualRowCount > IMPORT_MAX_ROWS + 1) {
    throw new ImportFileError(
      'TOO_MANY_ROWS',
      `Máximo ${IMPORT_MAX_ROWS} filas`,
    );
  }
  if (sheet.actualColumnCount > IMPORT_MAX_COLUMNS) {
    throw new ImportFileError(
      'TOO_MANY_COLUMNS',
      `Máximo ${IMPORT_MAX_COLUMNS} columnas`,
    );
  }
  const rows: Array<{ rowNumber: number; values: string[] }> = [];
  // Corta durante la lectura: no se arma la matriz completa de un archivo
  // que se va a rechazar.
  const budget = textBudget();
  sheet.eachRow({ includeEmpty: false }, (row, rowNumber) => {
    const values: string[] = [];
    row.eachCell({ includeEmpty: true }, (cell, col) => {
      if (col <= IMPORT_MAX_COLUMNS) {
        values[col - 1] = budget(
          cellText(cell.value).slice(0, IMPORT_MAX_CELL_CHARS),
        );
      }
    });
    rows.push({
      rowNumber,
      values: Array.from(values, (v) => v ?? ''),
    });
  });
  return rows;
}

/** Valor de una celda como texto. Las fórmulas aportan su resultado guardado. */
export function cellText(value: unknown): string {
  if (value === null || value === undefined) return '';
  if (value instanceof Date) return value.toISOString().slice(0, 10);
  if (typeof value === 'number') {
    // Evita "9.00123456E8" en NIT o teléfonos guardados como número.
    return Number.isInteger(value) ? value.toFixed(0) : String(value);
  }
  if (typeof value === 'string' || typeof value === 'boolean') {
    return String(value).trim();
  }
  if (typeof value === 'object') {
    const v = value as Record<string, unknown>;
    if (Array.isArray(v.richText)) {
      return (v.richText as Array<{ text?: string }>)
        .map((t) => t.text ?? '')
        .join('')
        .trim();
    }
    if ('formula' in v || 'sharedFormula' in v) return cellText(v.result);
    if ('text' in v) return cellText(v.text);
    if ('error' in v) return '';
  }
  return '';
}
