import { ValidRoles } from '../../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { GrowthTeamMemberStatus } from '../../shared/growth.enums';
import { GrowthIdentity } from '../../shared/identity-directory.service';
import { TeamMembersService } from './team-members.service';

const actor: JwtAccessPayload = {
  sub: '11111111-1111-1111-1111-111111111111',
  email: 'admin@alternaqj.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's',
  roles: [ValidRoles.SUPER_ADMIN_ROL],
  permissions: [],
};

const USER = '22222222-2222-2222-2222-222222222222';

function setup(
  identity: GrowthIdentity | null,
  existing: object | null = null,
) {
  const manager = {
    findOne: jest.fn(async () => existing),
    save: jest.fn(async (e: any): Promise<any> => ({ id: 'tm-1', ...e })),
    create: jest.fn((_: unknown, d: object) => d),
  };
  const dataSource = {
    transaction: jest.fn((fn: (m: typeof manager) => unknown) => fn(manager)),
  };
  const identityDir = { findActiveUser: jest.fn(async () => identity) };
  const activity = { record: jest.fn() };
  const service = new TeamMembersService(
    {} as never,
    dataSource as never,
    identityDir as never,
    activity as never,
  );
  return { service, manager, activity };
}

const input = { userId: USER, displayName: 'Ana Gómez' };

describe('TeamMembersService.add', () => {
  it('agrega a un usuario con rol comercial y sin conjunto', async () => {
    const { service, manager, activity } = setup({
      userId: USER,
      roles: [ValidRoles.SALES_ROL, ValidRoles.RESIDENT_ROL],
      linkedToComplex: false,
    });
    await service.add(input, actor);
    expect(manager.save.mock.calls[0][0]).toMatchObject({
      userId: USER,
      status: GrowthTeamMemberStatus.ACTIVE,
    });
    expect(activity.record).toHaveBeenCalledTimes(1);
  });

  it('rechaza a alguien ligado a un conjunto aunque tenga rol comercial', async () => {
    const { service, manager } = setup({
      userId: USER,
      roles: [ValidRoles.SALES_ROL],
      linkedToComplex: true,
    });
    await expect(service.add(input, actor)).rejects.toThrow(
      'sin vínculo con un conjunto',
    );
    expect(manager.save).not.toHaveBeenCalled();
  });

  it.each([
    ValidRoles.COMPLEX_ROL,
    ValidRoles.SECURITY_ROL,
    ValidRoles.RESIDENT_ROL,
    ValidRoles.COMPILANCE_OFFICER_ROL,
  ])('rechaza a un usuario solo con %s', async (role) => {
    const { service } = setup({
      userId: USER,
      roles: [role],
      linkedToComplex: false,
    });
    await expect(service.add(input, actor)).rejects.toThrow('rol comercial');
  });

  it('no duplica integrantes', async () => {
    const { service } = setup(
      { userId: USER, roles: [ValidRoles.SALES_ROL], linkedToComplex: false },
      { id: 'tm-0', userId: USER },
    );
    await expect(service.add(input, actor)).rejects.toThrow('ya es integrante');
  });

  it('la actividad no copia el nombre de la persona', async () => {
    const { service, activity } = setup({
      userId: USER,
      roles: [ValidRoles.SALES_ROL],
      linkedToComplex: false,
    });
    await service.add(input, actor);
    expect(JSON.stringify(activity.record.mock.calls[0][2])).not.toContain(
      'Ana',
    );
  });
});
