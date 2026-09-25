import { ResidentsImportService } from './residents-import.service';
import { ResidentImportRowData } from '../queues/residents-import.constants';
import { Unit } from '../../residential-complex/entities/unit.entity';
import { User } from '../../users/entities/user.entity';

/**
 * El cargue masivo es todo o nada: si una fila falla no se crea ningún
 * residente, y la administración corrige el Excel y lo vuelve a subir entero
 * sin preguntarse cuáles quedaron cargados.
 */

const rowOf = (partial: Partial<ResidentImportRowData> = {}): ResidentImportRowData => ({
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

const build = (options: { failOnSaveNumber?: number } = {}) => {
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
  };

  const reader = {
    findOne: jest.fn(async (entity: unknown, opts: any) => {
      // Toda unidad del archivo existe; ningún usuario ni residente previo.
      if (entity === Unit) return { id: `unit-${opts.where.number}` };
      if (entity === User) return null;
      return null;
    }),
  };

  const transaction = jest.fn(async (cb: (m: unknown) => unknown) => cb(writer));

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
      expect.objectContaining({ row: 3, message: expect.stringContaining('email inválido') }),
    ]);
    expect(h.transaction).not.toHaveBeenCalled();
    expect(h.writer.save).not.toHaveBeenCalled();
  });

  it('junta TODOS los errores, no solo el primero', async () => {
    const h = build();

    const result = await h.service.processRows(
      [
        rowOf({ rowIndex: 2, name: '' }),
        rowOf({ rowIndex: 3, email: 'luis@test.com', startDateRaw: 'no-es-fecha' }),
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
        rowOf({ rowIndex: 3, email: 'luis@test.com', phoneNumber: '3002', unitNumber: '102' }),
      ],
      'complex-1',
      null,
      noop,
    );

    expect(result).toMatchObject({ aborted: false, successCount: 2, errorCount: 0 });
    expect(h.transaction).toHaveBeenCalledTimes(1);
  });

  it('el mismo teléfono en dos personas del archivo es un error de la segunda fila', async () => {
    const h = build();

    const result = await h.service.processRows(
      [
        rowOf({ rowIndex: 2, email: 'ana@test.com', phoneNumber: '3001' }),
        rowOf({ rowIndex: 3, email: 'luis@test.com', phoneNumber: '3001', unitNumber: '102' }),
      ],
      'complex-1',
      null,
      noop,
    );

    expect(result.aborted).toBe(true);
    expect(result.errors).toEqual([
      expect.objectContaining({ row: 3, message: expect.stringContaining('fila 2') }),
    ]);
  });

  it('dos residentes principales para la misma unidad', async () => {
    const h = build();

    const result = await h.service.processRows(
      [
        rowOf({ rowIndex: 2, email: 'ana@test.com', phoneNumber: '3001', isMainResident: true }),
        rowOf({ rowIndex: 3, email: 'luis@test.com', phoneNumber: '3002', isMainResident: true }),
      ],
      'complex-1',
      null,
      noop,
    );

    expect(result.errors).toEqual([
      expect.objectContaining({ row: 3, message: expect.stringContaining('residente principal') }),
    ]);
  });

  it('un fallo a mitad de la escritura revierte todo y dice qué fila fue', async () => {
    // Cada fila nueva guarda usuario, rol y residente: el cuarto save es el
    // usuario de la segunda fila.
    const h = build({ failOnSaveNumber: 4 });

    const result = await h.service.processRows(
      [
        rowOf({ rowIndex: 2, email: 'ana@test.com', phoneNumber: '3001' }),
        rowOf({ rowIndex: 3, email: 'luis@test.com', phoneNumber: '3002', unitNumber: '102' }),
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
