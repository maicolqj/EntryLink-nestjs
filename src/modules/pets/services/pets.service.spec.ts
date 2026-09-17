import { PetsService } from './pets.service';
import { Pet } from '../entities/pet.entity';
import { PetStatus } from '../enums/pet-status.enum';
import { PetSpecies } from '../enums/pet-species.enum';

import { CustomError } from '../../shared/utils/errors.utils';
import { PetErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Las dos reglas de la ficha que no se pueden dejar solo en la pantalla:
 *
 *   1. Un booleano que llega como texto no marca la mascota. `"false"` es una
 *      cadena no vacía —verdadera para JavaScript— y marcarla como raza de
 *      manejo especial le exige una póliza de responsabilidad civil que su
 *      dueño no tiene por qué comprar.
 *   2. La ficha se corrige mientras la administración no la haya validado.
 *      Después es la que usa la portería para identificar al animal, y el botón
 *      escondido en la app no es una regla: el servidor tiene que negarse.
 */

const userOf = (roles: ValidRoles[], sub = 'user-1'): JwtAccessPayload => ({
  sub,
  email: 'quien@test.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's1',
  roles,
  permissions: [],
  complexId: 'complex-1',
});

const petOf = (partial: Partial<Pet> = {}): Pet =>
  ({
    id: 'pet-1',
    name: 'KODA',
    species: PetSpecies.DOG,
    status: PetStatus.PENDING_APPROVAL,
    isSpecialBreed: false,
    hasMicrochip: false,
    unitId: 'unit-1',
    complexId: 'complex-1',
    ...partial,
  }) as Pet;

const buildHarness = (pet: Pet = petOf()) => {
  const saved: Pet[] = [];

  const petRepo = {
    findOne: jest.fn(() => Promise.resolve(pet)),
    count: jest.fn(() => Promise.resolve(0)),
    create: jest.fn((data: Partial<Pet>) => data as Pet),
    save: jest.fn((entity: Pet) => {
      saved.push(entity);
      return Promise.resolve({ id: 'pet-1', ...entity });
    }),
  };

  const service = new PetsService(
    petRepo as never,
    {
      findById: jest.fn(() =>
        Promise.resolve({
          id: 'complex-1',
          slug: 'complejo',
          enabledModules: ['MASCOTAS'],
          petsMaxPerUnit: 0,
        }),
      ),
      assertComplexAccess: jest.fn(() => Promise.resolve(undefined)),
    } as never, // complexService
    { findById: jest.fn() } as never, // unitService
    {
      findMyProfile: jest.fn(() =>
        Promise.resolve({ id: 'resident-1', unitId: 'unit-1' }),
      ),
      findActiveByUnitInternal: jest.fn(() => Promise.resolve([])),
    } as never, // residentsService
    {
      notify: jest.fn(() => Promise.resolve([])),
      findUserIdsByRoles: jest.fn(() => Promise.resolve(['admin-1'])),
    } as never, // notificationsService
    { log: jest.fn() } as never, // auditService
  );

  // loadRelations vuelve a leer la ficha al final de create/update; el repo
  // mockeado ya devuelve la que interesa.
  return { service, petRepo, saved };
};

describe('PetsService — booleanos que llegan como texto', () => {
  it('"false" NO deja la mascota como raza de manejo especial', async () => {
    const { service, saved } = buildHarness();

    await service.create(
      {
        complexId: 'complex-1',
        name: 'KODA',
        species: PetSpecies.DOG,
        photoUrl: 'https://files.alternaqj.com/koda.jpg',
        // Lo que llega de un multipart que no pasó por el DTO.
        isSpecialBreed: 'false' as unknown as boolean,
        hasMicrochip: 'false' as unknown as boolean,
      },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(saved[0].isSpecialBreed).toBe(false);
    expect(saved[0].hasMicrochip).toBe(false);
  });

  it('"true" sí la marca', async () => {
    const { service, saved } = buildHarness();

    await service.create(
      {
        complexId: 'complex-1',
        name: 'KODA',
        species: PetSpecies.DOG,
        photoUrl: 'https://files.alternaqj.com/koda.jpg',
        isSpecialBreed: 'true' as unknown as boolean,
      },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(saved[0].isSpecialBreed).toBe(true);
  });
});

describe('PetsService — la ficha se corrige hasta que se valida', () => {
  it('el residente edita su ficha mientras está pendiente', async () => {
    const { service, saved } = buildHarness(
      petOf({ status: PetStatus.PENDING_APPROVAL }),
    );

    await service.update(
      { petId: 'pet-1', name: 'KODA II' },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(saved[0].name).toBe('KODA II');
  });

  it('también si la administración se la rechazó: para eso la corrige', async () => {
    const { service, saved } = buildHarness(
      petOf({ status: PetStatus.REJECTED }),
    );

    await service.update(
      { petId: 'pet-1', breed: 'CRIOLLO' },
      userOf([ValidRoles.RESIDENT_ROL]),
    );

    expect(saved[0].breed).toBe('CRIOLLO');
  });

  it('una vez aprobada, el residente ya no la edita', async () => {
    const { service } = buildHarness(petOf({ status: PetStatus.ACTIVE }));

    await expect(
      service.update(
        { petId: 'pet-1', name: 'OTRO NOMBRE' },
        userOf([ValidRoles.RESIDENT_ROL]),
      ),
    ).rejects.toMatchObject({
      errorCode: PetErrorCode.PET_LOCKED_AFTER_APPROVAL,
    });
  });

  it('la administración sí edita una ficha aprobada', async () => {
    const { service, saved } = buildHarness(
      petOf({ status: PetStatus.ACTIVE }),
    );

    await service.update(
      { petId: 'pet-1', name: 'KODA' },
      userOf([ValidRoles.COMPLEX_ROL]),
    );

    expect(saved[0].name).toBe('KODA');
  });

  it('retirar del censo NO está bloqueado: la mascota se muda o fallece', async () => {
    const { service, saved } = buildHarness(
      petOf({ status: PetStatus.ACTIVE }),
    );

    await expect(
      service.remove('pet-1', 'Nos mudamos', userOf([ValidRoles.RESIDENT_ROL])),
    ).resolves.toBe(true);

    expect(saved[0].status).toBe(PetStatus.REMOVED);
    expect(saved[0].deletedAt).toBeInstanceOf(Date);
  });
});

describe('CustomError del bloqueo', () => {
  it('viaja con su errorCode para que el front sepa qué decir', async () => {
    const { service } = buildHarness(petOf({ status: PetStatus.ACTIVE }));

    const error = await service
      .update({ petId: 'pet-1', name: 'X' }, userOf([ValidRoles.RESIDENT_ROL]))
      .catch((e: unknown) => e);

    expect(error).toBeInstanceOf(CustomError);
  });
});

/**
 * El cron de vencimientos filtra los complejos que tienen el módulo encendido.
 *
 * La consulta preguntaba por `c.enabled_modules`, una columna que no existe: la
 * de verdad es `"enabledModules"` —el `@Column` de la entidad no lleva `name`,
 * así que TypeORM la creó en camelCase y Postgres la deja entrecomillada—. La
 * base respondía con un error, el cron moría antes de enviar nada y nadie se
 * enteraba: ni el refuerzo antirrábico ni la póliza de RC avisaban.
 *
 * Se afirma sobre el TEXTO de la condición porque el fallo es exactamente ese:
 * un nombre que el QueryBuilder no traduce y que se va crudo contra Postgres.
 */
describe('PetsService — aviso de vencimientos', () => {
  const buildQueryHarness = () => {
    const conditions: string[] = [];

    const qb = {
      innerJoinAndSelect: jest.fn().mockReturnThis(),
      where: jest.fn((condition: string) => {
        conditions.push(condition);
        return qb;
      }),
      andWhere: jest.fn((condition: string) => {
        conditions.push(condition);
        return qb;
      }),
      getMany: jest.fn(() => Promise.resolve([])),
    };

    const petRepo = { createQueryBuilder: jest.fn(() => qb) };

    const service = new PetsService(
      petRepo as never,
      {} as never,
      {} as never,
      {} as never,
      { notify: jest.fn() } as never,
      { log: jest.fn() } as never,
    );

    return { service, conditions };
  };

  it('filtra por el nombre de la propiedad, no por la columna en snake_case', async () => {
    const { service, conditions } = buildQueryHarness();

    await service.notifyExpiringDocuments();

    const sql = conditions.join(' ');
    expect(sql).toContain('c.enabledModules');
    expect(sql).not.toContain('enabled_modules');
  });

  it('las fechas de vencimiento también van por su propiedad', async () => {
    const { service, conditions } = buildQueryHarness();

    await service.notifyExpiringDocuments();

    const sql = conditions.join(' ');
    expect(sql).toContain('p.insuranceExpiresAt');
    expect(sql).toContain('p.rabiesVaccineAt');
  });
});
