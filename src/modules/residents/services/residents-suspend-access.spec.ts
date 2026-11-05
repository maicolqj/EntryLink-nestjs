import { ResidentsService } from './residents.service';
import { ResidentStatus } from '../enums/resident-status.enum';
import { UserErrorCode } from '../../shared/constans/error-codes.constants';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

/**
 * Suspender una ficha de residente le cierra la sesión al residente (vuelve a
 * entrar sin ese conjunto) y nadie puede suspender su propia ficha.
 */
const build = (resident: {
  id: string;
  userId: string | null;
  status: ResidentStatus;
}) => {
  const row = { ...resident, complexId: 'cx-1', notes: null as string | null };
  const audit: any[] = [];
  const accountAccess = {
    forceRelogin: jest.fn(async () => ({ closed: 2, complete: true })),
  };

  const service = Object.create(ResidentsService.prototype) as ResidentsService;
  Object.assign(service, {
    logger: { log: jest.fn(), warn: jest.fn(), error: jest.fn() },
    findById: jest.fn(async () => row),
    residentRepo: { save: jest.fn(async (r: unknown) => r) },
    cacheService: { deleteByPrefix: jest.fn(async () => undefined) },
    auditService: { log: jest.fn((e: unknown) => audit.push(e)) },
    accountAccess,
  });

  return { service, row, audit, accountAccess };
};

const admin = (sub: string) =>
  ({
    sub,
    email: `${sub}@example.com`,
    roles: [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.RESIDENT_ROL],
  }) as unknown as JwtAccessPayload;

const codeOf = async (p: Promise<unknown>) => {
  try {
    await p;
    return 'OK';
  } catch (e: any) {
    return e?.errorCode ?? e?.message;
  }
};

describe('ResidentsService.suspend: acceso del residente', () => {
  it('suspender la ficha cierra las sesiones del residente', async () => {
    const { service, row, accountAccess, audit } = build({
      id: 'res-1',
      userId: 'user-1',
      status: ResidentStatus.ACTIVE,
    });

    await service.suspend('res-1', 'mora', admin('sa-1'));

    expect(row.status).toBe(ResidentStatus.SUSPENDED);
    expect(accountAccess.forceRelogin).toHaveBeenCalledWith(
      'user-1',
      'resident_suspended',
    );
    expect(audit[0].newValue).toMatchObject({
      status: ResidentStatus.SUSPENDED,
      sessionsClosed: 2,
      sessionsCutComplete: true,
    });
  });

  it('nadie puede suspender su propia ficha', async () => {
    const { service, row, accountAccess } = build({
      id: 'res-1',
      userId: 'sa-1',
      status: ResidentStatus.ACTIVE,
    });

    const code = await codeOf(service.suspend('res-1', 'x', admin('sa-1')));

    expect(code).toBe(UserErrorCode.CANNOT_SUSPEND_SELF);
    expect(row.status).toBe(ResidentStatus.ACTIVE);
    expect(accountAccess.forceRelogin).not.toHaveBeenCalled();
  });

  it('una ficha sin cuenta se suspende sin tocar sesiones', async () => {
    const { service, row, accountAccess } = build({
      id: 'res-1',
      userId: null,
      status: ResidentStatus.ACTIVE,
    });

    await service.suspend('res-1', 'x', admin('sa-1'));

    expect(row.status).toBe(ResidentStatus.SUSPENDED);
    expect(accountAccess.forceRelogin).not.toHaveBeenCalled();
  });
});
