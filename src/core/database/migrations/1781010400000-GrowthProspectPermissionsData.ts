import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, entrega 1A (2/3): permisos de EntryLink Prospect, INACTIVOS
 * (status = false) como los de la fase 0, y su asignación a los roles de la
 * suite (también inactivos). COMPILANCE_OFFICER_ROL los recibe al activar
 * (docs/growth/ACTIVATION.md).
 *
 * Copia fija del catálogo growth-access.catalog.ts; su spec falla si se
 * separan.
 */
export const GROWTH_PROSPECT_PERMISSION_ROWS: Array<{
  id: string;
  name: string;
  label: string;
  description: string;
  level: string;
  dependsOn: string[];
}> = [
  {
    id: 'fb6cad3f-bbb5-4cc1-9af2-f62b193c14ac',
    name: 'VIEW_GROWTH_PROSPECTS',
    label: 'Ver Prospectos',
    description: 'Ver los prospectos asignados o registrados por uno mismo',
    level: 'LOW',
    dependsOn: [],
  },
  {
    id: '0e98cdbf-39f9-4310-b7fa-0b59ddd9484a',
    name: 'VIEW_ALL_GROWTH_PROSPECTS',
    label: 'Ver Todos los Prospectos',
    description: 'Ver todos los prospectos sin importar el responsable',
    level: 'MEDIUM',
    dependsOn: ['VIEW_GROWTH_PROSPECTS'],
  },
  {
    id: '333fdf4a-7c42-4b57-ad29-aa1b83c483ec',
    name: 'EDIT_GROWTH_PROSPECTS',
    label: 'Editar Prospectos',
    description:
      'Registrar y editar empresas, personas, copropiedades y evidencias',
    level: 'MEDIUM',
    dependsOn: ['VIEW_GROWTH_PROSPECTS'],
  },
  {
    id: 'd1c0440b-43dc-43b2-9230-efc0d828452d',
    name: 'VIEW_GROWTH_CONTACT_DATA',
    label: 'Ver Datos de Contacto de Personas',
    description: 'Ver en claro correos y teléfonos de personas',
    level: 'CRITICAL',
    dependsOn: ['VIEW_GROWTH_PROSPECTS'],
  },
  {
    id: 'bbf341a5-12b8-476d-a52e-2769c89f492f',
    name: 'VALIDATE_GROWTH_PROSPECTS',
    label: 'Validar Prospectos',
    description: 'Tomar y decidir validaciones y verificar evidencias',
    level: 'HIGH',
    dependsOn: ['VIEW_GROWTH_PROSPECTS'],
  },
  {
    id: '629909d8-5e83-4938-899f-de0c213cda1d',
    name: 'ASSIGN_GROWTH_PROSPECTS',
    label: 'Asignar Prospectos',
    description: 'Asignar responsables a los prospectos',
    level: 'HIGH',
    dependsOn: ['VIEW_ALL_GROWTH_PROSPECTS'],
  },
  {
    id: '882e5670-6d7b-407a-914c-339f8d435056',
    name: 'REVIEW_GROWTH_LEGAL_BASIS',
    label: 'Revisar Base Jurídica',
    description: 'Registrar la base jurídica de tratamiento de una persona',
    level: 'CRITICAL',
    dependsOn: ['VIEW_GROWTH_PROSPECTS'],
  },
  {
    id: '025456d4-02d5-437a-bad9-ba08c8caf140',
    name: 'AUTHORIZE_GROWTH_CONTACT',
    label: 'Autorizar Contacto Comercial',
    description: 'Autorizar o revocar el contacto comercial de una persona',
    level: 'CRITICAL',
    dependsOn: ['REVIEW_GROWTH_LEGAL_BASIS'],
  },
];

/** Permisos de 1A que se suman a cada rol de la suite. */
export const GROWTH_PROSPECT_ROLE_GRANTS: Record<string, string[]> = {
  GROWTH_MANAGER_ROL: [
    'VIEW_GROWTH_PROSPECTS',
    'VIEW_ALL_GROWTH_PROSPECTS',
    'EDIT_GROWTH_PROSPECTS',
    'VIEW_GROWTH_CONTACT_DATA',
    'VALIDATE_GROWTH_PROSPECTS',
    'ASSIGN_GROWTH_PROSPECTS',
  ],
  SALES_ROL: [
    'VIEW_GROWTH_PROSPECTS',
    'EDIT_GROWTH_PROSPECTS',
    'VIEW_GROWTH_CONTACT_DATA',
  ],
  GROWTH_RESEARCHER_ROL: [
    'VIEW_GROWTH_PROSPECTS',
    'VIEW_ALL_GROWTH_PROSPECTS',
    'EDIT_GROWTH_PROSPECTS',
    'VIEW_GROWTH_CONTACT_DATA',
  ],
};

export class GrowthProspectPermissionsData1781010400000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const p of GROWTH_PROSPECT_PERMISSION_ROWS) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("id", "name", "label", "description", "group", "level", "isSystem", "status")
         VALUES ($1, $2, $3, $4, 'GROWTH', $5, false, false)
         ON CONFLICT DO NOTHING`,
        [p.id, p.name, p.label, p.description, p.level],
      );
    }
    for (const p of GROWTH_PROSPECT_PERMISSION_ROWS) {
      for (const dep of p.dependsOn) {
        await queryRunner.query(
          `INSERT INTO "permission_dependencies" ("permission_id", "depends_on_id")
           SELECT p."id", d."id" FROM "permissions" p
             JOIN "permissions" d ON d."name" = $2
            WHERE p."name" = $1
           ON CONFLICT DO NOTHING`,
          [p.name, dep],
        );
      }
    }
    for (const [role, perms] of Object.entries(GROWTH_PROSPECT_ROLE_GRANTS)) {
      await queryRunner.query(
        `INSERT INTO "role_permissions" ("role_id", "permission_id")
         SELECT ro."id", p."id" FROM "roles" ro
           JOIN "permissions" p ON p."name"::text = ANY($2::text[])
          WHERE ro."name" = $1
         ON CONFLICT DO NOTHING`,
        [role, perms],
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    const names = GROWTH_PROSPECT_PERMISSION_ROWS.map((p) => p.name);
    await queryRunner.query(
      `DELETE FROM "role_permissions" rp USING "permissions" p
        WHERE p."id" = rp."permission_id" AND p."name"::text = ANY($1::text[])`,
      [names],
    );
    await queryRunner.query(
      `DELETE FROM "user_permission_overrides" upo USING "permissions" p
        WHERE p."id" = upo."permission_id" AND p."name"::text = ANY($1::text[])`,
      [names],
    );
    await queryRunner.query(
      `DELETE FROM "permission_dependencies" pd USING "permissions" p
        WHERE (p."id" = pd."permission_id" OR p."id" = pd."depends_on_id")
          AND p."name"::text = ANY($1::text[])`,
      [names],
    );
    await queryRunner.query(
      `DELETE FROM "permissions" WHERE "name"::text = ANY($1::text[])`,
      [names],
    );
  }
}
