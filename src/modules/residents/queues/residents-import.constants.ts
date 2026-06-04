export const RESIDENTS_IMPORT_QUEUE = 'residents-import';

export const RESIDENTS_IMPORT_JOBS = {
  PROCESS_FILE: 'process-residents-file',
} as const;

export interface ResidentImportJobPayload {
  filePath: string;
  complexId: string;
  adminUserId: string;
  /** null when caller entityType === 'complex' (sub is complex UUID, not user UUID) */
  approvedByUserId: string | null;
  jobId: string;
}

export interface ResidentImportRowData {
  rowIndex: number;
  name: string;
  lastName: string;
  email: string;
  phoneNumber?: string;
  identityNumber?: string;
  unitNumber: string;
  enEdificio: boolean;
  buildingName?: string;
  typeRaw: string;
  startDateRaw: unknown;
  endDateRaw?: unknown;
  isMainResident: boolean;
  emergencyContactName?: string;
  emergencyContactLastName?: string;
  emergencyContactPhone?: string;
  notes?: string;
}

export interface ResidentImportError {
  row: number;
  identifier: string;
  message: string;
}
