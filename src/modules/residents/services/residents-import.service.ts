import { BadRequestException, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, EntityManager, IsNull, Repository } from 'typeorm';
import { extname } from 'path';
import { hash } from 'bcrypt';
import { randomBytes } from 'crypto';
import { generateSystemCode } from '../../users/utils/system-code.util';

import type ExcelJS from 'exceljs';

import {
  ResidentImportRowData,
  ResidentImportError,
} from '../queues/residents-import.constants';
import { Resident } from '../entities/resident.entity';
import { ResidentStatus } from '../enums/resident-status.enum';
import { ResidentType } from '../enums/resident-type.enum';

import { User } from '../../users/entities/user.entity';
import { UserRole } from '../../users/entities/user_has_roles.entity';
import { UserStatus } from '../../users/enums/user.enums';
import { Role } from '../../roles/entities/role.entity';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { ensureResidentRole } from '../../roles/utils/resident-base-role.util';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { UnitStatus } from '../../residential-complex/enums/unit-status.enum';
import { Building } from '../../residential-complex/entities/building.entity';

// Column indices (1-based) matching the spec table order
const COL = {
  NAME: 1,
  LAST_NAME: 2,
  EMAIL: 3,
  PHONE: 4,
  IDENTITY: 5,
  UNIT_NUMBER: 6,
  EN_EDIFICIO: 7,
  EDIFICIO: 8,
  TYPE: 9,
  START_DATE: 10,
  END_DATE: 11,
  IS_MAIN_RESIDENT: 12,
  EMERGENCY_CONTACT_NAME: 13,
  EMERGENCY_CONTACT_LAST: 14,
  EMERGENCY_CONTACT_PHONE: 15,
  NOTES: 16,
} as const;

export interface ImportProcessResult {
  total: number;
  successCount: number;
  errorCount: number;
  errors: ResidentImportError[];
  /** true = no se creó ningún residente (hubo al menos un error). */
  aborted: boolean;
}

/** Lo que la fase de validación deja resuelto para la escritura. */
interface RowPlan {
  row: ResidentImportRowData;
  unitId: string;
  existingUserId: string | null;
  type: ResidentType;
  startDate: Date;
  endDate?: Date;
}

/**
 * Lo que ya reclamó otra fila del mismo archivo. La base valida contra lo que
 * existe; esto valida el archivo contra sí mismo, porque en la fase de
 * validación nada se ha escrito todavía.
 */
class FileIndex {
  private readonly owners = new Map<string, { email: string; row: number }>();
  private readonly userUnits = new Map<string, number>();
  private readonly mains = new Map<string, number>();

  /** Teléfono o cédula: único por persona (correo). */
  claim(
    label: string,
    value: string | undefined,
    email: string,
    row: number,
  ): void {
    if (!value) return;
    const key = `${label}:${value}`;
    const owner = this.owners.get(key);
    if (owner && owner.email !== email) {
      throw new Error(
        `${label} '${value}' repetido: ya lo usa la fila ${owner.row} (${owner.email})`,
      );
    }
    if (!owner) this.owners.set(key, { email, row });
  }

  /** La misma persona dos veces en la misma unidad. */
  claimUnit(
    email: string,
    unitId: string,
    unitNumber: string,
    row: number,
  ): void {
    const key = `${email}:${unitId}`;
    const first = this.userUnits.get(key);
    if (first !== undefined) {
      throw new Error(
        `'${email}' aparece dos veces en la unidad '${unitNumber}' (fila ${first})`,
      );
    }
    this.userUnits.set(key, row);
  }

  /** Dos residentes principales para la misma unidad. */
  claimMain(unitId: string, unitNumber: string, row: number): void {
    const first = this.mains.get(unitId);
    if (first !== undefined) {
      throw new Error(
        `la unidad '${unitNumber}' ya tiene residente principal en la fila ${first}`,
      );
    }
    this.mains.set(unitId, row);
  }
}

type ProgressCallback = (
  done: number,
  total: number,
  successCount: number,
  errorCount: number,
) => void;

@Injectable()
export class ResidentsImportService {
  private readonly logger = new Logger(ResidentsImportService.name);

  constructor(
    @InjectRepository(User) private readonly userRepo: Repository<User>,
    @InjectRepository(Role) private readonly roleRepo: Repository<Role>,
    @InjectRepository(Unit) private readonly unitRepo: Repository<Unit>,
    @InjectRepository(Building)
    private readonly buildingRepo: Repository<Building>,
    @InjectRepository(Resident)
    private readonly residentRepo: Repository<Resident>,
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

      const name = this.cellStr(row.getCell(COL.NAME));
      const lastName = this.cellStr(row.getCell(COL.LAST_NAME));
      const email = this.cellStr(row.getCell(COL.EMAIL)).toLowerCase();

      // skip completely empty rows
      if (!name && !lastName && !email) return;

      rows.push({
        rowIndex,
        name,
        lastName,
        email,
        phoneNumber: this.cellStr(row.getCell(COL.PHONE)) || undefined,
        identityNumber: this.cellStr(row.getCell(COL.IDENTITY)) || undefined,
        unitNumber: this.cellStr(row.getCell(COL.UNIT_NUMBER)),
        enEdificio: this.parseBoolean(row.getCell(COL.EN_EDIFICIO).value),
        buildingName: this.cellStr(row.getCell(COL.EDIFICIO)) || undefined,
        typeRaw: this.cellStr(row.getCell(COL.TYPE)),
        startDateRaw: row.getCell(COL.START_DATE).value,
        endDateRaw: row.getCell(COL.END_DATE).value || undefined,
        isMainResident: this.parseBoolean(
          row.getCell(COL.IS_MAIN_RESIDENT).value,
        ),
        emergencyContactName:
          this.cellStr(row.getCell(COL.EMERGENCY_CONTACT_NAME)) || undefined,
        emergencyContactLastName:
          this.cellStr(row.getCell(COL.EMERGENCY_CONTACT_LAST)) || undefined,
        emergencyContactPhone:
          this.cellStr(row.getCell(COL.EMERGENCY_CONTACT_PHONE)) || undefined,
        notes: this.cellStr(row.getCell(COL.NOTES)) || undefined,
      });
    });

    return rows;
  }

  /**
   * Importa el archivo completo o nada.
   *
   * Antes cada fila se guardaba en su propia transacción: si la fila 30 fallaba,
   * las 29 anteriores ya estaban creadas, y la administración no sabía cuáles
   * había que quitar del Excel antes de volver a subirlo (volver a subirlo
   * entero chocaba con los ya creados). Ahora:
   *
   * 1. Se validan TODAS las filas sin escribir nada, y se juntan TODOS los
   *    errores: el Excel se corrige de una vez, no fila por fila.
   * 2. Si hay un solo error, no se crea ningún residente.
   * 3. Si todo está bien, se escriben todas en UNA transacción: un fallo
   *    inesperado a mitad (una restricción única) revierte también las demás.
   *
   * El progreso cuenta la validación como la primera mitad y la escritura como
   * la segunda, para que la barra no vuelva atrás al cambiar de fase.
   */
  async processRows(
    rows: ResidentImportRowData[],
    complexId: string,
    approvedByUserId: string | null,
    onProgress: ProgressCallback,
  ): Promise<ImportProcessResult> {
    const residentRole = await this.roleRepo.findOne({
      where: { name: ValidRoles.RESIDENT_ROL },
    });

    if (!residentRole) {
      throw new Error('El rol RESIDENT_ROL no está configurado en el sistema');
    }

    const total = rows.length;
    const half = (n: number) => Math.floor(n / 2);

    // ── Fase 1: validar todo, sin escribir ────────────────────────────────
    const errors: ResidentImportError[] = [];
    const plans: RowPlan[] = [];
    const seen = new FileIndex();

    for (const [index, row] of rows.entries()) {
      try {
        plans.push(await this.planRow(row, complexId, seen));
      } catch (err: any) {
        errors.push(this.rowError(row, err));
      }
      onProgress(half(index + 1), total, 0, errors.length);
    }

    if (errors.length > 0) {
      this.logger.warn(
        `Importación rechazada: ${errors.length} fila(s) con error, no se creó ningún residente`,
      );
      return {
        total,
        successCount: 0,
        errorCount: errors.length,
        errors,
        aborted: true,
      };
    }

    // ── Fase 2: escribir todo en una transacción ──────────────────────────
    let current: RowPlan | null = null;
    let written = 0;

    try {
      await this.dataSource.transaction(async (manager) => {
        // Una misma persona puede vivir en dos unidades del archivo: la cuenta
        // se crea con la primera fila y las demás la reutilizan.
        const createdByEmail = new Map<string, string>();

        for (const plan of plans) {
          current = plan;
          await this.writeRow(
            plan,
            complexId,
            approvedByUserId,
            residentRole,
            manager,
            createdByEmail,
          );
          written++;
          onProgress(half(total) + half(written), total, written, 0);
        }
      });
    } catch (err: any) {
      const failed = current as RowPlan | null;
      this.logger.error(
        `Importación revertida en la fila ${failed?.row.rowIndex}: ${err?.message}`,
      );
      const message = this.friendlyWriteError(err);
      return {
        total,
        successCount: 0,
        errorCount: 1,
        errors: [
          failed
            ? this.rowError(failed.row, new Error(message))
            : { row: 0, identifier: '', message },
        ],
        aborted: true,
      };
    }

    onProgress(total, total, plans.length, 0);
    return {
      total,
      successCount: plans.length,
      errorCount: 0,
      errors: [],
      aborted: false,
    };
  }

  // ── Fase 1: validación ───────────────────────────────────────────────────

  /**
   * Todo lo que puede hacer fallar la fila, comprobado sin escribir: campos,
   * unidad, choques con la base y choques con otras filas del mismo archivo.
   */
  private async planRow(
    row: ResidentImportRowData,
    complexId: string,
    seen: FileIndex,
  ): Promise<RowPlan> {
    const problems = this.validateRow(row);

    const startDate = row.startDateRaw
      ? this.parseDate(row.startDateRaw)
      : undefined;
    if (row.startDateRaw && !startDate) {
      problems.push(`fecha de ingreso inválida: '${String(row.startDateRaw)}'`);
    }
    const endDate = row.endDateRaw ? this.parseDate(row.endDateRaw) : undefined;
    if (row.endDateRaw && !endDate) {
      problems.push(`fecha de salida inválida: '${String(row.endDateRaw)}'`);
    }
    if (problems.length) throw new Error(problems.join('; '));

    const manager = this.dataSource.manager;
    const unit = await this.resolveUnit(
      complexId,
      row.unitNumber,
      row.enEdificio,
      row.buildingName,
      manager,
    );

    const email = row.email.trim().toLowerCase();
    const phone = row.phoneNumber?.trim() || undefined;
    const identity = row.identityNumber?.trim() || undefined;

    // Mismo teléfono o cédula en dos personas distintas del archivo: la base
    // los exige únicos, así que la segunda fallaría al crear la cuenta.
    seen.claim('teléfono', phone, email, row.rowIndex);
    seen.claim('cédula', identity, email, row.rowIndex);

    let existingUser = await manager.findOne(User, {
      where: { email },
      select: ['id', 'email', 'phoneNumber'],
    });
    if (!existingUser && phone) {
      existingUser = await manager.findOne(User, {
        where: { phoneNumber: phone },
        select: ['id', 'email', 'phoneNumber'],
      });
    }

    if (!existingUser && identity) {
      const identityOwner = await manager.findOne(User, {
        where: { identity, deletedAt: IsNull() },
        select: ['id'],
      });
      if (identityOwner) {
        throw new Error(
          `la cédula '${identity}' ya pertenece a otra cuenta del sistema`,
        );
      }
    }

    seen.claimUnit(email, unit.id, row.unitNumber, row.rowIndex);

    if (existingUser) {
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
          `'${row.email}' ya es residente activo de la unidad '${row.unitNumber}'`,
        );
      }
    }

    if (row.isMainResident) {
      seen.claimMain(unit.id, row.unitNumber, row.rowIndex);
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
          `la unidad '${row.unitNumber}' ya tiene un residente principal activo`,
        );
      }
    }

    return {
      row,
      unitId: unit.id,
      existingUserId: existingUser?.id ?? null,
      type: this.parseType(row.typeRaw),
      startDate: startDate!,
      endDate,
    };
  }

  // ── Fase 2: escritura ────────────────────────────────────────────────────

  private async writeRow(
    plan: RowPlan,
    complexId: string,
    approvedByUserId: string | null,
    residentRole: Role,
    manager: EntityManager,
    createdByEmail: Map<string, string>,
  ): Promise<void> {
    const { row } = plan;
    const email = row.email.trim().toLowerCase();

    let userId = plan.existingUserId ?? createdByEmail.get(email) ?? null;

    if (userId) {
      // Importar sobre una cuenta que ya existía no puede dejarla sin
      // RESIDENT_ROL, o el residente queda sin poder iniciar sesión por ningún
      // canal de residente.
      await ensureResidentRole(manager, userId, residentRole.id);
    } else {
      const dummyPassword = await hash(randomBytes(32).toString('hex'), 10);

      const savedUser = await manager.save(
        User,
        manager.create(User, {
          name: row.name.trim().toUpperCase(),
          lastName: row.lastName.trim().toUpperCase(),
          email,
          password: dummyPassword,
          phoneNumber: row.phoneNumber?.trim(),
          identity: row.identityNumber?.trim(),
          systemCode: generateSystemCode(),
          complexId,
          status: UserStatus.ACTIVE,
          phoneVerified: false,
          emailVerified: false,
          identityVerified: false,
          acceptTermsAdnConditions: false,
          acceptsMarketing: false,
        }),
      );

      await manager.save(
        manager.create(UserRole, {
          user: { id: savedUser.id },
          role: { id: residentRole.id },
          isPrimary: true,
        }),
      );

      userId = savedUser.id;
      createdByEmail.set(email, userId);
    }

    await manager.save(
      Resident,
      manager.create(Resident, {
        userId,
        unitId: plan.unitId,
        complexId,
        type: plan.type,
        isMainResident: row.isMainResident,
        status: ResidentStatus.ACTIVE,
        startDate: plan.startDate,
        endDate: plan.endDate,
        emergencyContactName: row.emergencyContactName,
        emergencyContactLastName: row.emergencyContactLastName,
        emergencyContactPhone: row.emergencyContactPhone,
        notes: row.notes,
        approvedAt: new Date(),
        approvedByUserId: approvedByUserId ?? undefined,
      }),
    );

    await manager.update(
      'units',
      { id: plan.unitId },
      { status: UnitStatus.OCCUPIED },
    );
  }

  private rowError(
    row: ResidentImportRowData,
    err: any,
  ): ResidentImportError {
    const identifier = row.email || row.name || `fila ${row.rowIndex}`;
    this.logger.warn(
      `Error fila ${row.rowIndex} (${identifier}): ${err?.message}`,
    );
    return {
      row: row.rowIndex,
      identifier,
      message: err?.message ?? 'Error desconocido',
    };
  }

  /** Un error de base de datos contado en español, sin SQL. */
  private friendlyWriteError(err: any): string {
    if (err?.code === '23505') {
      const field = /\((\w+)\)=/.exec(err?.detail ?? '')?.[1];
      const label: Record<string, string> = {
        email: 'el correo',
        phone_number: 'el teléfono',
        identity: 'la cédula',
      };
      return `${label[field ?? ''] ?? 'un dato'} ya está registrado en otra cuenta. No se cargó ningún residente.`;
    }
    return `No se pudo guardar la fila (${err?.message ?? 'error desconocido'}). No se cargó ningún residente.`;
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
        throw new Error(
          `Edificio '${buildingName}' no encontrado en el complejo`,
        );
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
    if (!row.name?.trim()) errors.push('nombre requerido');
    if (!row.lastName?.trim()) errors.push('apellido requerido');
    if (!row.email?.trim()) errors.push('email requerido');
    if (row.email && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(row.email)) {
      errors.push(`email inválido: '${row.email}'`);
    }
    if (!row.unitNumber?.trim()) errors.push('unidad requerida');
    if (!row.startDateRaw) errors.push('fechaIngreso requerida');
    return errors;
  }

  private parseType(raw: string): ResidentType {
    const val = (raw ?? '').trim().toUpperCase();
    const map: Record<string, ResidentType> = {
      PROPIETARIO: ResidentType.OWNER,
      OWNER: ResidentType.OWNER,
      ARRENDATARIO: ResidentType.TENANT,
      INQUILINO: ResidentType.TENANT,
      TENANT: ResidentType.TENANT,
      FAMILIAR: ResidentType.FAMILY_MEMBER,
      FAMILY_MEMBER: ResidentType.FAMILY_MEMBER,
      CUIDADOR: ResidentType.CARETAKER,
      CARETAKER: ResidentType.CARETAKER,
    };
    return map[val] ?? ResidentType.OWNER;
  }

  private parseBoolean(raw: unknown): boolean {
    if (typeof raw === 'boolean') return raw;
    if (typeof raw === 'number') return raw !== 0;
    const str = String(raw ?? '')
      .trim()
      .toUpperCase();
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
    if (typeof val === 'object' && 'text' in val)
      return String((val as any).text).trim();
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
