import { join } from 'path';
import { DataSource, EntityMetadata, ObjectLiteral } from 'typeorm';
import * as ExcelJS from 'exceljs';

import { DataExportService } from './data-export.service';
import { Resident } from '../residents/entities/resident.entity';
import { User } from '../users/entities/user.entity';
import { ValidRoles } from '../roles/enums/valid-roles';
import { VoteSecrecy } from '../voting/enums/voting.enums';
import { AuditAction } from '../audit/enums/audit-action.enum';
import { JwtAccessPayload } from '../shared/interfaces/jwt-payload.interface';

/**
 * Se arma el Excel de verdad —metadata real de TypeORM, exceljs real— con un
 * repositorio de mentira, y se vuelve a leer. Lo que importa de un respaldo es
 * lo que queda en el archivo.
 */
describe('DataExportService', () => {
  let metadataSource: DataSource;

  beforeAll(async () => {
    metadataSource = new DataSource({
      type: 'postgres',
      entities: [join(__dirname, '../**/*.entity.{ts,js}')],
    });
    await (
      metadataSource as unknown as { buildMetadatas: () => Promise<void> }
    ).buildMetadatas();
  });

  const admin = {
    sub: 'complex-1',
    email: 'admin@conjunto.com',
    roles: [ValidRoles.COMPLEX_ROL],
    complexId: 'complex-1',
  } as JwtAccessPayload;

  /** Fila cruda como la devuelve getRawMany: `e_<columna_en_bd>`. */
  const rawRow = (
    metadata: EntityMetadata,
    values: Record<string, unknown>,
  ) => {
    const raw: Record<string, unknown> = {};
    for (const [property, value] of Object.entries(values)) {
      const column = metadata.findColumnWithPropertyName(property);
      if (column) raw[`e_${column.databaseName}`] = value;
    }
    return raw;
  };

  const build = (rowsByEntity: Map<unknown, Record<string, unknown>[]>) => {
    const whereCalls: [string, unknown][] = [];
    const queryBuilder = (rows: Record<string, unknown>[]) => {
      const qb: Record<string, jest.Mock> = {};
      for (const method of [
        'select',
        'addSelect',
        'where',
        'innerJoin',
        'leftJoin',
        'groupBy',
        'addGroupBy',
        'orderBy',
        'addOrderBy',
        'limit',
      ]) {
        qb[method] = jest.fn(() => qb);
      }
      qb.andWhere = jest.fn((sql: string, params: unknown) => {
        whereCalls.push([sql, params]);
        return qb;
      });
      qb.getRawMany = jest.fn(() => Promise.resolve(rows));
      return qb;
    };

    const dataSource = {
      getMetadata: (target: unknown) =>
        metadataSource.getMetadata(target as new () => ObjectLiteral),
      getRepository: (target: unknown) => ({
        metadata: metadataSource.getMetadata(target as new () => ObjectLiteral),
        createQueryBuilder: () => queryBuilder(rowsByEntity.get(target) ?? []),
        find: jest.fn(() =>
          Promise.resolve(
            target === User
              ? [
                  {
                    id: 'user-1',
                    name: 'ANA',
                    lastName: 'GÓMEZ',
                    email: 'ana@correo.com',
                    phoneNumber: '3001234567',
                    identity: '123456',
                    identityType: 'CC',
                  },
                ]
              : [],
          ),
        ),
      }),
    };

    const complexService = {
      findById: jest.fn(() =>
        Promise.resolve({
          id: 'complex-1',
          name: 'Conjunto Prueba',
          slug: 'conjunto-prueba',
          enabledModules: [],
          buildings: [
            {
              id: 'b-1',
              name: 'Torre 1',
              units: [{ id: 'unit-1', number: '101' }],
            },
          ],
        }),
      ),
    };
    const auditService = { log: jest.fn(() => Promise.resolve()) };

    const service = new DataExportService(
      dataSource as never,
      complexService as never,
      auditService as never,
      { find: jest.fn() } as never,
    );
    return { service, auditService, whereCalls };
  };

  const read = async (buffer: Buffer) => {
    const workbook = new ExcelJS.Workbook();
    await workbook.xlsx.load(buffer as unknown as ArrayBuffer);
    return workbook;
  };

  const sheetOf = (workbook: ExcelJS.Workbook, name: string) => {
    const sheet = workbook.getWorksheet(name);
    if (!sheet) throw new Error(`Falta la hoja ${name}`);
    return sheet;
  };

  const rowValues = (sheet: ExcelJS.Worksheet, n: number) =>
    (sheet.getRow(n).values as unknown[]).slice(1);

  it('el Excel de residentes trae la unidad y los datos de contacto legibles', async () => {
    const metadata = metadataSource.getMetadata(Resident);
    const rows = new Map<unknown, Record<string, unknown>[]>([
      [
        Resident,
        [
          rawRow(metadata, {
            id: 'res-1',
            userId: 'user-1',
            unitId: 'unit-1',
            complexId: 'complex-1',
            createdAt: new Date('2026-09-01T15:00:00Z'),
          }),
        ],
      ],
    ]);
    const { service, auditService } = build(rows);

    const file = await service.exportModule(
      'complex-1',
      'RESIDENTES',
      service.parseRange(),
      admin,
    );
    const workbook = await read(file.buffer);

    expect(file.filename).toMatch(
      /^conjunto-prueba-residentes-\d{4}-\d{2}-\d{2}\.xlsx$/,
    );
    expect(workbook.worksheets[0].name).toBe('Resumen');

    const sheet = sheetOf(workbook, 'Residentes');
    const headers = rowValues(sheet, 1);
    const values = rowValues(sheet, 2);
    const cell = (header: string) => values[headers.indexOf(header)];

    expect(cell('Unidad')).toBe('Torre 1 - 101');
    expect(cell('Usuario')).toBe('ANA GÓMEZ');
    expect(cell('Correo')).toBe('ana@correo.com');
    expect(cell('Documento')).toBe('123456');

    expect(auditService.log).toHaveBeenCalledWith(
      expect.objectContaining({
        action: AuditAction.EXPORT,
        complexId: 'complex-1',
      }),
    );
  });

  it('las fechas quedan en hora de Colombia', async () => {
    const metadata = metadataSource.getMetadata(Resident);
    const { service } = build(
      new Map([
        [
          Resident,
          [
            rawRow(metadata, {
              id: 'res-1',
              createdAt: new Date('2026-09-02T01:30:00Z'),
            }),
          ],
        ],
      ]),
    );

    const file = await service.exportModule(
      'complex-1',
      'RESIDENTES',
      service.parseRange(),
      admin,
    );
    const sheet = sheetOf(await read(file.buffer), 'Residentes');
    const headers = rowValues(sheet, 1);
    const created = rowValues(sheet, 2)[headers.indexOf('Creado')] as Date;

    // 01:30 UTC del 2 de septiembre es 8:30 p. m. del 1 en Bogotá.
    expect(created.toISOString()).toBe('2026-09-01T20:30:00.000Z');
  });

  it('las votaciones solo detallan quién votó en preguntas nominales', async () => {
    const { service, whereCalls } = build(new Map());

    await service.exportModule(
      'complex-1',
      'VOTACIONES',
      service.parseRange(),
      admin,
    );

    expect(whereCalls).toContainEqual([
      'q.secrecy = :nominal',
      { nominal: VoteSecrecy.NOMINAL },
    ]);
  });

  it('el respaldo completo es un ZIP con un Excel por módulo y el LEEME', async () => {
    const { service } = build(new Map());

    const file = await service.exportBackup(
      'complex-1',
      ['PAQUETES', 'MASCOTAS'],
      service.parseRange('2026-01-01', '2026-09-18'),
      admin,
    );

    const JSZip = (await import('jszip')).default;
    const zip = await JSZip.loadAsync(file.buffer);
    expect(Object.keys(zip.files).sort()).toEqual([
      'LEEME.txt',
      'mascotas.xlsx',
      'paquetes.xlsx',
    ]);
    expect(file.filename).toMatch(/^conjunto-prueba-respaldo-/);
  });

  it('rechaza un módulo que no existe', async () => {
    const { service } = build(new Map());
    await expect(
      service.exportModule(
        'complex-1',
        'NO_EXISTE',
        service.parseRange(),
        admin,
      ),
    ).rejects.toThrow('NO_EXISTE');
  });

  describe('parseRange', () => {
    const { service } = build(new Map());

    it('toma los días en hora de Colombia e incluye todo el día "hasta"', () => {
      const range = service.parseRange('2026-09-01', '2026-09-01');
      expect(range.from?.toISOString()).toBe('2026-09-01T05:00:00.000Z');
      expect(range.to?.toISOString()).toBe('2026-09-02T05:00:00.000Z');
    });

    it('rechaza fechas mal escritas o al revés', () => {
      expect(() => service.parseRange('01/09/2026')).toThrow();
      expect(() => service.parseRange('2026-09-10', '2026-09-01')).toThrow();
    });
  });
});
