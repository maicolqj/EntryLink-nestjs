import {
  IMPORT_MAX_BYTES as MIGRATION_MAX_BYTES,
  IMPORT_MAX_ROWS as MIGRATION_MAX_ROWS,
  IMPORT_TERMINAL_STATUSES,
  IMPORT_STATUSES,
  IMPORT_TARGETS,
} from '../../../../core/database/migrations/1781011100000-CreateGrowthImports';
import {
  GrowthImportDecision,
  GrowthImportField as F,
  GrowthImportFileKind,
  GrowthImportStatus,
  GrowthImportTarget as T,
  IMPORT_TERMINAL,
} from '../imports.enums';
import {
  IMPORT_FIELDS,
  mappingProblems,
  normalizeHeader,
  suggestMapping,
} from './field-catalog';
import {
  assertZipSafe,
  cellText,
  decodeText,
  detectDelimiter,
  IMPORT_MAX_BYTES,
  IMPORT_MAX_ROWS,
  ImportFileError,
  parseCsv,
  readSpreadsheet,
} from './file-reader';
import { mappingKeyOf } from '../services/import-validation.service';
import { maskRawRow, neutralizeFormula, buildImportReport } from './report';
import {
  normalizeRow,
  parseBoolean,
  parseInteger,
  parseLocality,
} from './row-normalizer';

// exceljs se carga con import dinámico: con toda la suite en paralelo tarda.
jest.setTimeout(30_000);

const csv = (text: string) => Buffer.from(text, 'utf8');

async function xlsx(
  rows: unknown[][],
  extra?: (ws: import('exceljs').Worksheet) => void,
): Promise<Buffer> {
  const ExcelJS = await import('exceljs');
  const wb = new ExcelJS.Workbook();
  const ws = wb.addWorksheet('Datos');
  rows.forEach((r) => ws.addRow(r));
  extra?.(ws);
  wb.addWorksheet('Otra').addRow(['no', 'se', 'lee']);
  return Buffer.from(await wb.xlsx.writeBuffer());
}

describe('Importaciones: lectura de archivos', () => {
  it('los límites coinciden con los CHECK de la migración', () => {
    expect(IMPORT_MAX_BYTES).toBe(MIGRATION_MAX_BYTES);
    expect(IMPORT_MAX_ROWS).toBe(MIGRATION_MAX_ROWS);
    expect(Object.values(GrowthImportStatus).sort()).toEqual(
      [...IMPORT_STATUSES].sort(),
    );
    expect(Object.values(T).sort()).toEqual([...IMPORT_TARGETS].sort());
    expect([...IMPORT_TERMINAL].sort()).toEqual(
      [...IMPORT_TERMINAL_STATUSES].sort(),
    );
  });

  it('CSV con ; (Excel en español), comillas y saltos dentro de comillas', async () => {
    const sheet = await readSpreadsheet(
      csv(
        'Razón social;NIT;Dirección\r\n"Andes ""PH"" SAS";900123456-8;"Cra 15\n# 93-47"\r\n\r\nBeta;;\r\n',
      ),
    );
    expect(sheet.kind).toBe(GrowthImportFileKind.CSV);
    expect(sheet.headers).toEqual(['Razón social', 'NIT', 'Dirección']);
    expect(sheet.rows).toEqual([
      {
        rowNumber: 2,
        values: ['Andes "PH" SAS', '900123456-8', 'Cra 15\n# 93-47'],
      },
      { rowNumber: 4, values: ['Beta', '', ''] },
    ]);
  });

  it('detecta el separador y decodifica Windows-1252 si no es UTF-8', () => {
    expect(detectDelimiter('a,b,c\n1;2')).toBe(',');
    expect(detectDelimiter('a;b;c')).toBe(';');
    expect(detectDelimiter('a\tb')).toBe('\t');
    const ansi = Buffer.from([0x4e, 0x69, 0xf1, 0x6f]); // "Niño" en 1252
    expect(decodeText(ansi)).toBe('Niño');
    expect(decodeText(Buffer.from('﻿hola', 'utf8'))).toBe('hola');
  });

  it('rechaza vacío, binario, demasiadas filas o columnas y archivos grandes', async () => {
    const code = async (buf: Buffer) =>
      readSpreadsheet(buf).then(
        () => 'OK',
        (e: ImportFileError) => e.code,
      );
    expect(await code(Buffer.alloc(0))).toBe('EMPTY');
    expect(await code(Buffer.from([0xd0, 0xcf, 0x11, 0xe0, 0, 0, 0]))).toBe(
      'UNSUPPORTED',
    );
    expect(await code(csv('a\n'))).toBe('NO_ROWS');
    expect(await code(csv(`a\n${'x\n'.repeat(IMPORT_MAX_ROWS + 1)}`))).toBe(
      'TOO_MANY_ROWS',
    );
    expect(await code(csv(`a\n${'x\n'.repeat(IMPORT_MAX_ROWS)}`))).toBe('OK');
    expect(
      await code(
        csv(`${Array.from({ length: 101 }, (_, i) => `c${i}`).join(',')}\n1`),
      ),
    ).toBe('TOO_MANY_COLUMNS');
    expect(await code(Buffer.alloc(IMPORT_MAX_BYTES + 1, 0x61))).toBe(
      'TOO_LARGE',
    );
  });

  it('XLSX: solo la primera hoja; fórmulas por su valor guardado, nunca evaluadas', async () => {
    const buffer = await xlsx([['Nombre', 'NIT', 'Unidades']], (ws) => {
      ws.addRow(['Los Pinos', 900123456, 120]);
      ws.addRow([
        { richText: [{ text: 'Torre ' }, { text: 'Azul' }] },
        { formula: 'HYPERLINK("http://malo")', result: 'texto' },
        { formula: '1+1' },
      ]);
    });
    const sheet = await readSpreadsheet(buffer);
    expect(sheet.kind).toBe(GrowthImportFileKind.XLSX);
    expect(sheet.headers).toEqual(['Nombre', 'NIT', 'Unidades']);
    expect(sheet.rows.map((r) => r.values)).toEqual([
      ['Los Pinos', '900123456', '120'],
      ['Torre Azul', 'texto', ''],
    ]);
  });

  it('XLSX: bomba zip (tamaño descomprimido declarado) y zip dañado', async () => {
    const buffer = await xlsx([['a'], ['b']]);
    expect(() => assertZipSafe(buffer)).not.toThrow();
    // Infla el tamaño descomprimido declarado de la primera entrada del directorio central.
    const bomb = Buffer.from(buffer);
    const cen = bomb.indexOf(Buffer.from([0x50, 0x4b, 0x01, 0x02]));
    bomb.writeUInt32LE(60 * 1024 * 1024, cen + 24);
    expect(() => assertZipSafe(bomb)).toThrow(
      expect.objectContaining({ code: 'ZIP_BOMB' }),
    );
    const cut = Buffer.concat([
      Buffer.from([0x50, 0x4b, 0x03, 0x04]),
      Buffer.alloc(40),
    ]);
    expect(() => assertZipSafe(cut)).toThrow(
      expect.objectContaining({ code: 'CORRUPT' }),
    );
  });

  it('cellText: fechas, números grandes y errores', () => {
    expect(cellText(new Date('2026-10-31T05:00:00Z'))).toBe('2026-10-31');
    expect(cellText(3001234567)).toBe('3001234567');
    expect(cellText({ error: '#REF!' })).toBe('');
    expect(cellText({ text: 'enlace', hyperlink: 'https://x.co' })).toBe(
      'enlace',
    );
  });

  it('parseCsv conserva los números de fila del archivo', () => {
    expect(parseCsv('a\n1\n\n2', ',').map((r) => r.rowNumber)).toEqual([
      1, 2, 3, 4,
    ]);
  });
});

describe('Importaciones: mapeo', () => {
  it('sugiere por encabezado sin tildes ni mayúsculas, un campo por columna', () => {
    expect(normalizeHeader('  Razón Social ')).toBe('razon social');
    expect(
      suggestMapping(T.ORGANIZATIONS, [
        'RAZÓN SOCIAL',
        'Nit',
        'Correo electrónico',
        'Celular',
        'Nombre',
      ]),
    ).toEqual([
      { column: 0, field: F.LEGAL_NAME },
      { column: 1, field: F.NIT },
      { column: 2, field: F.EMAIL },
      { column: 3, field: F.PHONE },
    ]);
  });

  it('valida campos obligatorios, repetidos, ajenos y columnas inexistentes', () => {
    expect(
      mappingProblems(T.PEOPLE, 2, [{ column: 0, field: F.FULL_NAME }]),
    ).toEqual([]);
    const problems = mappingProblems(T.PEOPLE, 2, [
      { column: 0, field: F.EMAIL },
      { column: 1, field: F.EMAIL },
      { column: 5, field: F.NIT },
    ]);
    expect(problems.join(' | ')).toMatch(/dos columnas/);
    expect(problems.join(' | ')).toMatch(/no existe/);
    expect(problems.join(' | ')).toMatch(/no aplica/);
    expect(problems.join(' | ')).toMatch(/obligatorio/);
  });

  it('cada destino tiene exactamente un campo obligatorio (el nombre)', () => {
    for (const target of Object.values(T)) {
      expect(IMPORT_FIELDS[target].filter((d) => d.required)).toHaveLength(1);
    }
  });
});

describe('Importaciones: normalización por fila', () => {
  const orgMapping = [
    { column: 0, field: F.LEGAL_NAME },
    { column: 1, field: F.NIT },
    { column: 2, field: F.EMAIL },
    { column: 3, field: F.PHONE },
    { column: 4, field: F.WEBSITE },
    { column: 5, field: F.LOCALITY },
    { column: 6, field: F.ESTIMATED_PROPERTIES },
    { column: 7, field: F.CITY },
  ];

  it('fila válida: valores para el servicio y claves normalizadas', () => {
    const r = normalizeRow(
      T.ORGANIZATIONS,
      [
        'Andes SAS',
        '900.123.456-8',
        'Ventas@Andes.co',
        '300 123 4567',
        'www.andes.co',
        'Ciudad Bolívar',
        '1.200',
        'Bogotá D.C.',
      ],
      orgMapping,
    );
    expect(r.errors).toEqual([]);
    expect(r.values).toMatchObject({
      legalName: 'Andes SAS',
      nit: '900.123.456-8',
      locality: 'CIUDAD_BOLIVAR',
      estimatedProperties: 1200,
    });
    expect(r.keys).toEqual({
      nit: '900123456',
      email: 'ventas@andes.co',
      phone: '+573001234567',
      domain: 'andes.co',
    });
  });

  it('errores por campo sin copiar el valor', () => {
    const r = normalizeRow(
      T.ORGANIZATIONS,
      [
        '',
        '900123456-1',
        'no-es-correo',
        '123',
        'nada',
        'Narnia',
        '2,5',
        'Medellín',
      ],
      orgMapping,
    );
    expect(r.errors).toEqual(
      expect.arrayContaining([
        { field: F.NIT, code: 'NIT_CHECK_DIGIT' },
        { field: F.EMAIL, code: 'INVALID_EMAIL' },
        { field: F.PHONE, code: 'INVALID_PHONE' },
        { field: F.WEBSITE, code: 'INVALID_WEBSITE' },
        { field: F.LOCALITY, code: 'INVALID_LOCALITY' },
        { field: F.ESTIMATED_PROPERTIES, code: 'INVALID_NUMBER' },
        { field: F.LEGAL_NAME, code: 'REQUIRED' },
      ]),
    );
    expect(JSON.stringify(r.errors)).not.toMatch(/no-es-correo|Narnia/);
  });

  it('la localidad solo aplica a Bogotá; el dominio genérico no es clave de duplicado', () => {
    const r = normalizeRow(
      T.ORGANIZATIONS,
      ['Andes', '', '', '', 'gmail.com', 'Suba', '', 'Medellín'],
      orgMapping,
    );
    expect(r.errors).toEqual([
      { field: F.LOCALITY, code: 'LOCALITY_OUTSIDE_BOGOTA' },
    ]);
    expect(r.keys.domain).toBeUndefined();
  });

  it('copropiedades: matrícula, dirección de Bogotá y opciones', () => {
    const r = normalizeRow(
      T.PROPERTIES,
      [
        'Conjunto Los Pinos',
        '50C-123 4567',
        'Cra. 15 # 93-47',
        'residencial',
        'Apartamentos',
        '0',
      ],
      [
        { column: 0, field: F.NAME },
        { column: 1, field: F.REAL_ESTATE_REGISTRATION },
        { column: 2, field: F.ADDRESS },
        { column: 3, field: F.PH_TYPE },
        { column: 4, field: F.BUILDING_KIND },
        { column: 5, field: F.ESTIMATED_UNITS },
      ],
    );
    expect(r.keys).toEqual({
      registration: '50C1234567',
      address: 'KR 15 93 47',
    });
    expect(r.values).toMatchObject({
      phType: 'RESIDENCIAL',
      buildingKind: 'CONJUNTO_APARTAMENTOS',
    });
    // Una copropiedad tiene al menos una unidad.
    expect(r.errors).toEqual([
      { field: F.ESTIMATED_UNITS, code: 'INVALID_NUMBER' },
    ]);
  });

  it('auxiliares', () => {
    expect(parseLocality('11')).toBe('SUBA');
    expect(parseLocality('los mártires')).toBe('LOS_MARTIRES');
    expect(parseLocality('Antonio Nariño')).toBe('ANTONIO_NARINO');
    expect(parseLocality('21')).toBeNull();
    expect(parseBoolean('Sí')).toBe(true);
    expect(parseBoolean('no')).toBe(false);
    expect(parseBoolean('quizá')).toBeNull();
    expect(parseInteger('1,200')).toBe(1200);
    expect(parseInteger('12.5')).toBeNull();
  });
});

describe('Importaciones: informe y enmascarado', () => {
  it('neutraliza fórmulas al exportar', () => {
    for (const v of ['=1+1', '+57', '-2', '@SUM(A1)', '\tx', '\rx']) {
      expect(neutralizeFormula(v)).toBe(`'${v}`);
    }
    expect(neutralizeFormula('Andes')).toBe('Andes');
  });

  it('enmascara correos y teléfonos por valor, no por columna', () => {
    expect(
      maskRawRow(['Ana', 'ana@andes.co', '3001234567', '900123456']),
    ).toEqual(['Ana', 'a***@andes.co', '*** *** **67', '900123456']);
  });

  it('el informe XLSX no deja fórmulas vivas', async () => {
    const buffer = await buildImportReport(
      ['Nombre'],
      [{ label: 'Lote', value: 'x' }],
      [
        {
          rowNumber: 2,
          decision: GrowthImportDecision.SKIP,
          result: null,
          issues: '',
          raw: ['=HYPERLINK("http://malo")'],
        },
      ],
    );
    const ExcelJS = await import('exceljs');
    const wb = new ExcelJS.Workbook();
    await wb.xlsx.load(buffer as unknown as ArrayBuffer);
    const cell = wb.getWorksheet('Filas').getRow(2).getCell(5);
    expect(cell.formula).toBeUndefined();
    expect(cell.value).toBe(`'=HYPERLINK("http://malo")`);
  });
});

describe('Importaciones: huella del mapeo', () => {
  it('no depende del orden de las claves (jsonb las reordena al guardar)', () => {
    const saved = JSON.parse('[{"field":"legalName","column":0}]') as Array<{
      column: number;
      field: F;
    }>;
    expect(
      mappingKeyOf({ columnMapping: saved, personChannelClass: null }),
    ).toBe(
      mappingKeyOf({
        columnMapping: [{ column: 0, field: F.LEGAL_NAME }],
        personChannelClass: null,
      }),
    );
    expect(
      mappingKeyOf({ columnMapping: [{ column: 1, field: F.LEGAL_NAME }] }),
    ).not.toBe(
      mappingKeyOf({ columnMapping: [{ column: 0, field: F.LEGAL_NAME }] }),
    );
  });
});
