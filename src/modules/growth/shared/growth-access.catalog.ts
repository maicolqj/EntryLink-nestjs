import { ValidPermissions } from '../../permissions/enums/valid-permissions';
import { ValidRoles } from '../../roles/enums/valid-roles';

/**
 * Catálogo de acceso de la Growth Suite: única fuente de verdad para los
 * seeds y las pruebas. La migración `GrowthRolesAndPermissionsData` guarda
 * una copia fija (las migraciones no importan código de la app) y
 * `growth-access.catalog.spec.ts` falla si las dos se separan.
 *
 * Todo nace INACTIVO (status = false): con GROWTH_ENABLED apagada los roles
 * no se pueden asignar y los permisos no se ofrecen. La activación está
 * documentada en `docs/growth/ACTIVATION.md`.
 */

export const GROWTH_PERMISSION_GROUP = 'GROWTH';

export interface GrowthPermissionDefinition {
  id: string;
  name: ValidPermissions;
  label: string;
  description: string;
  level: 'LOW' | 'MEDIUM' | 'HIGH' | 'CRITICAL';
  dependsOn: ValidPermissions[];
}

export interface GrowthRoleDefinition {
  id: string;
  name: ValidRoles;
  frontName: string;
  description: string;
  icon: string;
  hierarchyLevel: number;
  permissions: ValidPermissions[];
}

const P = ValidPermissions;

export const GROWTH_PERMISSIONS: GrowthPermissionDefinition[] = [
  {
    id: '92777187-586e-4a96-b3e7-577541732c7c',
    name: P.VIEW_GROWTH_TEAM,
    label: 'Ver Equipo Comercial',
    description: 'Ver los integrantes del equipo comercial',
    level: 'LOW',
    dependsOn: [],
  },
  {
    id: 'c8a43349-9f53-4385-864c-89a935119010',
    name: P.MANAGE_GROWTH_TEAM,
    label: 'Administrar Equipo Comercial',
    description:
      'Agregar, editar y desactivar integrantes del equipo comercial',
    level: 'HIGH',
    dependsOn: [P.VIEW_GROWTH_TEAM],
  },
  {
    id: '99a3ca5d-e34f-4fcf-b8ab-6fdb9ccb5213',
    name: P.VIEW_GROWTH_ACTIVITY,
    label: 'Ver Actividad Comercial',
    description: 'Ver la actividad de todo el equipo comercial',
    level: 'MEDIUM',
    dependsOn: [],
  },
  {
    id: 'aa4720a2-820c-47e3-89b2-c50935ebce1d',
    name: P.VIEW_GROWTH_SOURCES,
    label: 'Ver Fuentes Comerciales',
    description: 'Ver el catálogo de fuentes de información comercial',
    level: 'LOW',
    dependsOn: [],
  },
  {
    id: '498f9b23-6365-4fd7-bece-3b679d4eb3b3',
    name: P.MANAGE_GROWTH_SOURCES,
    label: 'Administrar Fuentes Comerciales',
    description: 'Registrar y editar fuentes de información comercial',
    level: 'HIGH',
    dependsOn: [P.VIEW_GROWTH_SOURCES],
  },
  {
    id: 'd587e6e4-7571-45b3-a97f-90b5b2b65019',
    name: P.REVIEW_GROWTH_SOURCES_LEGAL,
    label: 'Revisión Jurídica de Fuentes',
    description: 'Registrar la revisión jurídica de una fuente comercial',
    level: 'CRITICAL',
    dependsOn: [P.VIEW_GROWTH_SOURCES],
  },
  {
    id: '287f0d7c-7dfd-4b98-b2a0-e92118197b81',
    name: P.APPROVE_GROWTH_PAID_SOURCES,
    label: 'Aprobar Fuentes de Pago',
    description:
      'Aprobar costo, presupuesto y tope de consumo de una fuente de pago',
    level: 'CRITICAL',
    dependsOn: [P.MANAGE_GROWTH_SOURCES],
  },
  {
    id: 'd775aa50-c9f4-426b-852b-b27006bd145d',
    name: P.VIEW_GROWTH_SUPPRESSIONS,
    label: 'Ver Lista de Exclusión',
    description: 'Ver la lista de exclusión comercial',
    level: 'MEDIUM',
    dependsOn: [],
  },
  {
    id: 'b4ca9283-3e89-46ce-aa03-8599cb9c28ff',
    name: P.ADD_GROWTH_SUPPRESSIONS,
    label: 'Agregar Exclusiones',
    description: 'Agregar un dato a la lista de exclusión y consultarla',
    level: 'MEDIUM',
    dependsOn: [],
  },
  {
    id: 'f27f0b1d-fbcf-46b6-b147-a1d947401035',
    name: P.LIFT_GROWTH_SUPPRESSIONS,
    label: 'Levantar Exclusiones',
    description: 'Levantar una exclusión con soporte jurídico',
    level: 'CRITICAL',
    dependsOn: [P.VIEW_GROWTH_SUPPRESSIONS],
  },
  {
    id: 'eb80fe43-c08d-4cfd-97b0-28938b448949',
    name: P.VIEW_GROWTH_PRIVACY_REQUESTS,
    label: 'Ver Solicitudes de Titulares',
    description: 'Ver solicitudes de titulares de datos (Ley 1581)',
    level: 'MEDIUM',
    dependsOn: [],
  },
  {
    id: 'f5608f95-7806-4fea-a547-757cffde90cc',
    name: P.MANAGE_GROWTH_PRIVACY_REQUESTS,
    label: 'Gestionar Solicitudes de Titulares',
    description: 'Registrar y resolver solicitudes de titulares de datos',
    level: 'HIGH',
    dependsOn: [P.VIEW_GROWTH_PRIVACY_REQUESTS],
  },
  {
    id: 'c9df56d8-040b-4fc3-bd23-33cb1086fce6',
    name: P.MANAGE_GROWTH_LEGAL_HOLDS,
    label: 'Gestionar Retenciones Legales',
    description: 'Crear y liberar retenciones legales sobre datos comerciales',
    level: 'CRITICAL',
    dependsOn: [],
  },
];

export const GROWTH_ROLES: GrowthRoleDefinition[] = [
  {
    id: '3d883f9f-1f86-4064-9144-188aac73a609',
    name: ValidRoles.GROWTH_MANAGER_ROL,
    frontName: 'Dirección comercial',
    description:
      'Dirección comercial de Alterna QJ: equipo, fuentes y lista de exclusión',
    icon: 'briefcase',
    hierarchyLevel: 2,
    permissions: [
      P.VIEW_GROWTH_TEAM,
      P.MANAGE_GROWTH_TEAM,
      P.VIEW_GROWTH_ACTIVITY,
      P.VIEW_GROWTH_SOURCES,
      P.MANAGE_GROWTH_SOURCES,
      P.VIEW_GROWTH_SUPPRESSIONS,
      P.ADD_GROWTH_SUPPRESSIONS,
      P.VIEW_GROWTH_PRIVACY_REQUESTS,
      P.MANAGE_GROWTH_PRIVACY_REQUESTS,
    ],
  },
  {
    id: '4869f3e7-0662-4e69-a5b9-93264c2c35e4',
    name: ValidRoles.SALES_ROL,
    frontName: 'Ejecutivo comercial',
    description: 'Ejecutivo comercial de Alterna QJ',
    icon: 'handshake',
    hierarchyLevel: 3,
    permissions: [
      P.VIEW_GROWTH_TEAM,
      P.VIEW_GROWTH_SOURCES,
      P.ADD_GROWTH_SUPPRESSIONS,
    ],
  },
  {
    id: '78a6f7b0-d7ba-4771-b51e-3473847b8696',
    name: ValidRoles.GROWTH_RESEARCHER_ROL,
    frontName: 'Investigador comercial',
    description: 'Investigación de prospectos, sin contacto comercial',
    icon: 'search',
    hierarchyLevel: 3,
    permissions: [
      P.VIEW_GROWTH_TEAM,
      P.VIEW_GROWTH_SOURCES,
      P.ADD_GROWTH_SUPPRESSIONS,
    ],
  },
];

/**
 * Permisos que recibe COMPILANCE_OFFICER_ROL al ACTIVAR la suite. No se
 * insertan en la migración: el rol ya existe y está activo, y asignarlos
 * antes sería un cambio visible en producción.
 */
export const GROWTH_COMPLIANCE_PERMISSIONS: ValidPermissions[] = [
  P.VIEW_GROWTH_TEAM,
  P.VIEW_GROWTH_ACTIVITY,
  P.VIEW_GROWTH_SOURCES,
  P.REVIEW_GROWTH_SOURCES_LEGAL,
  P.VIEW_GROWTH_SUPPRESSIONS,
  P.LIFT_GROWTH_SUPPRESSIONS,
  P.VIEW_GROWTH_PRIVACY_REQUESTS,
  P.MANAGE_GROWTH_PRIVACY_REQUESTS,
  P.MANAGE_GROWTH_LEGAL_HOLDS,
];

export const GROWTH_ROLE_NAMES: ValidRoles[] = GROWTH_ROLES.map((r) => r.name);

/**
 * Un rol de la suite solo se puede asignar si está activo. `assignJobRole` y
 * `createAdminUser` no miraban `role.status` (cualquier rol es asignable por
 * un SUPER_ADMIN), así que sin esto un rol "inactivo" igual llegaba al JWT.
 * Limitado a la suite a propósito: los roles existentes no cambian de
 * comportamiento.
 */
export function isInactiveGrowthRole(role: {
  name: string;
  status?: boolean;
}): boolean {
  return (
    (GROWTH_ROLE_NAMES as string[]).includes(role.name) && role.status !== true
  );
}
