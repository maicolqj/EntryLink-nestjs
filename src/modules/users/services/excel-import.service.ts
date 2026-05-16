import { Injectable, Logger, BadRequestException } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository, DataSource } from 'typeorm';
import { randomBytes } from 'crypto';
import { hash } from 'bcrypt';

// PREREQUISITO: yarn add exceljs
// El tipo se importa de forma dinámica para no romper el build si no está instalado
import type ExcelJS from 'exceljs';

import { User } from '../entities/user.entity';
import { UserStatus } from '../enums/user.enums';
import { UserRole } from '../entities/user_has_roles.entity';
import { Role } from '../../roles/entities/role.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { Resident } from '../../residents/entities/resident.entity';
import { ResidentStatus } from '../../residents/enums/resident-status.enum';
import { ResidentType } from '../../residents/enums/resident-type.enum';
import {
  ResidentRowData,
  ImportResult,
} from '../queues/excel-import.constants';

type ProgressCallback = (progress: number) => Promise<void>;

/** Columnas esperadas en el Excel (índice base 1) */
const COL = {
  NAME: 1,
  LAST_NAME: 2,
  PHONE: 3,
  IDENTITY: 4,
  EMAIL: 5,
  UNIT_NUMBER: 6,
  TOWER: 7,
} as const;

@Injectable()
export class ExcelImportService {
  private readonly logger = new Logger(ExcelImportService.name);
  private readonly BATCH_SIZE = 50;

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    @InjectRepository(Resident) private readonly residentRepo: Repository<Resident>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Parseo del archivo ──────────────────────────────────────────────────

  async parseExcel(filePath: string): Promise<ResidentRowData[]> {
    let ExcelJS: typeof import('exceljs');
    try {
      ExcelJS = await import('exceljs');
    } catch {
      throw new BadRequestException(
        'El módulo exceljs no está instalado. Ejecuta: yarn add exceljs',
      );
    }

    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.readFile(filePath);
    const sheet = workbook.worksheets[0];

    if (!sheet) {
      throw new BadRequestException('El archivo Excel no contiene hojas de trabajo');
    }

    const rows: ResidentRowData[] = [];

    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return; // Skip encabezado

      const name = this.cellString(row.getCell(COL.NAME));
      const lastName = this.cellString(row.getCell(COL.LAST_NAME));
      const phoneNumber = this.cellString(row.getCell(COL.PHONE));
      const identityNumber = this.cellString(row.getCell(COL.IDENTITY));
      const email = this.cellString(row.getCell(COL.EMAIL)) || undefined;
      const unitNumber = this.cellString(row.getCell(COL.UNIT_NUMBER));
      const tower = this.cellString(row.getCell(COL.TOWER)) || undefined;

      if (!name && !lastName && !phoneNumber) return; // Fila vacía

      rows.push({ name, lastName, phoneNumber, identityNumber, email, unitNumber, tower, rowIndex });
    });

    return rows;
  }

  // ── Procesamiento por batches ───────────────────────────────────────────

  async processRows(
    rows: ResidentRowData[],
    complexId: string,
    adminUserId: string,
    onProgress: ProgressCallback,
  ): Promise<Omit<ImportResult, 'importId'>> {
    const errors: ImportResult['errors'] = [];
    let successCount = 0;

    // Cargar rol RESIDENT_ROL una sola vez
    const residentRole = await this.roleRepo.findOne({
      where: { name: ValidRoles.RESIDENT_ROL },
    });

    if (!residentRole) {
      throw new BadRequestException('El rol RESIDENT_ROL no está configurado en el sistema');
    }

    const total = rows.length;
    const batches = this.chunk(rows, this.BATCH_SIZE);

    for (let batchIdx = 0; batchIdx < batches.length; batchIdx++) {
      const batch = batches[batchIdx];

      for (const row of batch) {
        try {
          await this.processSingleRow(row, complexId, adminUserId, residentRole);
          successCount++;
        } catch (error: any) {
          errors.push({
            row: row.rowIndex,
            message: error?.message ?? 'Error desconocido',
          });
          this.logger.warn(`Error en fila ${row.rowIndex}: ${error?.message}`);
        }
      }

      const progress = ((batchIdx + 1) / batches.length) * 100;
      await onProgress(progress);
    }

    return {
      totalRows: total,
      successCount,
      errorCount: errors.length,
      errors,
      processedAt: new Date(),
    };
  }

  // ── Procesamiento individual ─────────────────────────────────────────────

  private async processSingleRow(
    row: ResidentRowData,
    complexId: string,
    adminUserId: string,
    residentRole: Role,
  ): Promise<void> {
    // 1. Validar campos requeridos
    const validationErrors = this.validateRow(row);
    if (validationErrors.length) {
      throw new Error(validationErrors.join('; '));
    }

    await this.dataSource.transaction(async (manager) => {
      // 2. Verificar duplicado por teléfono
      const existing = await manager.findOne(User, {
        where: { phoneNumber: row.phoneNumber },
      });

      if (existing) {
        throw new Error(`El número ${row.phoneNumber} ya está registrado`);
      }

      // 3. Buscar la unidad por número + torre dentro del complejo
      const unitQuery: Record<string, any> = {
        complexId,
        number: row.unitNumber.trim().toUpperCase(),
      };
      if (row.tower) {
        unitQuery['tower'] = row.tower.trim().toUpperCase();
      }

      const unit = await manager.findOne(Unit, { where: unitQuery });
      if (!unit) {
        throw new Error(
          `Unidad '${row.tower ? row.tower + '-' : ''}${row.unitNumber}' no encontrada en el complejo`,
        );
      }

      // 4. Generar código del sistema y contraseña dummy
      const systemCode = this.generateSystemCode();
      const dummyPassword = await hash(randomBytes(32).toString('hex'), 10);

      // 5. Crear usuario
      const email = row.email?.trim().toLowerCase() ?? this.generateDefaultEmail(row.phoneNumber);

      const user = manager.create(User, {
        name: row.name.trim().toUpperCase(),
        lastName: row.lastName.trim().toUpperCase(),
        phoneNumber: row.phoneNumber.trim(),
        identity: row.identityNumber.trim(),
        email,
        password: dummyPassword,
        systemCode,
        complexId,
        status: UserStatus.ACTIVE,
        phoneVerified: false,
        emailVerified: false,
        identityVerified: false,
        acceptTermsAdnConditions: false,
        acceptsMarketing: false,
      });

      const savedUser = await manager.save(User, user);

      // 6. Asignar rol RESIDENT_ROL
      const userRole = manager.create(UserRole, {
        user: { id: savedUser.id },
        role: { id: residentRole.id },
        isPrimary: true,
      });
      await manager.save(UserRole, userRole);

      // 7. Crear registro de residente
      const resident = manager.create(Resident, {
        userId: savedUser.id,
        unitId: unit.id,
        complexId,
        type: ResidentType.OWNER,
        status: ResidentStatus.PENDING_APPROVAL,
        startDate: new Date(),
        isMainResident: false,
      });
      await manager.save(Resident, resident);
    });
  }

  // ── Helpers ─────────────────────────────────────────────────────────────

  private validateRow(row: ResidentRowData): string[] {
    const errors: string[] = [];

    if (!row.name?.trim()) errors.push('Nombre requerido');
    if (!row.lastName?.trim()) errors.push('Apellido requerido');
    if (!/^3\d{9}$/.test(row.phoneNumber?.trim() ?? '')) {
      errors.push(`Teléfono inválido: '${row.phoneNumber}'`);
    }
    if (!row.identityNumber?.trim()) errors.push('Número de identificación requerido');
    if (!row.unitNumber?.trim()) errors.push('Número de unidad requerido');
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push(`Email inválido: '${row.email}'`);
    }

    return errors;
  }

  /** Genera un código de sistema legible y único (ej: RES-A3F9-K2M1) */
  private generateSystemCode(): string {
    const part1 = randomBytes(2).toString('hex').toUpperCase();
    const part2 = randomBytes(2).toString('hex').toUpperCase();
    return `RES-${part1}-${part2}`;
  }

  private generateDefaultEmail(phone: string): string {
    return `resident.${phone}@entrylink.local`;
  }

  private cellString(cell: ExcelJS.Cell): string {
    const val = cell?.value;
    if (val === null || val === undefined) return '';
    if (typeof val === 'object' && 'text' in val) return String((val as any).text);
    return String(val).trim();
  }

  private chunk<T>(arr: T[], size: number): T[][] {
    const result: T[][] = [];
    for (let i = 0; i < arr.length; i += size) {
      result.push(arr.slice(i, i + size));
    }
    return result;
  }
}
