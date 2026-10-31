// @nestjs/passport es ESM y jest (CJS, Node 22) no lo carga. Aquí solo
// importan las referencias a los guards, no la autenticación real.
jest.mock('@nestjs/passport', () => ({
  AuthGuard: () => class {},
  PassportStrategy: () => class {},
}));

import { ExecutionContextHost } from '@nestjs/core/helpers/execution-context-host';
import { Reflector } from '@nestjs/core';
import { GUARDS_METADATA } from '@nestjs/common/constants';
import { ValidPermissions as P } from '../permissions/enums/valid-permissions';
import { ValidRoles } from '../roles/enums/valid-roles';
import { ROLES_TO_SEED } from '../../core/database/seeds/datas/roles.data.seed';
import { JwtAuthGuard } from '../shared/guards/jwt-auth.guard';
import { UniversalRolePermissionGuard } from '../shared/guards/universal-role-permission.guard';
import { GrowthActivityResolver } from './activity/resolvers/growth-activity.resolver';
import { ActivityLogService } from './activity/services/activity-log.service';
import { GrowthComplianceResolver } from './compliance/resolvers/growth-compliance.resolver';
import { SuppressionsService } from './compliance/services/suppressions.service';
import {
  GROWTH_COMPLIANCE_PERMISSIONS,
  GROWTH_ROLE_NAMES,
} from './shared/growth-access.catalog';
import { GrowthDataSourcesResolver } from './sources/resolvers/growth-data-sources.resolver';
import { GrowthTeamResolver } from './team/resolvers/growth-team.resolver';
import {
  GrowthOrganizationsResolver,
  GrowthPeopleResolver,
  GrowthPropertiesResolver,
} from './prospects/resolvers/prospect-records.resolver';
import { GrowthProspectOperationsResolver } from './prospects/resolvers/prospect-operations.resolver';

/**
 * Matriz rol × operación con el guard REAL de la plataforma. Los permisos de
 * cada rol salen del seed, que es lo que llega al JWT.
 */

const RESOLVERS = [
  GrowthActivityResolver,
  GrowthTeamResolver,
  GrowthDataSourcesResolver,
  GrowthComplianceResolver,
  GrowthOrganizationsResolver,
  GrowthPeopleResolver,
  GrowthPropertiesResolver,
  GrowthProspectOperationsResolver,
];

type Operation = {
  resolver: (typeof RESOLVERS)[number];
  method: string;
  handler: (...args: unknown[]) => unknown;
  name: string;
  kind: 'Query' | 'Mutation';
};

const operations: Operation[] = RESOLVERS.flatMap((resolver) =>
  Object.getOwnPropertyNames(resolver.prototype)
    .filter((m) => m !== 'constructor')
    .map((method) => {
      const handler = resolver.prototype[method] as Operation['handler'];
      return {
        resolver,
        method,
        handler,
        name: Reflect.getMetadata('graphql:resolver_name', handler) as string,
        kind: Reflect.getMetadata(
          'graphql:resolver_type',
          handler,
        ) as Operation['kind'],
      };
    })
    .filter((op) => op.kind === 'Query' || op.kind === 'Mutation'),
);

const permissionsOf = (role: ValidRoles): P[] =>
  ROLES_TO_SEED.find((r) => r.name === role)?.permissions ?? [];

const guard = new UniversalRolePermissionGuard(new Reflector());

async function allowed(
  op: Operation,
  user: { roles: string[]; permissions: string[] },
): Promise<boolean> {
  const ctx = new ExecutionContextHost(
    [{}, {}, { req: { user: { ...user, email: 'test@alternaqj.com' } } }, {}],
    op.resolver,
    op.handler,
  );
  ctx.setType('graphql');
  try {
    return await guard.canActivate(ctx);
  } catch {
    return false;
  }
}

const OPERATIONAL_ROLES = Object.values(ValidRoles).filter(
  (r) =>
    !(GROWTH_ROLE_NAMES as string[]).includes(r) &&
    r !== ValidRoles.SUPER_ADMIN_ROL,
);

describe('Autorización de la Growth Suite', () => {
  it('encuentra todas las operaciones de la fase 0', () => {
    expect(operations.map((o) => o.name).sort()).toEqual(
      [
        'growthActivity',
        'growthAddSuppression',
        'growthAddTeamMember',
        'growthApproveDataSourceCost',
        'growthCloseDataSubjectRequest',
        'growthCreateDataSource',
        'growthCreateDataSubjectRequest',
        'growthCreateLegalHold',
        'growthDataSources',
        'growthDataSubjectRequests',
        'growthDeactivateTeamMember',
        'growthExtendDataSubjectRequest',
        'growthIsSuppressed',
        'growthLegalHolds',
        'growthLiftSuppression',
        'growthReleaseLegalHold',
        'growthReviewDataSourceLegal',
        'growthSetDataSourceStatus',
        'growthStartDataSubjectRequest',
        'growthSuppressionKeyStatus',
        'growthSuppressions',
        'growthTeamMembers',
        'growthUpdateDataSource',
        'growthUpdateTeamMember',
        // Entrega 1A
        'growthOrganizations',
        'growthOrganization',
        'growthCreateOrganization',
        'growthUpdateOrganization',
        'growthPeople',
        'growthPerson',
        'growthCreatePerson',
        'growthUpdatePerson',
        'growthProperties',
        'growthProperty',
        'growthCreateProperty',
        'growthUpdateProperty',
        'growthAddOrganizationChannel',
        'growthAddPersonChannel',
        'growthVerifyOrganizationChannel',
        'growthVerifyPersonChannel',
        'growthDiscardChannel',
        'growthLinkEmployment',
        'growthEndEmployment',
        'growthSetPropertyManager',
        'growthEndPropertyManagement',
        'growthEvidences',
        'growthAddEvidence',
        'growthVerifyEvidence',
        'growthMarkEvidenceObsolete',
        'growthReviewQueue',
        'growthValidationChecklist',
        'growthSubmitForReview',
        'growthTakeForValidation',
        'growthReleaseValidation',
        'growthDecideValidation',
        'growthReopenValidation',
        'growthAssignProspect',
        'growthUnassignProspect',
        'growthAssignmentHistory',
        'growthSetPersonLegalBasis',
        'growthSetPersonContactStatus',
        'growthProspectDashboard',
        'growthSettings',
        'growthUpdateSettings',
      ].sort(),
    );
  });

  it('toda operación pasa por JwtAuthGuard + UniversalRolePermissionGuard y exige permiso o rol', () => {
    for (const op of operations) {
      const guards = (Reflect.getMetadata(GUARDS_METADATA, op.handler) ??
        []) as unknown[];
      expect({ op: op.name, jwt: guards.includes(JwtAuthGuard) }).toEqual({
        op: op.name,
        jwt: true,
      });
      expect(guards).toContain(UniversalRolePermissionGuard);
      const perms = (Reflect.getMetadata('permissions', op.handler) ??
        []) as string[];
      const roles = (Reflect.getMetadata('roles', op.handler) ??
        []) as string[];
      expect({ op: op.name, guarded: perms.length + roles.length > 0 }).toEqual(
        {
          op: op.name,
          guarded: true,
        },
      );
    }
  });

  it('ningún nombre de operación pública prefijo distinto de growth (evita choques con el esquema actual)', () => {
    for (const op of operations) expect(op.name).toMatch(/^growth[A-Z]/);
  });

  it.each(OPERATIONAL_ROLES)(
    '%s (rol operativo, con sus permisos reales) no ejecuta ninguna operación de la suite',
    async (role) => {
      const user = {
        roles: [role, ValidRoles.RESIDENT_ROL],
        permissions: permissionsOf(role),
      };
      const granted: string[] = [];
      for (const op of operations)
        if (await allowed(op, user)) granted.push(op.name);
      expect(granted).toEqual([]);
    },
  );

  it('SUPER_ADMIN ejecuta todo (bypass del guard, igual que en el resto de la plataforma)', async () => {
    for (const op of operations) {
      expect(
        await allowed(op, {
          roles: [ValidRoles.SUPER_ADMIN_ROL],
          permissions: [],
        }),
      ).toBe(true);
    }
  });

  describe('roles de la suite', () => {
    const expectations: Record<string, { can: string[]; cannot: string[] }> = {
      [ValidRoles.SALES_ROL]: {
        can: [
          'growthTeamMembers',
          'growthDataSources',
          'growthAddSuppression',
          'growthIsSuppressed',
          'growthActivity',
        ],
        cannot: [
          'growthLiftSuppression',
          'growthSuppressions',
          'growthAddTeamMember',
          'growthApproveDataSourceCost',
          'growthReviewDataSourceLegal',
          'growthCreateLegalHold',
          'growthDataSubjectRequests',
          'growthCreateDataSource',
          'growthDecideValidation',
          'growthVerifyEvidence',
          'growthAssignProspect',
          'growthSetPersonLegalBasis',
          'growthSetPersonContactStatus',
          'growthUpdateSettings',
        ],
      },
      [ValidRoles.GROWTH_RESEARCHER_ROL]: {
        can: [
          'growthTeamMembers',
          'growthDataSources',
          'growthAddSuppression',
          'growthActivity',
          'growthCreateOrganization',
          'growthAddEvidence',
          'growthOrganizations',
        ],
        cannot: [
          'growthLiftSuppression',
          'growthAddTeamMember',
          'growthSetDataSourceStatus',
          'growthCreateDataSubjectRequest',
          'growthDecideValidation',
          'growthVerifyEvidence',
          'growthAssignProspect',
          'growthSetPersonContactStatus',
        ],
      },
      [ValidRoles.GROWTH_MANAGER_ROL]: {
        can: [
          'growthAddTeamMember',
          'growthDeactivateTeamMember',
          'growthCreateDataSource',
          'growthSetDataSourceStatus',
          'growthSuppressions',
          'growthAddSuppression',
          'growthCreateDataSubjectRequest',
          'growthCloseDataSubjectRequest',
          'growthTakeForValidation',
          'growthDecideValidation',
          'growthVerifyEvidence',
          'growthAssignProspect',
        ],
        cannot: [
          'growthLiftSuppression',
          'growthApproveDataSourceCost',
          'growthReviewDataSourceLegal',
          'growthCreateLegalHold',
          'growthReleaseLegalHold',
          'growthSetPersonLegalBasis',
          'growthSetPersonContactStatus',
          'growthUpdateSettings',
        ],
      },
    };

    it.each(Object.entries(expectations))(
      '%s',
      async (role, { can, cannot }) => {
        const user = {
          roles: [role],
          permissions: permissionsOf(role as ValidRoles),
        };
        for (const name of can) {
          const op = operations.find((o) => o.name === name)!;
          expect({ name, ok: await allowed(op, user) }).toEqual({
            name,
            ok: true,
          });
        }
        for (const name of cannot) {
          const op = operations.find((o) => o.name === name)!;
          expect({ name, ok: await allowed(op, user) }).toEqual({
            name,
            ok: false,
          });
        }
      },
    );

    it('un DENY por usuario (permiso ausente del JWT) quita el acceso al gerente', async () => {
      const perms = permissionsOf(ValidRoles.GROWTH_MANAGER_ROL).filter(
        (p) => p !== P.MANAGE_GROWTH_TEAM,
      );
      const op = operations.find((o) => o.name === 'growthAddTeamMember')!;
      expect(
        await allowed(op, {
          roles: [ValidRoles.GROWTH_MANAGER_ROL],
          permissions: perms,
        }),
      ).toBe(false);
    });
  });

  it('COMPILANCE_OFFICER_ROL tras la activación: lado legal sí, gasto y equipo no', async () => {
    const user = {
      roles: [ValidRoles.COMPILANCE_OFFICER_ROL],
      permissions: [
        ...permissionsOf(ValidRoles.COMPILANCE_OFFICER_ROL),
        ...GROWTH_COMPLIANCE_PERMISSIONS,
      ],
    };
    const check = async (name: string) =>
      allowed(
        operations.find((o) => o.name === name)!,
        user,
      );
    expect(await check('growthLiftSuppression')).toBe(true);
    expect(await check('growthCreateLegalHold')).toBe(true);
    expect(await check('growthReviewDataSourceLegal')).toBe(true);
    expect(await check('growthApproveDataSourceCost')).toBe(false);
    expect(await check('growthAddTeamMember')).toBe(false);
    // Base jurídica y contacto: solo cumplimiento; no registra ni valida.
    expect(await check('growthSetPersonLegalBasis')).toBe(true);
    expect(await check('growthSetPersonContactStatus')).toBe(true);
    expect(await check('growthCreateOrganization')).toBe(false);
    expect(await check('growthDecideValidation')).toBe(false);
  });

  describe('sin caminos alternativos', () => {
    it('no existe ninguna operación que borre o edite exclusiones, actividad, solicitudes o retenciones', () => {
      const forbidden = operations
        .filter((o) => o.kind === 'Mutation')
        .map((o) => o.name)
        .filter((n) =>
          /(delete|remove|purge|unsuppress|update(Suppression|Activity|DataSubjectRequest|LegalHold)|edit)/i.test(
            n,
          ),
        );
      expect(forbidden).toEqual([]);
    });

    it('el registro de actividad no tiene mutaciones ni métodos de edición/borrado', () => {
      expect(
        operations.filter(
          (o) => o.resolver === GrowthActivityResolver && o.kind === 'Mutation',
        ),
      ).toEqual([]);
      const methods = Object.getOwnPropertyNames(
        ActivityLogService.prototype,
      ).filter((m) => m !== 'constructor');
      expect(methods.sort()).toEqual(['list', 'record']);
    });

    it('el servicio de exclusiones no tiene métodos de borrado ni edición libre', () => {
      const methods = Object.getOwnPropertyNames(SuppressionsService.prototype);
      expect(
        methods.filter((m) =>
          /delete|remove|update|edit|unlift|reactivate/i.test(m),
        ),
      ).toEqual([]);
    });

    it('levantar una exclusión exige el permiso más alto y nadie de la suite lo tiene', () => {
      const op = operations.find((o) => o.name === 'growthLiftSuppression')!;
      expect(Reflect.getMetadata('permissions', op.handler)).toEqual([
        P.LIFT_GROWTH_SUPPRESSIONS,
      ]);
      for (const role of GROWTH_ROLE_NAMES) {
        expect(permissionsOf(role)).not.toContain(P.LIFT_GROWTH_SUPPRESSIONS);
      }
    });
  });
});
