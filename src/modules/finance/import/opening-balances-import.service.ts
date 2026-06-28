import {
  BadRequestException,
  HttpStatus,
  Injectable,
  Logger,
} from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, IsNull, Repository } from 'typeorm';
import { extname } from 'path';

import type ExcelJS from 'exceljs';

import { FeeCharge }   from '../entities/fee-charge.entity';
import { WalletEntry } from '../entities/wallet-entry.entity';
import { ChargeStatus }     from '../enums/charge-status.enum';
import { PrelacionConcept } from '../enums/prelacion-concept.enum';
import { AccountingService } from '../services/accounting.service';

import { Unit }     from '../../residential-complex/entities/unit.entity';
import { Building } from '../../residential-complex/entities/building.entity';
import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';

import { CustomError } from '../../shared/utils/errors.utils';
import { FinanceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

import { AuditService }    from '../../audit/services/audit.service';
import { AuditAction }     from '../../audit/enums/audit-action.enum';
import { AuditEntityType } from '../../audit/enums/audit-entity-type.enum';

import {
  OPENING_BALANCE_CHARGE_DESC,
  OPENING_BALANCE_WALLET_DESC,
  OPENING_BALANCE_COL,
  OpeningBalanceRowData,
  OpeningBalanceRowError,
  PlannedOpeningBalance,
  OpeningBalancesImportResult,
} from './opening-balances-import.constants';

@Injectable()
export class OpeningBalancesImportService {
  private readonly logger = new Logger(OpeningBalancesImportService.name);

  constructor(
    @InjectRepository(FeeCharge)   private readonly chargeRepo:      Repository<FeeCharge>,
    @InjectRepository(WalletEntry) private readonly walletEntryRepo: Repository<WalletEntry>,
    @InjectRepository(Unit)        private readonly unitRepo:        Repository<Unit>,
    @InjectRepository(Building)    private readonly buildingRepo:    Repository<Building>,
    private readonly complexService:   ResidentialComplexService,
    private readonly accountingService: AccountingService,
    private readonly auditService:     AuditService,
    private readonly dataSource:       DataSource,
  ) {}

  // ── Public API ─────────────────────────────────────────────────────────────

  async countRows(filePath: string): Promise<number> {
    const workbook = await this.loadWorkbook(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) return 0;
    // actualRowCount excluye filas vacías al final; -1 por el encabezado
    return Math.max(0, (sheet.actualRowCount ?? sheet.rowCount) - 1);
  }

  /**
   * Importa los saldos de apertura del archivo.
   *
   * @param dryRun  true → solo analiza y devuelve el preview, sin escribir nada.
   *                false → ejecuta la migración en una única transacción.
   */
  async import(
    filePath: string,
    complexId: string,
    period: string,
    dryRun: boolean,
    currentUser: JwtAccessPayload,
  ): Promise<OpeningBalancesImportResult> {
    // Valida acceso al complejo (lanza si no existe / sin permiso) y formato de período.
    await this.complexService.findById(complexId, currentUser);
    this.assertValidPeriod(period);

    const rows = await this.parseFile(filePath);

    const errors: OpeningBalanceRowError[] = [];
    const planned: PlannedOpeningBalance[] = [];

    // ── Análisis: resolver unidad, validar montos y detectar duplicados ──
    for (const row of rows) {
      const identifier = row.buildingName
        ? `${row.buildingName}-${row.unitNumber}`
        : row.unitNumber || `fila ${row.rowIndex}`;
      try {
        const plan = await this.planRow(row, complexId, period);
        if (plan) planned.push(plan);
      } catch (err: any) {
        errors.push({ row: row.rowIndex, identifier, message: err?.message ?? 'Error desconocido' });
      }
    }

    const totalCartera = planned.reduce((s, p) => s + p.cartera, 0);
    const totalFavor   = planned.reduce((s, p) => s + p.favor, 0);
    const chargesToCreate = planned.filter(p => p.cartera > 0 && !p.skipCharge).length;
    const walletToCreate  = planned.filter(p => p.favor   > 0 && !p.skipWallet).length;
    const skipped =
      planned.filter(p => p.cartera > 0 && p.skipCharge).length +
      planned.filter(p => p.favor   > 0 && p.skipWallet).length;

    // ── Ejecución (solo si no es preview) ──
    if (!dryRun && planned.length) {
      await this.persist(planned, complexId, period, currentUser);
    }

    return {
      dryRun,
      period,
      totalRows: rows.length,
      validRows: planned.length,
      errorRows: errors.length,
      totalCartera: round2(totalCartera),
      totalFavor: round2(totalFavor),
      chargesCreated: chargesToCreate,
      walletCreditsCreated: walletToCreate,
      skipped,
      errors,
    };
  }

  // ── Análisis de una fila ─────────────────────────────────────────────────

  private async planRow(
    row: OpeningBalanceRowData,
    complexId: string,
    period: string,
  ): Promise<PlannedOpeningBalance | null> {
    if (!row.unitNumber?.trim()) {
      throw new Error('número de unidad requerido');
    }

    const cartera = this.parseAmount(row.carteraRaw);
    const favor   = this.parseAmount(row.favorRaw);

    if (cartera === null && favor === null) {
      // Fila sin ningún saldo: nada que migrar, se ignora silenciosamente.
      return null;
    }
    if (cartera !== null && cartera < 0) throw new Error(`saldo de cartera inválido (negativo): '${row.carteraRaw}'`);
    if (favor   !== null && favor   < 0) throw new Error(`saldo a favor inválido (negativo): '${row.favorRaw}'`);

    const safeCartera = cartera ?? 0;
    const safeFavor   = favor ?? 0;
    if (safeCartera === 0 && safeFavor === 0) return null;

    const unit = await this.resolveUnit(complexId, row.unitNumber, row.buildingName);

    const skipCharge = safeCartera > 0 && (await this.chargeExists(complexId, unit.id, period));
    const skipWallet = safeFavor   > 0 && (await this.walletExists(complexId, unit.id));

    return {
      rowIndex: row.rowIndex,
      unitId: unit.id,
      unitNumber: unit.number,
      buildingName: row.buildingName,
      cartera: safeCartera,
      favor: safeFavor,
      skipCharge,
      skipWallet,
    };
  }

  // ── Persistencia (transacción única, todo o nada) ─────────────────────────

  private async persist(
    planned: PlannedOpeningBalance[],
    complexId: string,
    period: string,
    currentUser: JwtAccessPayload,
  ): Promise<void> {
    const [year, month] = period.split('-').map(Number);
    const lastDay = new Date(year, month, 0).getDate();
    const dueDate = new Date(year, month - 1, lastDay);

    const affectedUnitIds = new Set<string>();
    let chargesCreated = 0;
    let walletCreated = 0;

    await this.dataSource.transaction(async (manager) => {
      for (const p of planned) {
        if (p.cartera > 0 && !p.skipCharge) {
          await manager.save(
            manager.create(FeeCharge, {
              complexId,
              unitId: p.unitId,
              period,
              dueDate,
              amount: p.cartera,
              paidAmount: 0,
              description: OPENING_BALANCE_CHARGE_DESC,
              status: ChargeStatus.PENDING,
              prelacionConcept: PrelacionConcept.ORDINARY,
            }),
          );
          chargesCreated++;
          affectedUnitIds.add(p.unitId);
        }

        if (p.favor > 0 && !p.skipWallet) {
          await manager.save(
            manager.create(WalletEntry, {
              type: 'CREDIT',
              amount: p.favor,
              description: OPENING_BALANCE_WALLET_DESC,
              unitId: p.unitId,
              complexId,
              chargeId: null,
            }),
          );
          walletCreated++;
          affectedUnitIds.add(p.unitId);
        }
      }

      // Re-materializar el saldo (PropertyAccountStatus) de cada unidad tocada.
      for (const unitId of affectedUnitIds) {
        await this.accountingService.recomputeUnitStatus(manager, complexId, unitId);
      }
    });

    this.logger.log(
      `importOpeningBalances — complejo ${complexId}, período ${period}: ` +
      `${chargesCreated} cargos y ${walletCreated} créditos creados en ${affectedUnitIds.size} unidades.`,
    );

    void this.auditService.log({
      entityType: AuditEntityType.FeeCharge,
      entityId: complexId,
      action: AuditAction.CREATE,
      newValue: { period, chargesCreated, walletCreated, units: affectedUnitIds.size, complexId },
      performedById: currentUser.sub,
      performedByName: currentUser.email,
      performedByRole: currentUser.roles?.[0] ?? '',
      complexId,
      description:
        `Importación de saldos de apertura — período ${period}: ` +
        `${chargesCreated} cargos de cartera, ${walletCreated} créditos a favor, ` +
        `${affectedUnitIds.size} unidades.`,
      isBulk: true,
    });
  }

  // ── Resolución de unidad ──────────────────────────────────────────────────

  private async resolveUnit(
    complexId: string,
    unitNumber: string,
    buildingName: string | undefined,
  ): Promise<Unit> {
    const normalizedNumber = unitNumber.trim().toUpperCase();

    if (buildingName?.trim()) {
      const building = await this.buildingRepo.findOne({
        where: { complexId, name: buildingName.trim().toUpperCase(), deletedAt: IsNull() },
      });
      if (!building) {
        throw new Error(`edificio '${buildingName}' no encontrado en el complejo`);
      }
      const unit = await this.unitRepo.findOne({
        where: { complexId, buildingId: building.id, number: normalizedNumber, deletedAt: IsNull() },
      });
      if (!unit) {
        throw new Error(`unidad '${buildingName}-${unitNumber}' no encontrada`);
      }
      return unit;
    }

    const matches = await this.unitRepo.find({
      where: { complexId, number: normalizedNumber, deletedAt: IsNull() },
    });
    if (matches.length === 0) {
      throw new Error(`unidad '${unitNumber}' no encontrada en el complejo`);
    }
    if (matches.length > 1) {
      throw new Error(
        `unidad '${unitNumber}' es ambigua (existe en varios edificios); especifique el edificio`,
      );
    }
    return matches[0];
  }

  // ── Detección de duplicados (idempotencia) ────────────────────────────────

  private async chargeExists(complexId: string, unitId: string, period: string): Promise<boolean> {
    const found = await this.chargeRepo.findOne({
      where: {
        complexId, unitId, period,
        description: OPENING_BALANCE_CHARGE_DESC,
        feeConfigId: IsNull() as any,
      },
      withDeleted: false,
    });
    return !!found;
  }

  private async walletExists(complexId: string, unitId: string): Promise<boolean> {
    const found = await this.walletEntryRepo.findOne({
      where: { complexId, unitId, type: 'CREDIT', description: OPENING_BALANCE_WALLET_DESC },
    });
    return !!found;
  }

  // ── Parsing del archivo ───────────────────────────────────────────────────

  private async parseFile(filePath: string): Promise<OpeningBalanceRowData[]> {
    const workbook = await this.loadWorkbook(filePath);
    const sheet = workbook.worksheets[0];
    if (!sheet) {
      throw new BadRequestException('El archivo no contiene hojas de trabajo');
    }

    const rows: OpeningBalanceRowData[] = [];
    sheet.eachRow((row, rowIndex) => {
      if (rowIndex === 1) return; // encabezado

      const buildingName = this.cellStr(row.getCell(OPENING_BALANCE_COL.BUILDING)) || undefined;
      const unitNumber   = this.cellStr(row.getCell(OPENING_BALANCE_COL.UNIT));
      const carteraRaw   = row.getCell(OPENING_BALANCE_COL.CARTERA).value;
      const favorRaw     = row.getCell(OPENING_BALANCE_COL.FAVOR).value;

      // Fila totalmente vacía → ignorar
      if (!unitNumber && carteraRaw == null && favorRaw == null) return;

      rows.push({ rowIndex, buildingName, unitNumber, carteraRaw, favorRaw });
    });

    return rows;
  }

  // ── Helpers ────────────────────────────────────────────────────────────────

  private assertValidPeriod(period: string): void {
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(period)) {
      throw new CustomError({
        message: 'El período debe tener el formato YYYY-MM (ej. 2025-03)',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: FinanceErrorCode.PERIOD_INVALID_FORMAT,
      });
    }
  }

  /**
   * Parsea un monto tolerando formato colombiano (1.234.567,89), formato inglés
   * (1,234,567.89), símbolos de moneda y espacios. Devuelve null si está vacío.
   */
  private parseAmount(raw: unknown): number | null {
    if (raw === null || raw === undefined || raw === '') return null;
    if (typeof raw === 'number') return raw;
    if (typeof raw === 'object' && raw !== null && 'result' in (raw as any)) {
      // Celda con fórmula: usar el resultado calculado
      const r = (raw as any).result;
      if (typeof r === 'number') return r;
      raw = r;
    }

    let s = String(raw).trim().replace(/[^0-9.,\-]/g, '');
    if (!s) return null;

    const hasComma = s.includes(',');
    const hasDot   = s.includes('.');

    if (hasComma && hasDot) {
      // El último separador que aparece es el decimal.
      if (s.lastIndexOf(',') > s.lastIndexOf('.')) {
        s = s.replace(/\./g, '').replace(',', '.'); // coma decimal (CO)
      } else {
        s = s.replace(/,/g, '');                    // punto decimal (EN)
      }
    } else if (hasComma) {
      const parts = s.split(',');
      // "1234,56" → decimal ; "1,234" o "1,234,567" → miles
      s = parts.length === 2 && parts[1].length <= 2
        ? parts[0] + '.' + parts[1]
        : s.replace(/,/g, '');
    } else if (hasDot) {
      const parts = s.split('.');
      // "1.234" o "1.234.567" → miles ; "1234.56" → decimal
      if (parts.length > 2) {
        s = s.replace(/\./g, '');
      } else if (parts[1]?.length === 3 && parts[0].length <= 3) {
        s = s.replace(/\./g, '');
      }
    }

    const n = Number(s);
    return isNaN(n) ? null : n;
  }

  private cellStr(cell: ExcelJS.Cell): string {
    const val = cell?.value;
    if (val === null || val === undefined) return '';
    if (typeof val === 'object' && 'text' in val) return String((val as any).text).trim();
    if (typeof val === 'object' && 'result' in val) return String((val as any).result ?? '').trim();
    if (val instanceof Date) return val.toISOString();
    return String(val).trim();
  }

  private async loadWorkbook(filePath: string): Promise<ExcelJS.Workbook> {
    let ExcelJSModule: typeof import('exceljs');
    try {
      ExcelJSModule = await import('exceljs');
    } catch {
      throw new BadRequestException('El módulo exceljs no está instalado. Ejecuta: yarn add exceljs');
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

function round2(n: number): number {
  return Math.round(n * 100) / 100;
}
