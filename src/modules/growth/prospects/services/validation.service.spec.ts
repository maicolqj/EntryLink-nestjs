import { EntityManager, ObjectLiteral } from 'typeorm';
import { JwtAccessPayload } from '../../../shared/interfaces/jwt-payload.interface';
import { GrowthEntityType } from '../../shared/growth.enums';
import { OrganizationChannel } from '../entities/channels.entity';
import { Organization } from '../entities/organization.entity';
import { Person } from '../entities/person.entity';
import { PropertyManagement } from '../entities/relations.entity';
import {
  GrowthProspectKind,
  GrowthValidationDecision,
  GrowthValidationStatus as S,
} from '../prospects.enums';
import { ValidationService } from './validation.service';

const actor = { sub: 'validador' } as JwtAccessPayload;

interface Scenario {
  hasProperty?: boolean;
  nitVerified?: boolean;
}

function setup({ hasProperty = false, nitVerified = true }: Scenario) {
  const manager = {
    exists: jest.fn((entity: new () => ObjectLiteral) => {
      if (entity === PropertyManagement) return Promise.resolve(hasProperty);
      return Promise.resolve(entity === OrganizationChannel);
    }),
    save: jest.fn((record: ObjectLiteral) => Promise.resolve(record)),
  } as unknown as EntityManager;
  const evidences = {
    hasVerified: jest.fn(
      (_m: EntityManager, _t: GrowthEntityType, _id: string, field: string) =>
        Promise.resolve(field !== 'nit' || nitVerified),
    ),
  };
  const org = Object.assign(new Organization(), {
    id: 'org-1',
    legalName: 'Administradora SAS',
    nit: '900123456',
    validationStatus: S.IN_VALIDATION,
    validationTakenByUserId: actor.sub,
    createdByUserId: 'investigador',
  });
  const guards = {
    findVisible: jest.fn().mockResolvedValue(org),
    assertSegregation: jest.fn().mockResolvedValue(undefined),
  };
  const dataSource = {
    manager,
    transaction: jest.fn((run: (m: EntityManager) => Promise<unknown>) =>
      run(manager),
    ),
  };
  const activity = { record: jest.fn().mockResolvedValue(undefined) };
  const service = new ValidationService(
    dataSource as never,
    guards as never,
    evidences as never,
    activity as never,
  );
  return { service, manager, org };
}

const orgRef = { kind: GrowthProspectKind.ORGANIZATION, id: 'org-1' };
const validate = { decision: GrowthValidationDecision.VALIDATED };

describe('ValidationService: copropiedad administrada de una empresa', () => {
  it('una empresa sin copropiedad queda lista y se muestra sin conjunto confirmado', async () => {
    const { service, manager, org } = setup({});

    const checklist = await service.buildChecklist(
      manager,
      GrowthProspectKind.ORGANIZATION,
      org,
    );

    expect(checklist.ready).toBe(true);
    expect(checklist.items.find((i) => i.key === 'managedProperty')).toEqual(
      expect.objectContaining({
        ok: false,
        label: 'Sin conjunto confirmado (opcional)',
      }),
    );
  });

  it('una empresa con copropiedad conserva el requisito cumplido', async () => {
    const { service, manager, org } = setup({ hasProperty: true });

    const checklist = await service.buildChecklist(
      manager,
      GrowthProspectKind.ORGANIZATION,
      org,
    );

    expect(checklist.ready).toBe(true);
    expect(checklist.items.find((i) => i.key === 'managedProperty')).toEqual(
      expect.objectContaining({
        ok: true,
        label: 'Al menos una copropiedad administrada',
      }),
    );
  });

  it('lo opcional no releva los demás requisitos de la empresa', async () => {
    const { service, manager, org } = setup({ nitVerified: false });

    const checklist = await service.buildChecklist(
      manager,
      GrowthProspectKind.ORGANIZATION,
      org,
    );

    expect(checklist.ready).toBe(false);
  });

  it('un administrador independiente sigue necesitando copropiedad', async () => {
    const { service, manager } = setup({});
    const person = Object.assign(new Person(), {
      id: 'p-1',
      isIndependentAdmin: true,
    });

    const checklist = await service.buildChecklist(
      manager,
      GrowthProspectKind.PERSON,
      person,
    );

    expect(checklist.ready).toBe(false);
    expect(checklist.items.find((i) => i.key === 'managedProperty')?.ok).toBe(
      false,
    );
  });

  it('validar sin copropiedad deja la marca en la nota', async () => {
    const { service, org } = setup({});

    await service.decide(orgRef, validate, actor);

    expect(org.validationStatus).toBe(S.VALIDATED);
    expect(org.validationNote).toBe('Sin conjunto confirmado');
  });

  it('la marca se suma a la nota de quien valida', async () => {
    const { service, org } = setup({});

    await service.decide(orgRef, { ...validate, note: 'Revisado RUES' }, actor);

    expect(org.validationNote).toBe('Revisado RUES · Sin conjunto confirmado');
  });

  it('validar con copropiedad no agrega la marca', async () => {
    const { service, org } = setup({ hasProperty: true });

    await service.decide(orgRef, validate, actor);

    expect(org.validationNote).toBeNull();
  });

  it('el error de requisitos no nombra lo opcional', async () => {
    const { service } = setup({ nitVerified: false });

    await expect(service.decide(orgRef, validate, actor)).rejects.toThrow(
      /^Faltan requisitos: NIT registrado con evidencia verificada$/,
    );
  });
});
