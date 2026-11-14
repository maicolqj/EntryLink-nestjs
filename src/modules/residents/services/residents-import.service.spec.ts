import { ResidentsImportService } from './residents-import.service';
import { ResidentImportRowData } from '../queues/residents-import.constants';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { User } from '../../users/entities/user.entity';

/**
 * El cargue masivo es todo o nada: si una fila falla no se crea ningún
 * residente, y la administración corrige el Excel y lo vuelve a subir entero
 * sin preguntarse cuáles quedaron cargados.
 */

const rowOf = (
  partial: Partial<ResidentImportRowData> = {},
): ResidentImportRowData => ({
  rowIndex: 2,
  name: 'ANA',
  lastName: 'PÉREZ',
  email: 'ana@test.com',
  phoneNumber: '3001112233',
  identityNumber: undefined,
  unitNumber: '101',
  enEdificio: false,
  typeRaw: 'PROPIETARIO',
  startDateRaw: '01/09/2026',
  isMainResident: false,
  ...partial,
});

type ExistingUser = {
  id: string;
  identity?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
};

const build = (
  options: { failOnSaveNumber?: number; users?: ExistingUser[] } = {},
) => {
  const users = options.users ?? [];
  let saves = 0;

  const writer = {
    create: jest.fn((_entity: unknown, data?: unknown) => data ?? _entity),
    save: jest.fn(async (entityOrData: any, data?: any) => {
      saves++;
      if (options.failOnSaveNumber === saves) {
        throw Object.assign(new Error('duplicate key'), {
          code: '23505',
          detail: 'Key (phone_number)=(3001112233) already exists.',
        });
      }
      return { id: `saved-${saves}`, ...(data ?? entityOrData) };
    }),
    update: jest.fn(async () => undefined),
    // ensureResidentRole (cuenta existente): sin rol previo, lo asigna.
    findOne: jest.fn(async () => null),
    count: jest.fn(async () => 0),
  };

  const reader = {
    findOne: jest.fn(async (entity: unknown, opts: any) => {
      // Toda unidad del archivo existe; ningún residente previo. Usuarios: los
      // de `options.users`, buscados por el único campo del where.
      if (entity === Unit) return { id: `unit-${opts.where.number}` };
      if (entity === User) {
        const [field, value] = Object.entries(opts.where)[0] as [
          string,
          string,
        ];
        return users.find((u: any) => u[field] === value) ?? null;
      }
      return null;
    }),
  };

  const transaction = jest.fn(async (cb: (m: unknown) => unknown) =>
    cb(writer),
  );

  const service = new ResidentsImportService(
    {} as never, // userRepo
    { findOne: jest.fn(async () => ({ id: 'role-resident' })) } as never,
    {} as never, // unitRepo
    {} as never, // buildingRepo
    {} as never, // residentRepo
    { manager: reader, transaction } as never,
  );

  return { service, transaction, writer };
};

const noop = () => undefined;

describe('ResidentsImportService — cargue todo o nada', () => {
  it('una fila con error frena todo el archivo: no se crea ningún residente', async () => {
    const h = build();

    const result = await h.service.processRows(
      [
        rowOf({ rowIndex: 2, email: 'ana@test.com', phoneNumber: '3001' }),
        rowOf({ rowIndex: 3, email: 'correo-malo', phoneNumber: '3002' }),
        rowOf({ rowIndex: 4, email: 'luis@test.com', phoneNumber: '3003' }),
      ],
      'complex-1',
      null,
      noop,
    );

    expect(result.aborted).toBe(true);
    expect(result.successCount).toBe(0);
    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 3,
        message: expect.stringContaining('email inválido'),
      }),
    ]);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.writer.save).not.toHaveBeenCalled();
  });

  it('junta TODOS los errores, no solo el primero', async () => {
    const h = build();

    const result = await h.service.processRows(
      [
        rowOf({ rowIndex: 2, name: '' }),
        rowOf({
          rowIndex: 3,
          email: 'luis@test.com',
          startDateRaw: 'no-es-fecha',
        }),
      ],
      'complex-1',
      null,
      noop,
    );

    expect(result.errors.map((e) => e.row)).toEqual([2, 3]);
  });

  it('sin errores carga todas las filas en una sola transacción', async () => {
    const h = build();

    const result = await h.service.processRows(
      [
        rowOf({ rowIndex: 2, email: 'ana@test.com', phoneNumber: '3001' }),
        rowOf({
          rowIndex: 3,
          email: 'luis@test.com',
          phoneNumber: '3002',
          unitNumber: '102',
        }),
      ],
      'complex-1',
      null,
      noop,
    );

    expect(result).toMatchObject({
      aborted: false,
      successCount: 2,
      errorCount: 0,
    });
    expect(h.transaction).toHaveBeenCalledTimes(1);
  });

  it('el mismo teléfono en dos personas del archivo es un error de la segunda fila', async () => {
    const h = build();

    const result = await h.service.processRows(
      [
        rowOf({ rowIndex: 2, email: 'ana@test.com', phoneNumber: '3001' }),
        rowOf({
          rowIndex: 3,
          email: 'luis@test.com',
          phoneNumber: '3001',
          unitNumber: '102',
        }),
      ],
      'complex-1',
      null,
      noop,
    );

    expect(result.aborted).toBe(true);
    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 3,
        message: expect.stringContaining('fila 2'),
      }),
    ]);
  });

  it('dos residentes principales para la misma unidad', async () => {
    const h = build();

    const result = await h.service.processRows(
      [
        rowOf({
          rowIndex: 2,
          email: 'ana@test.com',
          phoneNumber: '3001',
          isMainResident: true,
        }),
        rowOf({
          rowIndex: 3,
          email: 'luis@test.com',
          phoneNumber: '3002',
          isMainResident: true,
        }),
      ],
      'complex-1',
      null,
      noop,
    );

    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 3,
        message: expect.stringContaining('residente principal'),
      }),
    ]);
  });

  it('un fallo a mitad de la escritura revierte todo y dice qué fila fue', async () => {
    // Cada fila nueva guarda usuario, rol y residente: el cuarto save es el
    // usuario de la segunda fila.
    const h = build({ failOnSaveNumber: 4 });

    const result = await h.service.processRows(
      [
        rowOf({ rowIndex: 2, email: 'ana@test.com', phoneNumber: '3001' }),
        rowOf({
          rowIndex: 3,
          email: 'luis@test.com',
          phoneNumber: '3002',
          unitNumber: '102',
        }),
      ],
      'complex-1',
      null,
      noop,
    );

    expect(result).toMatchObject({ aborted: true, successCount: 0 });
    expect(result.errors).toEqual([
      expect.objectContaining({
        row: 3,
        message: expect.stringContaining('el teléfono ya está registrado'),
      }),
    ]);
  });
});

/**
 * Misma regla que el alta desde la web (findAccountForNewResident): la cédula
 * sola no vincula una cuenta existente, y un correo o teléfono de una cuenta
 * con OTRA cédula es otra persona. El mensaje no dice dónde vive.
 */
describe('ResidentsImportService — cuenta existente', () => {
  const ana: ExistingUser = {
    id: 'u-ana',
    identity: '1010',
    phoneNumber: '3001112233',
    email: 'ana@otro.co',
  };
  const run = (row: Partial<ResidentImportRowData>) => {
    const h = build({ users: [ana] });
    return h.service
      .processRows([rowOf(row)], 'complex-1', null, noop)
      .then((result) => ({ result, writer: h.writer }));
  };
  const savedUsers = (writer: any) =>
    writer.save.mock.calls.filter(([e]: any[]) => e === User);

  it('cédula + teléfono de una cuenta existente: vincula, no crea usuario', async () => {
    const { result, writer } = await run({
      email: 'nuevo@test.com',
      identityNumber: '1010',
      phoneNumber: '3001112233',
    });
    expect(result).toMatchObject({ aborted: false, successCount: 1 });
    expect(savedUsers(writer)).toHaveLength(0);
  });

  it('cédula + correo de una cuenta existente: vincula', async () => {
    const { result, writer } = await run({
      email: 'ana@otro.co',
      identityNumber: '1010',
      phoneNumber: '3009998877',
    });
    expect(result).toMatchObject({ aborted: false, successCount: 1 });
    expect(savedUsers(writer)).toHaveLength(0);
  });

  it('solo la cédula coincide: error genérico sin nombrar conjuntos', async () => {
    const { result } = await run({
      email: 'otro@test.com',
      identityNumber: '1010',
      phoneNumber: '3009998877',
    });
    expect(result.aborted).toBe(true);
    expect(result.errors[0].message).toContain('no coinciden');
    expect(result.errors[0].message).not.toMatch(/conjunto|complejo/i);
  });

  it('correo de una cuenta con OTRA cédula: error, no se mete a otra persona', async () => {
    const { result } = await run({
      email: 'ana@otro.co',
      identityNumber: '2020',
      phoneNumber: '3009998877',
    });
    expect(result.aborted).toBe(true);
    expect(result.errors[0].message).toContain('no coinciden');
  });

  it('sin cédula en el Excel: vincula por correo como antes', async () => {
    const { result, writer } = await run({
      email: 'ana@otro.co',
      identityNumber: undefined,
      phoneNumber: undefined,
    });
    expect(result).toMatchObject({ aborted: false, successCount: 1 });
    expect(savedUsers(writer)).toHaveLength(0);
  });
});
