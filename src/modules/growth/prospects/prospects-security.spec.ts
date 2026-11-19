import { ValidPermissions as P } from '../../permissions/enums/valid-permissions';
import { ValidRoles } from '../../roles/enums/valid-roles';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { GrowthEntityType } from '../shared/growth.enums';
import { PersonChannel } from './entities/channels.entity';
import { Evidence } from './entities/evidence.entity';
import { GrowthChannelKind } from './prospects.enums';
import { GrowthEvidenceResolver } from './resolvers/prospect-operations.resolver';
import { GrowthPersonChannelResolver } from './resolvers/prospect-records.resolver';
import { ProspectGuardsService } from './services/prospect-guards.service';
import { maskEmail, maskPhone } from './shared/masking';

// @nestjs/passport es ESM y jest (CJS) no lo carga; aquí no se usa la auth real.
jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => class {},
  PassportStrategy: () => class {},
}));

const actor = (
  permissions: P[],
  roles: ValidRoles[] = [ValidRoles.SALES_ROL],
): JwtAccessPayload => ({
  sub: 'user-1',
  email: 'u@alternaqj.com',
  type: 'access',
  entityType: 'user',
  tokenVersion: 1,
  sessionId: 's',
  roles,
  permissions,
});

describe('Seguridad de Prospect', () => {
  describe('enmascaramiento en el servidor', () => {
    const channel = (kind: GrowthChannelKind, value: string) =>
      Object.assign(new PersonChannel(), { kind, value });
    const resolver = new GrowthPersonChannelResolver();

    it('sin VIEW_GROWTH_CONTACT_DATA el canal de una persona sale enmascarado', () => {
      const viewer = actor([P.VIEW_GROWTH_PROSPECTS]);
      expect(
        resolver.value(
          channel(GrowthChannelKind.EMAIL, 'ana.gomez@adminph.co'),
          viewer,
        ),
      ).toBe('a***@adminph.co');
      expect(
        resolver.value(
          channel(GrowthChannelKind.PHONE, '+573001112233'),
          viewer,
        ),
      ).toBe('+57 *** *** **33');
      expect(resolver.masked(viewer)).toBe(true);
    });

    it('con el permiso (o SUPER_ADMIN) sale en claro', () => {
      expect(
        resolver.value(
          channel(GrowthChannelKind.EMAIL, 'ana@x.co'),
          actor([P.VIEW_GROWTH_CONTACT_DATA]),
        ),
      ).toBe('ana@x.co');
      expect(
        resolver.value(
          channel(GrowthChannelKind.EMAIL, 'ana@x.co'),
          actor([], [ValidRoles.SUPER_ADMIN_ROL]),
        ),
      ).toBe('ana@x.co');
    });

    it('las evidencias de canales de personas también se enmascaran', () => {
      const resolverE = new GrowthEvidenceResolver();
      const ev = Object.assign(new Evidence(), {
        entityType: GrowthEntityType.PERSON_CHANNEL,
        field: 'value',
        observedValue: 'ana.gomez@adminph.co',
      });
      expect(
        resolverE.observedValue(ev, actor([P.VIEW_GROWTH_PROSPECTS])),
      ).toBe('a***@adminph.co');
      expect(
        resolverE.observedValue(ev, actor([P.VIEW_GROWTH_CONTACT_DATA])),
      ).toBe('ana.gomez@adminph.co');
      const org = Object.assign(new Evidence(), {
        entityType: GrowthEntityType.ORGANIZATION,
        field: 'nit',
        observedValue: '900123456',
      });
      expect(
        resolverE.observedValue(org, actor([P.VIEW_GROWTH_PROSPECTS])),
      ).toBe('900123456');
    });

    it('formatos', () => {
      expect(maskEmail('x@y.co')).toBe('x***@y.co');
      expect(maskPhone('6012345678')).toBe('*** *** **78');
    });
  });

  describe('separación de funciones', () => {
    const setup = (allow: boolean) => {
      const record = jest.fn();
      const guards = new ProspectGuardsService(
        {} as never,
        { record } as never,
      );
      const manager = {
        findOne: jest.fn(async () => ({
          allowSuperAdminSelfValidation: allow,
        })),
      };
      return { guards, manager, record };
    };
    const ctx = {
      registeredByUserId: 'user-1',
      operation: 'VALIDATION_TAKEN',
      entityType: GrowthEntityType.ORGANIZATION,
      entityId: 'org-1',
    };

    it('otro usuario: pasa sin evento', async () => {
      const { guards, manager, record } = setup(true);
      await guards.assertSegregation(manager as never, actor([]), {
        ...ctx,
        registeredByUserId: 'otro',
      });
      expect(record).not.toHaveBeenCalled();
    });

    it('el mismo usuario sin ser SUPER_ADMIN: rechazado', async () => {
      const { guards, manager } = setup(true);
      await expect(
        guards.assertSegregation(manager as never, actor([]), ctx),
      ).rejects.toThrow('separación de funciones');
    });

    it('SUPER_ADMIN con la excepción activa: pasa y queda el evento con usuario, registro y operación', async () => {
      const { guards, manager, record } = setup(true);
      await guards.assertSegregation(
        manager as never,
        actor([], [ValidRoles.SUPER_ADMIN_ROL]),
        ctx,
      );
      expect(record).toHaveBeenCalledWith(manager, expect.anything(), {
        action: 'SELF_VALIDATION_EXCEPTION',
        entityType: GrowthEntityType.ORGANIZATION,
        entityId: 'org-1',
        changes: { operation: 'VALIDATION_TAKEN', userId: 'user-1' },
      });
    });

    it('SUPER_ADMIN con la excepción desactivada: rechazado', async () => {
      const { guards, manager } = setup(false);
      await expect(
        guards.assertSegregation(
          manager as never,
          actor([], [ValidRoles.SUPER_ADMIN_ROL]),
          ctx,
        ),
      ).rejects.toThrow('separación de funciones');
    });
  });
});
