import { ValidPermissions } from "../../../../modules/permissions/enums/valid-permissions";
import { ValidRoles } from "../../../../modules/roles/enums/valid-roles";

export interface RoleSeedData {
  id: string;
  name: ValidRoles;
  description: string;
  permissions: ValidPermissions[];
  frontName: string;
  icon: string;
  hierarchyLevel: number;
}

export const ROLES_TO_SEED: RoleSeedData[] = [
  {
    id: 'f3b9d0a1-b2c3-4d4e-af6a-7b8c9d0e1f2b',
    name: ValidRoles.SUPER_ADMIN_ROL,
    description: 'Control total del ecosistema residencial',
    permissions: [ValidPermissions.SUPERADMIN],
    frontName: 'Super Administrador',
    icon: 'shield-check',
    hierarchyLevel: 0,
  },
  {
    id: 'a1b2c3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5e',
    name: ValidRoles.SECURITY_ROL,
    description: 'Personal de vigilancia y control de accesos',
    permissions: [
      ValidPermissions.VIEW_RESIDENTS,
      ValidPermissions.VIEW_RECIDENTS_LOCATION,
      ValidPermissions.VIEW_PACKAGES,
      ValidPermissions.CREATE_PACKAGE,
      ValidPermissions.VIEW_NOTIFICATIONS,
    ],
    frontName: 'Recepción',
    icon: 'security',
    hierarchyLevel: 3,
  },
  {
    id: 'c1b2a3d4-e5f6-4a7b-8c9d-0e1f2a3b4c5d',
    name: ValidRoles.COMPILANCE_OFFICER_ROL,
    description: 'Encargado de validación de documentos y normativa',
    permissions: [
      ValidPermissions.VIEW_USERS,
      ValidPermissions.VIEW_RESIDENTS,
      ValidPermissions.EDIT_RESIDENTS,
      ValidPermissions.VIEW_REPORTS,
      ValidPermissions.EXPORT_REPORTS,
      ValidPermissions.VIEW_RESIDENCES,
    ],
    frontName: 'Oficial de Cumplimiento',
    icon: 'gavel',
    hierarchyLevel: 1,
  },
  {
    id: 'd8e9f0a1-b2c3-4d4e-af6a-7b8c9d0e1f2c',
    name: ValidRoles.RESIDENT_ROL,
    description: 'Usuario final del complejo residencial',
    permissions: [
      ValidPermissions.VIEW_NOTIFICATIONS,
      ValidPermissions.VIEW_PRODUCTS,
      ValidPermissions.CREATE_PACKAGE,
    ],
    frontName: 'Residente',
    icon: 'home',
    hierarchyLevel: 4,
  },
  {
    id: 'e2f3a4b5-c6d7-4e8f-9a0b-1c2d3e4f5a6b',
    name: ValidRoles.SUPERVISOR_ROL,
    description: 'Supervisor de operaciones y personal de seguridad',
    permissions: [
      ValidPermissions.VIEW_USERS,
      ValidPermissions.VIEW_RESIDENTS,
      ValidPermissions.BLOCK_RESIDENTS,
      ValidPermissions.MANAGE_PACKAGES,
      ValidPermissions.SEND_NOTIFICATIONS,
      ValidPermissions.VIEW_RESIDENCES,
    ],
    frontName: 'Supervisor',
    icon: 'eye',
    hierarchyLevel: 2,
  },
  {
    id: 'd1e2f3a4-b5c6-4d7e-8f9a-0b1c2d3e4f5a',
    name: ValidRoles.ACCOUNTANT_ROL,
    description: 'Gestión financiera y reportes',
    permissions: [
      ValidPermissions.VIEW_REPORTS,
      ValidPermissions.EXPORT_REPORTS,
      ValidPermissions.VIEW_RESIDENCES,
    ],
    frontName: 'Contador',
    icon: 'calculator',
    hierarchyLevel: 2,
  },
  {
    id: 'c9b8a7f6-e5d4-4321-8901-234567890def',
    name: ValidRoles.COMPLEX_ROL,
    description: 'Administrador de complejo específico',
    permissions: [
      ValidPermissions.VIEW_RESIDENTS,
      ValidPermissions.VIEW_RESIDENCES,
      ValidPermissions.CREATE_RESIDENCE,
      ValidPermissions.EDIT_RESIDENCE,
      ValidPermissions.TOGGLE_RESIDENCE_STATUS,
      ValidPermissions.MANAGE_RESIDENCES,
      ValidPermissions.VIEW_REPORTS,
    ],
    frontName: 'Administrador de Complejo',
    icon: 'office-building',
    hierarchyLevel: 1,
  },
];