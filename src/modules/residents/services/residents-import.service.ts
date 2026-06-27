import {
  BadRequestException,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { extname } from 'path';
import { hash } from 'bcrypt';
import { randomBytes } from 'crypto';
import { generateSystemCode } from '../../users/utils/system-code.util';

import type ExcelJS from 'exceljs';

import { ResidentImportRowData, ResidentImportError } from '../queues/residents-import.constants';
import { Resident }      from '../entities/resident.entity';
import { ResidentStatus } from '../enums/resident-status.enum';
import { ResidentType }  from '../enums/resident-type.enum';

import { User }     from '../../users/entities/user.entity';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { Role }     from '../../roles/entities/role.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { Unit }     from '../../residential-complex/entities/unit.entity';
import { UnitStatus } from '../../residential-complex/enums/unit-status.enum';
import { Building } from '../../residential-complex/entities/building.entity';

// Column indices (1-based) matching the spec table order
const COL = {
  NAME:                    1,
  LAST_NAME:               2,
  EMAIL:                   3,
  PHONE:                   4,
  IDENTITY:                5,
  UNIT_NUMBER:             6,
  EN_EDIFICIO:             7,
  EDIFICIO:                8,
  TYPE:                    9,
  START_DATE:             10,
  END_DATE:               11,
  IS_MAIN_RESIDENT:       12,
  EMERGENCY_CONTACT_NAME: 13,
  EMERGENCY_CONTACT_LAST: 14,
  EMERGENCY_CONTACT_PHONE:15,
  NOTES:                  16,
} as const;

export interface ImportProcessResult {
  total: number;
  successCount: number;
  errorCount: number;
  errors: ResidentImportError[];
}

type ProgressCallback = (done: number, total: number, successCount: number, errorCount: number) => void;

@Injectable()
export class ResidentsImportService {
  private readonly logger = new Logger(ResidentsImportService.name);

  constructor(
    @InjectRepository(User)      private readonly userRepo:     Repository<User>,
    @InjectRepository(Role)      private readonly roleRepo:     Repository<Role>,
    @InjectRepository(Unit)      private readonly unitRepo:     Repository<Unit>,
    @InjectRepository(Building)  private readonly buildingRepo: Repository<Building>,
    @InjectRepository(Resident)  private readonly residentRepo: Repository<Resident>,
    private readonly dataSource: DataSource,
  ) {}

  // ── Public API ───────────────────────────────────────────────────────────

  async countRows(filePath: string): Promise<number> {
    const workbook = await this.loadWorkbook(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) return 0;
    // actualRowCount excludes trailing empty rows; subtract 1 for the header
    return Math.max(0, (sheet.actualRowCount ?? sheet.rowCount) - 1);
  }

  async parseFile(filePath: string): Promise<ResidentImportRowData[]> {
    const workbook = await this.loadWorkbook(filePath);
    const sheet = workbook.worksheets[0];

    if (!sheet) {
      throw new BadRequestException('El archivo no contiene hojas de trabajo');
    }

    const rows: ResidentImportRowData[] = [];

    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return; // skip header

      const name      = this.cellStr(row.getCell(COL.NAME));
      const lastName  = this.cellStr(row.getCell(COL.LAST_NAME));
      const email     = this.cellStr(row.getCell(COL.EMAIL)).toLowerCase();

      // skip completely empty rows
      if (!name && !lastName && !email) return;

      rows.push({
        rowIndex,
        name,
        lastName,
        email,
        phoneNumber:             this.cellStr(row.getCell(COL.PHONE)) || undefined,
        identityNumber:          this.cellStr(row.getCell(COL.IDENTITY)) || undefined,
        unitNumber:              this.cellStr(row.getCell(COL.UNIT_NUMBER)),
        enEdificio:              this.parseBoolean(row.getCell(COL.EN_EDIFICIO).value),
        buildingName:            this.cellStr(row.getCell(COL.EDIFICIO)) || undefined,
        typeRaw:                 this.cellStr(row.getCell(COL.TYPE)),
        startDateRaw:            row.getCell(COL.START_DATE).value,
        endDateRaw:              row.getCell(COL.END_DATE).value || undefined,
        isMainResident:          this.parseBoolean(row.getCell(COL.IS_MAIN_RESIDENT).value),
        emergencyContactName:    this.cellStr(row.getCell(COL.EMERGENCY_CONTACT_NAME)) || undefined,
        emergencyContactLastName: this.cellStr(row.getCell(COL.EMERGENCY_CONTACT_LAST)) || undefined,
        emergencyContactPhone:   this.cellStr(row.getCell(COL.EMERGENCY_CONTACT_PHONE)) || undefined,
        notes:                   this.cellStr(row.getCell(COL.NOTES)) || undefined,
      });
    });

    return rows;
  }

  async processRows(
    rows: ResidentImportRowData[],
    complexId: string,
    approvedByUserId: string | null,
    onProgress: ProgressCallback,
  ): Promise<ImportProcessResult> {
    const errors: ResidentImportError[] = [];
    let successCount = 0;

    const residentRole = await this.roleRepo.findOne({
      where: { name: ValidRoles.RESIDENT_ROL },
    });

    if (!residentRole) {
      throw new Error('El rol RESIDENT_ROL no está configurado en el sistema');
    }

    const total = rows.length;

    for (const row of rows) {
      const identifier = row.email || row.name || `fila ${row.rowIndex}`;
      try {
        await this.processSingleRow(row, complexId, approvedByUserId, residentRole);
        successCount++;
      } catch (err: any) {
        errors.push({
          row: row.rowIndex,
          identifier,
          message: err?.message ?? 'Error desconocido',
        });
        this.logger.warn(`Error fila ${row.rowIndex} (${identifier}): ${err?.message}`);
      }

      onProgress(successCount + errors.length, total, successCount, errors.length);
    }

    return {
      total,
      successCount,
      errorCount: errors.length,
      errors,
    };
  }

  // ── Row processing ───────────────────────────────────────────────────────

  private async processSingleRow(
    row: ResidentImportRowData,
    complexId: string,
    approvedByUserId: string | null,
    residentRole: Role,
  ): Promise<void> {
    const validationErrors = this.validateRow(row);
    if (validationErrors.length) {
      throw new Error(validationErrors.join('; '));
    }

    const type      = this.parseType(row.typeRaw);
    const startDate = this.parseDate(row.startDateRaw);
    const endDate   = row.endDateRaw ? this.parseDate(row.endDateRaw) : undefined;

    if (!startDate) {
      throw new Error(`Fecha de ingreso inválida: '${row.startDateRaw}'`);
    }

    await this.dataSource.transaction(async (manager) => {
      const unit = await this.resolveUnit(
        complexId,
        row.unitNumber,
        row.enEdificio,
        row.buildingName,
        manager,
      );

      // Find existing user: by email first, then phone
      let existingUser = await manager.findOne(User, {
        where: { email: row.email.trim().toLowerCase() },
        select: ['id', 'email', 'phoneNumber'],
      });

      if (!existingUser && row.phoneNumber) {
        existingUser = await manager.findOne(User, {
          where: { phoneNumber: row.phoneNumber.trim() },
          select: ['id', 'email', 'phoneNumber'],
        });
      }

      let resolvedUserId: string;

      if (existingUser) {
        // Check not already active resident in this unit
        const duplicate = await manager.findOne(Resident, {
          where: {
            userId: existingUser.id,
            unitId: unit.id,
            status: ResidentStatus.ACTIVE,
            deletedAt: IsNull(),
          },
        });
        if (duplicate) {
          throw new Error(
            `El usuario con email '${row.email}' ya es residente activo en la unidad '${row.unitNumber}'`,
          );
        }
        resolvedUserId = existingUser.id;
      } else {
        // Create new user
        const dummyPassword = await hash(randomBytes(32).toString('hex'), 10);
        const systemCode    = generateSystemCode();

        const newUser = manager.create(User, {
          name:                   row.name.trim().toUpperCase(),
          lastName:               row.lastName.trim().toUpperCase(),
          email:                  row.email.trim().toLowerCase(),
          password:               dummyPassword,
          phoneNumber:            row.phoneNumber?.trim(),
          identity:               row.identityNumber?.trim(),
          systemCode,
          complexId,
          status:                 UserStatus.ACTIVE,
          phoneVerified:          false,
          emailVerified:          false,
          identityVerified:       false,
          acceptTermsAdnConditions: false,
          acceptsMarketing:       false,
        });

        const savedUser = await manager.save(User, newUser);

        await manager.save(
          manager.create(UserRole, {
            user: { id: savedUser.id },
            role: { id: residentRole.id },
            isPrimary: true,
          }),
        );

        resolvedUserId = savedUser.id;
      }

      // Check main resident constraint
      if (row.isMainResident) {
        const existingMain = await manager.findOne(Resident, {
          where: {
            unitId: unit.id,
            isMainResident: true,
            status: ResidentStatus.ACTIVE,
            deletedAt: IsNull(),
          },
        });
        if (existingMain) {
          throw new Error(
            `La unidad '${row.unitNumber}' ya tiene un residente principal activo`,
          );
        }
      }

      const resident = manager.create(Resident, {
        userId:                   resolvedUserId,
        unitId:                   unit.id,
        complexId,
        type,
        isMainResident:           row.isMainResident,
        status:                   ResidentStatus.ACTIVE,
        startDate,
        endDate,
        emergencyContactName:     row.emergencyContactName,
        emergencyContactLastName: row.emergencyContactLastName,
        emergencyContactPhone:    row.emergencyContactPhone,
        notes:                    row.notes,
        approvedAt:               new Date(),
        approvedByUserId:         approvedByUserId ?? undefined,
      });

      await manager.save(Resident, resident);

      await manager.update('units', { id: unit.id }, { status: UnitStatus.OCCUPIED });
    });
  }

  // ── Unit resolution ──────────────────────────────────────────────────────

  private async resolveUnit(
    complexId: string,
    unitNumber: string,
    enEdificio: boolean,
    buildingName: string | undefined,
    manager: import('typeorm').EntityManager,
  ): Promise<Unit> {
    const normalizedNumber = unitNumber.trim().toUpperCase();

    if (enEdificio && buildingName) {
      const building = await manager.findOne(Building, {
        where: {
          complexId,
          name: buildingName.trim().toUpperCase(),
          deletedAt: IsNull(),
        },
      });

      if (!building) {
        throw new Error(`Edificio '${buildingName}' no encontrado en el complejo`);
      }

      const unit = await manager.findOne(Unit, {
        where: {
          complexId,
          buildingId: building.id,
          number: normalizedNumber,
          deletedAt: IsNull(),
        },
      });

      if (!unit) {
        throw new Error(
          `Unidad '${buildingName}-${unitNumber}' no encontrada en el complejo`,
        );
      }
      return unit;
    }

    const unit = await manager.findOne(Unit, {
      where: {
        complexId,
        number: normalizedNumber,
        deletedAt: IsNull(),
      },
    });

    if (!unit) {
      throw new Error(`Unidad '${unitNumber}' no encontrada en el complejo`);
    }
    return unit;
  }

  // ── Parsers / helpers ────────────────────────────────────────────────────

  private validateRow(row: ResidentImportRowData): string[] {
    const errors: string[] = [];
    if (!row.name?.trim())       errors.push('nombre requerido');
    if (!row.lastName?.trim())   errors.push('apellido requerido');
    if (!row.email?.trim())      errors.push('email requerido');
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push(`email inválido: '${row.email}'`);
    }
    if (!row.unitNumber?.trim()) errors.push('unidad requerida');
    if (!row.startDateRaw)       errors.push('fechaIngreso requerida');
    return errors;
  }

  private parseType(raw: string): ResidentType {
    const val = (raw ?? '').trim().toUpperCase();
    const map: Record<string, ResidentType> = {
      PROPIETARIO:   ResidentType.OWNER,
      OWNER:         ResidentType.OWNER,
      ARRENDATARIO:  ResidentType.TENANT,
      INQUILINO:     ResidentType.TENANT,
      TENANT:        ResidentType.TENANT,
      FAMILIAR:      ResidentType.FAMILY_MEMBER,
      FAMILY_MEMBER: ResidentType.FAMILY_MEMBER,
      CUIDADOR:      ResidentType.CARETAKER,
      CARETAKER:     ResidentType.CARETAKER,
    };
    return map[val] ?? ResidentType.OWNER;
  }

  private parseBoolean(raw: unknown): boolean {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number')  return raw !== 0;
    const str = String(raw ?? '').trim().toUpperCase();
    return ['SI', 'YES', 'TRUE', '1', 'S', 'Y'].includes(str);
  }

  parseDate(raw: unknown): Date | undefined {
    if (!raw) return undefined;
    if (raw instanceof Date) return isNaN(raw.getTime()) ? undefined : raw;

    const str = String(raw).trim();
    if (!str) return undefined;

    // Excel serial number (days since 1899-12-30)
    if (/^\d+(\.\d+)?$/.test(str)) {
      const serial = parseFloat(str);
      const ms = (serial - 25569) * 86400 * 1000;
      const d = new Date(ms);
      return isNaN(d.getTime()) ? undefined : d;
    }

    // DD/MM/YYYY
    const ddmm = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
    if (ddmm) {
      const d = new Date(+ddmm[3], +ddmm[2] - 1, +ddmm[1]);
      return isNaN(d.getTime()) ? undefined : d;
    }

    // ISO or any other parseable string
    const d = new Date(str);
    return isNaN(d.getTime()) ? undefined : d;
  }

  private cellStr(cell: ExcelJS.Cell): string {
    const val = cell?.value;
    if (val === null || val === undefined) return '';
    if (typeof val === 'object' && 'text' in val) return String((val as any).text).trim();
    if (val instanceof Date) return val.toISOString();
    return String(val).trim();
  }

  private async loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
    let ExcelJSModule: typeof import('exceljs');
    try {
      ExcelJSModule = await import('exceljs');
    } catch {
      throw new BadRequestException(
        'El módulo exceljs no está instalado. Ejecuta: yarn add exceljs',
      );
    }

    const workbook = new ExcelJSModule.Workbook();
    const ext = extname(filePath).toLowerCase();

    if (ext === '.csv') {
      await workbook.csv.readFile(filePath);
    } else {
      await workbook.xlsx.readFile(filePath);
    }

    return workbook;
  }

}
