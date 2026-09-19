import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { DataSource, In, ObjectLiteral, Repository } from 'typeorm';
import { ColumnMetadata } from 'typeorm/metadata/ColumnMetadata';
import * as ExcelJS from 'exceljs';
import JSZip from 'jszip';

import {
  DATA_EXPORT_MODULES,
  ExportEntitySpec,
  ExportModuleSpec,
  findExportModule,
} from './data-export.registry';
import {
  asText,
  cellValue,
  exportableColumns,
  headerFor,
  isCategoryColumn,
  isMoneyColumn,
  toNumber,
} from './data-export.columns';
import { DataExportModuleInfo } from './dto/data-export-module-info.response';
import { DataExportHistoryEntry } from './dto/data-export-history-entry.response';
import { ResidentialComplexService } from '../residential-complex/services/residential-complex.service';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { ComplexModule } from '../residential-complex/enums/complex-module.enum';
import { User } from '../users/entities/user.entity';
import { Resident } from '../residents/entities/resident.entity';
import { VotingBallot } from '../voting/entities/voting-ballot.entity';
import { VotingQuestion } from '../voting/entities/voting-question.entity';
import { VotingMeeting } from '../voting/entities/voting-meeting.entity';
import { VotingOption } from '../voting/entities/voting-option.entity';
import { VoteSecrecy } from '../voting/enums/voting.enums';
import { AuditService } from '../audit/services/audit.service';
import { AuditLog } from '../audit/entities/audit-log.entity';
import { AuditAction } from '../audit/enums/audit-action.enum';
import { AuditEntityType } from '../audit/enums/audit-entity-type.enum';
import { JwtAccessPayload } from '../shared/interfaces/jwt-payload.interface';
import { CustomError } from '../shared/utils/errors.utils';
import { GeneralErrorCode } from '../shared/constans/error-codes.constants';

/** Rango de fechas del respaldo. Solo recorta los registros que ocurren en el tiempo. */
export interface ExportRange {
  from?: Date;
  /** Exclusivo: el día siguiente al "hasta" que eligió la administración. */
  to?: Date;
  fromLabel?: string;
  toLabel?: string;
}

export interface ExportFile {
  filename: string;
  contentType: string;
  buffer: Buffer;
}

const XLSX_TYPE =
  'application/vnd.openxmlformats-officedocument.spreadsheetml.sheet';

/**
 * Tope por hoja. Excel admite algo más de un millón de filas, pero la
 * auditoría o las notificaciones de años pueden pasar de ahí y tumbar la
 * descarga por memoria. Si se alcanza, el resumen lo dice y la administración
 * baja por rangos.
 */
const MAX_ROWS_PER_SHEET = 200_000;

const DATE_FORMAT = 'yyyy-mm-dd hh:mm';
const DAY = /^\d{4}-\d{2}-\d{2}$/;

/** Datos para convertir ids en algo que una persona reconozca. */
interface LabelContext {
  complexId: string;
  units: Map<string, string>;
  buildings: Map<string, string>;
  users: Map<string, UserLabel>;
  residents: Map<string, string>;
}

interface UserLabel {
  name: string;
  email: string | null;
  phoneNumber: string | null;
  identity: string | null;
  identityType: string | null;
}

/** Una columna del Excel: dato de la entidad o etiqueta derivada de él. */
interface SheetColumn {
  header: string;
  width: number;
  isDate: boolean;
  value: (raw: Record<string, unknown>) => unknown;
}

interface SummarySection {
  title: string;
  lines: (string | number)[][];
}

@Injectable()
export class DataExportService {
  private readonly logger = new Logger(DataExportService.name);

  constructor(
    private readonly dataSource: DataSource,
    private readonly complexService: ResidentialComplexService,
    private readonly auditService: AuditService,
    @InjectRepository(AuditLog)
    private readonly auditRepo: Repository<AuditLog>,
  ) {}

  // ================================================================
  // Consultas para la pantalla
  // ================================================================

  async availableModules(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<DataExportModuleInfo[]> {
    const complex = await this.complexService.findById(complexId, currentUser);
    const enabled = complex.enabledModules ?? [];
    return DATA_EXPORT_MODULES.map((spec) => ({
      module: spec.module,
      label: spec.label,
      // Lista vacía = todos habilitados, igual que en el resto de la plataforma.
      enabled: enabled.length === 0 || enabled.includes(spec.module),
    }));
  }

  async history(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<DataExportHistoryEntry[]> {
    await this.complexService.findById(complexId, currentUser);
    const logs = await this.auditRepo.find({
      where: { complexId, entityType: AuditEntityType.DataExport },
      order: { createdAt: 'DESC' },
      take: 20,
    });
    return logs.map((log) => {
      const detail = (log.newValue ?? {}) as {
        kind?: string;
        modules?: string[];
        from?: string | null;
        to?: string | null;
      };
      return {
        id: log.id,
        createdAt: log.createdAt,
        performedByName: log.performedByName ?? null,
        kind: detail.kind ?? 'module',
        modules: detail.modules ?? [],
        from: detail.from ?? null,
        to: detail.to ?? null,
      };
    });
  }

  // ================================================================
  // Descargas
  // ================================================================

  parseRange(from?: string, to?: string): ExportRange {
    for (const [label, value] of [
      ['desde', from],
      ['hasta', to],
    ] as const) {
      if (value && !DAY.test(value)) {
        throw new CustomError({
          message: `La fecha "${label}" debe tener el formato AAAA-MM-DD`,
          statusCode: HttpStatus.BAD_REQUEST,
          errorCode: GeneralErrorCode.BAD_REQUEST,
        });
      }
    }
    // Días en hora de Bogotá; el "hasta" incluye todo ese día.
    const range: ExportRange = { fromLabel: from, toLabel: to };
    if (from) range.from = new Date(`${from}T00:00:00-05:00`);
    if (to) {
      const end = new Date(`${to}T00:00:00-05:00`);
      range.to = new Date(end.getTime() + 24 * 60 * 60 * 1000);
    }
    if (range.from && range.to && range.from >= range.to) {
      throw new CustomError({
        message: 'La fecha "desde" debe ser anterior o igual a "hasta"',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }
    return range;
  }

  async exportModule(
    complexId: string,
    module: string,
    range: ExportRange,
    currentUser: JwtAccessPayload,
  ): Promise<ExportFile> {
    const spec = this.requireModule(module);
    const complex = await this.complexService.findById(complexId, currentUser);
    const context = this.baseContext(complex);

    const buffer = await this.buildWorkbook(spec, complex, range, context);
    this.audit(complex, currentUser, 'module', [spec.module], range);

    return {
      filename: `${complex.slug}-${spec.module.toLowerCase()}-${this.today()}.xlsx`,
      contentType: XLSX_TYPE,
      buffer,
    };
  }

  async exportBackup(
    complexId: string,
    modules: string[],
    range: ExportRange,
    currentUser: JwtAccessPayload,
  ): Promise<ExportFile> {
    const specs = modules.length
      ? modules.map((module) => this.requireModule(module))
      : DATA_EXPORT_MODULES;
    const complex = await this.complexService.findById(complexId, currentUser);
    const context = this.baseContext(complex);

    const zip = new JSZip();
    for (const spec of specs) {
      const buffer = await this.buildWorkbook(spec, complex, range, context);
      zip.file(`${spec.module.toLowerCase()}.xlsx`, buffer);
    }
    zip.file('LEEME.txt', this.readme(complex, specs, range, currentUser));

    const buffer = await zip.generateAsync({
      type: 'nodebuffer',
      compression: 'DEFLATE',
    });
    this.audit(
      complex,
      currentUser,
      'backup',
      specs.map((spec) => spec.module),
      range,
    );

    return {
      filename: `${complex.slug}-respaldo-${this.today()}.zip`,
      contentType: 'application/zip',
      buffer,
    };
  }

  // ================================================================
  // Libro de Excel de un módulo
  // ================================================================

  private async buildWorkbook(
    spec: ExportModuleSpec,
    complex: ResidentialComplex,
    range: ExportRange,
    context: LabelContext,
  ): Promise<Buffer> {
    const workbook = new ExcelJS.Workbook();
    workbook.creator = 'EntryLink';
    workbook.created = new Date();

    // El resumen va primero, pero se llena al final: sus cifras salen de las
    // mismas filas que se escriben en las hojas.
    const summarySheet = workbook.addWorksheet('Resumen');
    const sections: SummarySection[] = [];
    const usedNames = new Set<string>(['Resumen']);

    for (const entitySpec of spec.entities) {
      const { rows, truncated } = await this.loadRows(
        entitySpec,
        complex.id,
        range,
      );
      await this.resolveLabels(entitySpec, rows, context);
      const sheetName = this.uniqueSheetName(entitySpec.sheet, usedNames);
      this.writeEntitySheet(workbook, sheetName, entitySpec, rows, context);
      sections.push(
        this.entitySummary(sheetName, entitySpec, rows, range, truncated),
      );
    }

    if (spec.module === ComplexModule.VOTACIONES) {
      sections.push(
        ...(await this.writeVotingSheets(workbook, complex.id, range, context)),
      );
    }

    this.writeSummary(summarySheet, spec, complex, range, sections);

    const data = await workbook.xlsx.writeBuffer();
    return Buffer.from(data);
  }

  /** Filas crudas de la entidad, recortadas al complejo y al rango. */
  private async loadRows(
    spec: ExportEntitySpec,
    complexId: string,
    range: ExportRange,
  ): Promise<{ rows: Record<string, unknown>[]; truncated: boolean }> {
    const repo: Repository<ObjectLiteral> = this.dataSource.getRepository(
      spec.entity,
    );
    const metadata = repo.metadata;
    const qb = repo.createQueryBuilder('e');

    if (spec.parent) {
      const parents = await this.dataSource
        .getRepository(spec.parent.entity)
        .createQueryBuilder('p')
        .select('p.id', 'id')
        .where('p.complexId = :complexId', { complexId })
        .getRawMany<{ id: string }>();
      if (parents.length === 0) return { rows: [], truncated: false };
      qb.where(`e.${spec.parent.foreignKey} IN (:...parentIds)`, {
        parentIds: parents.map((parent) => parent.id),
      });
    } else {
      qb.where('e.complexId = :complexId', { complexId });
    }

    const createdAt = metadata.createDateColumn?.propertyName;
    if (spec.transactional && createdAt) {
      if (range.from)
        qb.andWhere(`e.${createdAt} >= :from`, { from: range.from });
      if (range.to) qb.andWhere(`e.${createdAt} < :to`, { to: range.to });
    }
    if (createdAt) qb.orderBy(`e.${createdAt}`, 'ASC');

    const raw = await qb
      .limit(MAX_ROWS_PER_SHEET + 1)
      .getRawMany<Record<string, unknown>>();
    const truncated = raw.length > MAX_ROWS_PER_SHEET;
    const rows = (truncated ? raw.slice(0, MAX_ROWS_PER_SHEET) : raw).map(
      (row) => this.byProperty(row, metadata.columns),
    );
    return { rows, truncated };
  }

  /** getRawMany devuelve `e_<columna_en_bd>`; se pasa a nombre de propiedad. */
  private byProperty(
    raw: Record<string, unknown>,
    columns: ColumnMetadata[],
  ): Record<string, unknown> {
    const row: Record<string, unknown> = {};
    for (const column of columns) {
      const key = `e_${column.databaseName}`;
      if (key in raw) row[column.propertyName] = raw[key];
    }
    return row;
  }

  private writeEntitySheet(
    workbook: ExcelJS.Workbook,
    sheetName: string,
    spec: ExportEntitySpec,
    rows: Record<string, unknown>[],
    context: LabelContext,
  ): void {
    const metadata = this.dataSource.getMetadata(spec.entity);
    const columns = this.sheetColumns(
      exportableColumns(metadata),
      spec,
      context,
    );

    const sheet = workbook.addWorksheet(sheetName, {
      views: [{ state: 'frozen', ySplit: 1 }],
    });
    sheet.columns = columns.map((column) => ({
      header: column.header,
      width: column.width,
    }));
    sheet.getRow(1).font = { bold: true };

    for (const raw of rows) {
      sheet.addRow(columns.map((column) => cellValue(column.value(raw))));
    }

    columns.forEach((column, index) => {
      if (column.isDate) sheet.getColumn(index + 1).numFmt = DATE_FORMAT;
    });
    if (columns.length > 0) {
      sheet.autoFilter = {
        from: { row: 1, column: 1 },
        to: { row: 1, column: columns.length },
      };
    }
  }

  /**
   * Columnas de la hoja: cada columna de la entidad y, al lado de los ids de
   * unidad, torre, usuario o residente, su nombre legible. Un respaldo lleno
   * de UUIDs no se puede leer sin la base de datos, que es justo lo que falta
   * cuando hace falta el respaldo.
   */
  private sheetColumns(
    entityColumns: ColumnMetadata[],
    spec: ExportEntitySpec,
    context: LabelContext,
  ): SheetColumn[] {
    const columns: SheetColumn[] = [];

    for (const column of entityColumns) {
      const property = column.propertyName;
      const isDate =
        column.type === Date ||
        [
          'timestamp',
          'timestamptz',
          'date',
          'timestamp with time zone',
        ].includes(String(column.type).toLowerCase());
      columns.push({
        header: headerFor(property),
        width: isDate
          ? 18
          : Math.min(Math.max(headerFor(property).length + 2, 12), 40),
        isDate,
        value: (raw) => raw[property],
      });

      const label = this.labelResolver(property, context);
      if (label) {
        columns.push({
          header: label.header,
          width: 28,
          isDate: false,
          value: (raw) => label.resolve(raw[property]),
        });
      }
    }

    if (spec.userDetails) {
      const property = spec.userDetails;
      const detail =
        (pick: (user: UserLabel) => string | null) =>
        (raw: Record<string, unknown>) => {
          const user = context.users.get(asText(raw[property]));
          return user ? pick(user) : null;
        };
      columns.push(
        {
          header: 'Correo',
          width: 28,
          isDate: false,
          value: detail((u) => u.email),
        },
        {
          header: 'Teléfono',
          width: 16,
          isDate: false,
          value: detail((u) => u.phoneNumber),
        },
        {
          header: 'Tipo de documento',
          width: 16,
          isDate: false,
          value: detail((u) => u.identityType),
        },
        {
          header: 'Documento',
          width: 16,
          isDate: false,
          value: detail((u) => u.identity),
        },
      );
    }

    return columns;
  }

  private labelResolver(
    property: string,
    context: LabelContext,
  ): { header: string; resolve: (value: unknown) => string | null } | null {
    const header = headerFor(property).replace(/ \(id\)$/, '');
    const labelHeader = header === property ? `${property} (nombre)` : header;
    const lookup = (map: Map<string, string>) => (value: unknown) =>
      value ? (map.get(asText(value)) ?? null) : null;

    if (/(^u|U)nitId$/.test(property)) {
      return { header: labelHeader, resolve: lookup(context.units) };
    }
    if (/(^b|B)uildingId$/.test(property)) {
      return { header: labelHeader, resolve: lookup(context.buildings) };
    }
    if (/(^r|R)esidentId$/.test(property)) {
      return { header: labelHeader, resolve: lookup(context.residents) };
    }
    if (/((^u|U)serId|ById|^supervisorId)$/.test(property)) {
      return {
        header: labelHeader,
        resolve: (value) => {
          if (!value) return null;
          // La cuenta del complejo firma con su propio id, no con un usuario.
          if (value === context.complexId) return 'Administración del complejo';
          return context.users.get(asText(value))?.name ?? null;
        },
      };
    }
    return null;
  }

  /** Carga en el contexto los usuarios y residentes que mencionan las filas. */
  private async resolveLabels(
    spec: ExportEntitySpec,
    rows: Record<string, unknown>[],
    context: LabelContext,
  ): Promise<void> {
    if (rows.length === 0) return;
    const properties = Object.keys(rows[0]);
    const userProps = properties.filter((p) =>
      /((^u|U)serId|ById|^supervisorId)$/.test(p),
    );
    const residentProps = properties.filter((p) => /(^r|R)esidentId$/.test(p));

    const residentIds = new Set<string>();
    for (const row of rows) {
      for (const p of residentProps)
        if (row[p]) residentIds.add(asText(row[p]));
    }
    const missingResidents = [...residentIds].filter(
      (id) => !context.residents.has(id),
    );
    const residentUsers = new Map<string, string>();
    if (missingResidents.length) {
      const residents = await this.dataSource.getRepository(Resident).find({
        where: { id: In(missingResidents) },
        select: ['id', 'userId'],
        withDeleted: true,
      });
      for (const resident of residents)
        residentUsers.set(resident.id, resident.userId);
    }

    const userIds = new Set<string>(residentUsers.values());
    for (const row of rows) {
      for (const p of userProps) if (row[p]) userIds.add(asText(row[p]));
      if (spec.userDetails && row[spec.userDetails]) {
        userIds.add(asText(row[spec.userDetails]));
      }
    }
    userIds.delete(context.complexId);
    const missingUsers = [...userIds].filter((id) => !context.users.has(id));
    if (missingUsers.length) {
      const users = await this.dataSource.getRepository(User).find({
        where: { id: In(missingUsers) },
        select: [
          'id',
          'name',
          'lastName',
          'email',
          'phoneNumber',
          'identity',
          'identityType',
        ],
        withDeleted: true,
      });
      for (const user of users) {
        context.users.set(user.id, {
          name: `${user.name ?? ''} ${user.lastName ?? ''}`.trim(),
          email: user.email ?? null,
          phoneNumber: user.phoneNumber ?? null,
          identity: user.identity ?? null,
          identityType: user.identityType ?? null,
        });
      }
    }

    for (const [residentId, userId] of residentUsers) {
      context.residents.set(residentId, context.users.get(userId)?.name ?? '');
    }
  }

  // ================================================================
  // Votaciones: resultados sin exponer el voto secreto
  // ================================================================

  private async writeVotingSheets(
    workbook: ExcelJS.Workbook,
    complexId: string,
    range: ExportRange,
    context: LabelContext,
  ): Promise<SummarySection[]> {
    const results = this.dataSource
      .getRepository(VotingOption)
      .createQueryBuilder('o')
      .innerJoin(VotingQuestion, 'q', 'q.id = o.questionId')
      .innerJoin(VotingMeeting, 'm', 'm.id = q.meetingId')
      .leftJoin(VotingBallot, 'b', 'b.optionId = o.id')
      .select('m.title', 'meeting')
      .addSelect('q.position', 'position')
      .addSelect('q.text', 'question')
      .addSelect('q.secrecy', 'secrecy')
      .addSelect('o.position', 'optionPosition')
      .addSelect('o.text', 'option')
      .addSelect('COUNT(b.id)', 'votes')
      .addSelect('COALESCE(SUM(b.weight), 0)', 'weight')
      .where('q.complexId = :complexId', { complexId })
      .groupBy('m.id')
      .addGroupBy('q.id')
      .addGroupBy('o.id')
      .orderBy('m.title', 'ASC')
      .addOrderBy('q.position', 'ASC')
      .addOrderBy('o.position', 'ASC');
    if (range.from)
      results.andWhere('q.createdAt >= :from', { from: range.from });
    if (range.to) results.andWhere('q.createdAt < :to', { to: range.to });
    const resultRows = await results.getRawMany<{
      meeting: string;
      position: number;
      question: string;
      secrecy: VoteSecrecy;
      option: string;
      votes: string;
      weight: string;
    }>();

    const resultSheet = workbook.addWorksheet('Resultados');
    resultSheet.columns = [
      { header: 'Asamblea', width: 30 },
      { header: 'Pregunta', width: 8 },
      { header: 'Texto', width: 40 },
      { header: 'Voto', width: 10 },
      { header: 'Opción', width: 28 },
      { header: 'Votos', width: 10 },
      { header: 'Peso', width: 12 },
    ];
    resultSheet.getRow(1).font = { bold: true };
    for (const row of resultRows) {
      resultSheet.addRow([
        row.meeting,
        Number(row.position),
        row.question,
        row.secrecy === VoteSecrecy.SECRET ? 'Secreto' : 'Nominal',
        row.option,
        toNumber(row.votes),
        toNumber(row.weight),
      ]);
    }

    // Quién votó qué, solo donde el voto es nominal.
    const nominal = this.dataSource
      .getRepository(VotingBallot)
      .createQueryBuilder('b')
      .innerJoin(VotingQuestion, 'q', 'q.id = b.questionId')
      .innerJoin(VotingMeeting, 'm', 'm.id = q.meetingId')
      .innerJoin(VotingOption, 'o', 'o.id = b.optionId')
      .select('m.title', 'meeting')
      .addSelect('q.position', 'position')
      .addSelect('q.text', 'question')
      .addSelect('b.unitId', 'unitId')
      .addSelect('o.text', 'option')
      .addSelect('b.weight', 'weight')
      .addSelect('b.createdAt', 'votedAt')
      .where('b.complexId = :complexId', { complexId })
      .andWhere('q.secrecy = :nominal', { nominal: VoteSecrecy.NOMINAL })
      .orderBy('m.title', 'ASC')
      .addOrderBy('q.position', 'ASC');
    if (range.from)
      nominal.andWhere('q.createdAt >= :from', { from: range.from });
    if (range.to) nominal.andWhere('q.createdAt < :to', { to: range.to });
    const nominalRows = await nominal.getRawMany<{
      meeting: string;
      position: number;
      question: string;
      unitId: string | null;
      option: string;
      weight: string;
      votedAt: Date;
    }>();

    const nominalSheet = workbook.addWorksheet('Votos nominales');
    nominalSheet.columns = [
      { header: 'Asamblea', width: 30 },
      { header: 'Pregunta', width: 8 },
      { header: 'Texto', width: 40 },
      { header: 'Unidad', width: 18 },
      { header: 'Opción', width: 28 },
      { header: 'Peso', width: 12 },
      { header: 'Fecha del voto', width: 18 },
    ];
    nominalSheet.getRow(1).font = { bold: true };
    for (const row of nominalRows) {
      nominalSheet.addRow([
        row.meeting,
        Number(row.position),
        row.question,
        row.unitId ? (context.units.get(row.unitId) ?? row.unitId) : null,
        row.option,
        toNumber(row.weight),
        cellValue(row.votedAt),
      ]);
    }
    nominalSheet.getColumn(7).numFmt = DATE_FORMAT;

    return [
      {
        title: 'Resultados de votaciones',
        lines: [
          ['Opciones con resultados', resultRows.length],
          ['Votos nominales listados', nominalRows.length],
          [
            'Las preguntas de voto secreto solo aparecen con sus totales: el respaldo no dice quién votó qué.',
          ],
        ],
      },
    ];
  }

  // ================================================================
  // Resumen
  // ================================================================

  private entitySummary(
    sheetName: string,
    spec: ExportEntitySpec,
    rows: Record<string, unknown>[],
    range: ExportRange,
    truncated: boolean,
  ): SummarySection {
    const metadata = this.dataSource.getMetadata(spec.entity);
    const columns = exportableColumns(metadata);
    const lines: (string | number)[][] = [['Registros', rows.length]];

    if (truncated) {
      lines.push([
        `Se alcanzó el máximo de ${MAX_ROWS_PER_SHEET.toLocaleString('es-CO')} filas: descarga por rangos de fecha más cortos.`,
      ]);
    }

    for (const column of columns.filter(isCategoryColumn)) {
      const counts = new Map<string, number>();
      for (const row of rows) {
        const key =
          row[column.propertyName] == null
            ? '(vacío)'
            : asText(row[column.propertyName]);
        counts.set(key, (counts.get(key) ?? 0) + 1);
      }
      if (counts.size === 0 || counts.size > 30) continue;
      lines.push([]);
      lines.push([`Por ${headerFor(column.propertyName).toLowerCase()}`]);
      for (const [value, count] of [...counts].sort((a, b) => b[1] - a[1])) {
        lines.push([value, count]);
      }
    }

    for (const column of columns.filter(isMoneyColumn)) {
      const total = rows.reduce(
        (sum, row) => sum + toNumber(row[column.propertyName]),
        0,
      );
      lines.push([
        `Total ${headerFor(column.propertyName).toLowerCase()}`,
        total,
      ]);
    }

    const createdAt = metadata.createDateColumn?.propertyName;
    if (spec.transactional && createdAt && rows.length > 0) {
      const byMonth = new Map<string, number>();
      for (const row of rows) {
        const date = row[createdAt];
        if (!(date instanceof Date)) continue;
        const local = cellValue(date) as Date;
        const month = local.toISOString().slice(0, 7);
        byMonth.set(month, (byMonth.get(month) ?? 0) + 1);
      }
      lines.push([]);
      lines.push(['Por mes']);
      for (const [month, count] of [...byMonth].sort())
        lines.push([month, count]);
    }

    const scope = spec.transactional
      ? this.rangeText(range)
      : 'todos los registros vigentes';
    return { title: `${sheetName} — ${scope}`, lines };
  }

  private writeSummary(
    sheet: ExcelJS.Worksheet,
    spec: ExportModuleSpec,
    complex: ResidentialComplex,
    range: ExportRange,
    sections: SummarySection[],
  ): void {
    sheet.getColumn(1).width = 48;
    sheet.getColumn(2).width = 16;

    const title = sheet.addRow([`${spec.label} — ${complex.name}`]);
    title.font = { bold: true, size: 14 };
    sheet.addRow(['Generado', cellValue(new Date())]).getCell(2).numFmt =
      DATE_FORMAT;
    sheet.addRow(['Rango de los movimientos', this.rangeText(range)]);
    sheet.addRow([
      'Los datos maestros (unidades, residentes, mascotas…) salen completos; el rango solo recorta los registros que ocurren en el tiempo.',
    ]);

    for (const section of sections) {
      sheet.addRow([]);
      sheet.addRow([section.title]).font = { bold: true };
      for (const line of section.lines) sheet.addRow(line);
    }
  }

  // ================================================================
  // Auxiliares
  // ================================================================

  private baseContext(complex: ResidentialComplex): LabelContext {
    const buildings = new Map<string, string>();
    const units = new Map<string, string>();
    for (const building of complex.buildings ?? []) {
      buildings.set(building.id, building.name);
      for (const unit of building.units ?? []) {
        units.set(unit.id, `${building.name} - ${unit.number}`);
      }
    }
    return {
      complexId: complex.id,
      buildings,
      units,
      users: new Map(),
      residents: new Map(),
    };
  }

  private requireModule(module: string): ExportModuleSpec {
    const spec = findExportModule(module);
    if (!spec) {
      throw new CustomError({
        message: `El módulo "${module}" no tiene datos para descargar`,
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: GeneralErrorCode.BAD_REQUEST,
      });
    }
    return spec;
  }

  private uniqueSheetName(name: string, used: Set<string>): string {
    const base = name.slice(0, 31);
    let candidate = base;
    let n = 2;
    while (used.has(candidate)) candidate = `${base.slice(0, 28)} ${n++}`;
    used.add(candidate);
    return candidate;
  }

  private rangeText(range: ExportRange): string {
    if (!range.fromLabel && !range.toLabel) return 'todo el historial';
    return `${range.fromLabel ?? 'inicio'} a ${range.toLabel ?? 'hoy'}`;
  }

  private today(): string {
    return (cellValue(new Date()) as Date).toISOString().slice(0, 10);
  }

  private readme(
    complex: ResidentialComplex,
    specs: ExportModuleSpec[],
    range: ExportRange,
    currentUser: JwtAccessPayload,
  ): string {
    return [
      `Respaldo de datos — ${complex.name}`,
      `Generado: ${(cellValue(new Date()) as Date).toISOString().replace('T', ' ').slice(0, 16)} (hora de Colombia)`,
      `Por: ${currentUser.email}`,
      `Rango de los movimientos: ${this.rangeText(range)}`,
      '',
      'Un archivo de Excel por módulo. Cada uno empieza con la hoja "Resumen"',
      '(estadísticas) y sigue con una hoja por tipo de registro.',
      '',
      'Las fotos y documentos van como enlaces. Este archivo contiene datos',
      'personales de los residentes (Ley 1581 de 2012): guárdalo en un lugar',
      'seguro y no lo compartas por canales abiertos.',
      '',
      'Módulos incluidos:',
      ...specs.map(
        (spec) => `- ${spec.label} (${spec.module.toLowerCase()}.xlsx)`,
      ),
      '',
    ].join('\r\n');
  }

  private audit(
    complex: ResidentialComplex,
    currentUser: JwtAccessPayload,
    kind: 'module' | 'backup',
    modules: string[],
    range: ExportRange,
  ): void {
    void this.auditService
      .log({
        entityType: AuditEntityType.DataExport,
        entityId: complex.id,
        action: AuditAction.EXPORT,
        newValue: {
          kind,
          modules,
          from: range.fromLabel ?? null,
          to: range.toLabel ?? null,
        },
        performedById: currentUser.sub,
        performedByName: currentUser.email,
        performedByRole: currentUser.roles?.[0] ?? '',
        complexId: complex.id,
        description:
          kind === 'backup'
            ? `Descarga del respaldo completo (${modules.length} módulos)`
            : `Descarga de datos del módulo ${modules[0]}`,
      })
      .catch((error: Error) =>
        this.logger.warn(`No se pudo auditar la descarga: ${error.message}`),
      );
  }
}
