import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, fase 0 (2/3): filas de los roles y permisos de la suite.
 *
 * Todo nace INACTIVO (`status = false`): mientras GROWTH_ENABLED esté apagada
 * los roles no se pueden asignar y los permisos no se ofrecen en la web. La
 * activación es un paso manual y autorizado (`docs/growth/ACTIVATION.md`).
 *
 * Se insertan aquí y no solo en el seed porque en producción los seeds no se
 * vuelven a correr. Los datos son una copia fija del catálogo
 * `growth-access.catalog.ts`; su spec falla si se separan.
 *
 * COMPILANCE_OFFICER_ROL NO recibe permisos aquí: es un rol activo y
 * asignárselos ahora sería un cambio visible. Se hace al activar.
 */
export const GROWTH_PERMISSION_ROWS: Array<{
  id: string;
  name: string;
  label: string;
  description: string;
  level: string;
  dependsOn: string[];
}> = [
  {
    id: '92777187-586e-4a96-b3e7-577541732c7c',
    name: 'VIEW_GROWTH_TEAM',
    label: 'Ver Equipo Comercial',
    description: 'Ver los integrantes del equipo comercial',
    level: 'LOW',
    dependsOn: [],
  },
  {
    id: 'c8a43349-9f53-4385-864c-89a935119010',
    name: 'MANAGE_GROWTH_TEAM',
    label: 'Administrar Equipo Comercial',
    description:
      'Agregar, editar y desactivar integrantes del equipo comercial',
    level: 'HIGH',
    dependsOn: ['VIEW_GROWTH_TEAM'],
  },
  {
    id: '99a3ca5d-e34f-4fcf-b8ab-6fdb9ccb5213',
    name: 'VIEW_GROWTH_ACTIVITY',
    label: 'Ver Actividad Comercial',
    description: 'Ver la actividad de todo el equipo comercial',
    level: 'MEDIUM',
    dependsOn: [],
  },
  {
    id: 'aa4720a2-820c-47e3-89b2-c50935ebce1d',
    name: 'VIEW_GROWTH_SOURCES',
    label: 'Ver Fuentes Comerciales',
    description: 'Ver el catálogo de fuentes de información comercial',
    level: 'LOW',
    dependsOn: [],
  },
  {
    id: '498f9b23-6365-4fd7-bece-3b679d4eb3b3',
    name: 'MANAGE_GROWTH_SOURCES',
    label: 'Administrar Fuentes Comerciales',
    description: 'Registrar y editar fuentes de información comercial',
    level: 'HIGH',
    dependsOn: ['VIEW_GROWTH_SOURCES'],
  },
  {
    id: 'd587e6e4-7571-45b3-a97f-90b5b2b65019',
    name: 'REVIEW_GROWTH_SOURCES_LEGAL',
    label: 'Revisión Jurídica de Fuentes',
    description: 'Registrar la revisión jurídica de una fuente comercial',
    level: 'CRITICAL',
    dependsOn: ['VIEW_GROWTH_SOURCES'],
  },
  {
    id: '287f0d7c-7dfd-4b98-b2a0-e92118197b81',
    name: 'APPROVE_GROWTH_PAID_SOURCES',
    label: 'Aprobar Fuentes de Pago',
    description:
      'Aprobar costo, presupuesto y tope de consumo de una fuente de pago',
    level: 'CRITICAL',
    dependsOn: ['MANAGE_GROWTH_SOURCES'],
  },
  {
    id: 'd775aa50-c9f4-426b-852b-b27006bd145d',
    name: 'VIEW_GROWTH_SUPPRESSIONS',
    label: 'Ver Lista de Exclusión',
    description: 'Ver la lista de exclusión comercial',
    level: 'MEDIUM',
    dependsOn: [],
  },
  {
    id: 'b4ca9283-3e89-46ce-aa03-8599cb9c28ff',
    name: 'ADD_GROWTH_SUPPRESSIONS',
    label: 'Agregar Exclusiones',
    description: 'Agregar un dato a la lista de exclusión y consultarla',
    level: 'MEDIUM',
    dependsOn: [],
  },
  {
    id: 'f27f0b1d-fbcf-46b6-b147-a1d947401035',
    name: 'LIFT_GROWTH_SUPPRESSIONS',
    label: 'Levantar Exclusiones',
    description: 'Levantar una exclusión con soporte jurídico',
    level: 'CRITICAL',
    dependsOn: ['VIEW_GROWTH_SUPPRESSIONS'],
  },
  {
    id: 'eb80fe43-c08d-4cfd-97b0-28938b448949',
    name: 'VIEW_GROWTH_PRIVACY_REQUESTS',
    label: 'Ver Solicitudes de Titulares',
    description: 'Ver solicitudes de titulares de datos (Ley 1581)',
    level: 'MEDIUM',
    dependsOn: [],
  },
  {
    id: 'f5608f95-7806-4fea-a547-757cffde90cc',
    name: 'MANAGE_GROWTH_PRIVACY_REQUESTS',
    label: 'Gestionar Solicitudes de Titulares',
    description: 'Registrar y resolver solicitudes de titulares de datos',
    level: 'HIGH',
    dependsOn: ['VIEW_GROWTH_PRIVACY_REQUESTS'],
  },
  {
    id: 'c9df56d8-040b-4fc3-bd23-33cb1086fce6',
    name: 'MANAGE_GROWTH_LEGAL_HOLDS',
    label: 'Gestionar Retenciones Legales',
    description: 'Crear y liberar retenciones legales sobre datos comerciales',
    level: 'CRITICAL',
    dependsOn: [],
  },
];

export const GROWTH_ROLE_ROWS: Array<{
  id: string;
  name: string;
  frontName: string;
  description: string;
  icon: string;
  hierarchyLevel: number;
  permissions: string[];
}> = [
  {
    id: '3d883f9f-1f86-4064-9144-188aac73a609',
    name: 'GROWTH_MANAGER_ROL',
    frontName: 'Dirección comercial',
    description:
      'Dirección comercial de Alterna QJ: equipo, fuentes y lista de exclusión',
    icon: 'briefcase',
    hierarchyLevel: 2,
    permissions: [
      'VIEW_GROWTH_TEAM',
      'MANAGE_GROWTH_TEAM',
      'VIEW_GROWTH_ACTIVITY',
      'VIEW_GROWTH_SOURCES',
      'MANAGE_GROWTH_SOURCES',
      'VIEW_GROWTH_SUPPRESSIONS',
      'ADD_GROWTH_SUPPRESSIONS',
      'VIEW_GROWTH_PRIVACY_REQUESTS',
      'MANAGE_GROWTH_PRIVACY_REQUESTS',
    ],
  },
  {
    id: '4869f3e7-0662-4e69-a5b9-93264c2c35e4',
    name: 'SALES_ROL',
    frontName: 'Ejecutivo comercial',
    description: 'Ejecutivo comercial de Alterna QJ',
    icon: 'handshake',
    hierarchyLevel: 3,
    permissions: [
      'VIEW_GROWTH_TEAM',
      'VIEW_GROWTH_SOURCES',
      'ADD_GROWTH_SUPPRESSIONS',
    ],
  },
  {
    id: '78a6f7b0-d7ba-4771-b51e-3473847b8696',
    name: 'GROWTH_RESEARCHER_ROL',
    frontName: 'Investigador comercial',
    description: 'Investigación de prospectos, sin contacto comercial',
    icon: 'search',
    hierarchyLevel: 3,
    permissions: [
      'VIEW_GROWTH_TEAM',
      'VIEW_GROWTH_SOURCES',
      'ADD_GROWTH_SUPPRESSIONS',
    ],
  },
];

export class GrowthRolesAndPermissionsData1781010100000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const p of GROWTH_PERMISSION_ROWS) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("id", "name", "label", "description", "group", "level", "isSystem", "status")
         VALUES ($1, $2, $3, $4, 'GROWTH', $5, false, false)
         ON CONFLICT DO NOTHING`,
        [p.id, p.name, p.label, p.description, p.level],
      );
    }

    for (const p of GROWTH_PERMISSION_ROWS) {
      for (const dep of p.dependsOn) {
        await queryRunner.query(
          `INSERT INTO "permission_dependencies" ("permission_id", "depends_on_id")
           SELECT p."id", d."id"
             FROM "permissions" p
             JOIN "permissions" d ON d."name" = $2
            WHERE p."name" = $1
           ON CONFLICT DO NOTHING`,
          [p.name, dep],
        );
      }
    }

    for (const r of GROWTH_ROLE_ROWS) {
      await queryRunner.query(
        `INSERT INTO "roles" ("id", "name", "description", "frontName", "icon", "hierarchyLevel", "status", "isSystem")
         VALUES ($1, $2, $3, $4, $5, $6, false, false)
         ON CONFLICT DO NOTHING`,
        [r.id, r.name, r.description, r.frontName, r.icon, r.hierarchyLevel],
      );
      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         SELECT ro."id", p."id"
           FROM "roles" ro
           JOIN "permissions" p ON p."name"::text = ANY($2::text[])
          WHERE ro."name" = $1
         ON CONFLICT DO NOTHING`,
        [r.name, r.permissions],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const roleNames = GROWTH_ROLE_ROWS.map((r) => r.name);
    const permissionNames = GROWTH_PERMISSION_ROWS.map((p) => p.name);

    await queryRunner.query(
      `DELETE FROM "role_permissions" rp
        USING "permissions" p
        WHERE p."id" = rp."permission_id" AND p."name"::text = ANY($1::text[])`,
      [permissionNames],
    );
    await queryRunner.query(
      `DELETE FROM "user_has_roles" uhr
        USING "roles" ro
        WHERE ro."id" = uhr."role_id" AND ro."name"::text = ANY($1::text[])`,
      [roleNames],
    );
    await queryRunner.query(
      `DELETE FROM "user_permission_overrides" upo
        USING "permissions" p
        WHERE p."id" = upo."permission_id" AND p."name"::text = ANY($1::text[])`,
      [permissionNames],
    );
    await queryRunner.query(
      `DELETE FROM "permission_dependencies" pd
        USING "permissions" p
        WHERE (p."id" = pd."permission_id" OR p."id" = pd."depends_on_id")
          AND p."name"::text = ANY($1::text[])`,
      [permissionNames],
    );
    await queryRunner.query(
      `DELETE FROM "roles" WHERE "name"::text = ANY($1::text[])`,
      [roleNames],
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "name"::text = ANY($1::text[])`,
      [permissionNames],
    );
  }
}
