export const EXCEL_IMPORT_QUEUE = 'excel-import';

export const EXCEL_IMPORT_JOBS = {
  PROCESS_RESIDENTS: 'process-residents-excel',
} as const;

export interface ExcelImportJobPayload {
  /** Ruta temporal del archivo Excel subido */
  filePath: string;
  /** ID del complejo residencial al que pertenecen los residentes */
  complexId: string;
  /** ID del usuario administrador que realizó la importación */
  adminUserId: string;
  /** ID de la importación para trackeo (generado por el productor) */
  importId: string;
}

export interface ResidentRowData {
  name: string;
  lastName: string;
  phoneNumber: string;
  identityNumber: string;
  email?: string;
  unitNumber: string;
  tower?: string;
  rowIndex: number;
}

export interface ImportResult {
  importId: string;
  totalRows: number;
  successCount: number;
  errorCount: number;
  errors: Array<{ row: number; field?: string; message: string }>;
  processedAt: Date;
}
