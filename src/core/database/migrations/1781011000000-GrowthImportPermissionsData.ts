import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, entrega 1C (2/3): permiso de importaciones, INACTIVO,
 * asignado a GROWTH_MANAGER_ROL y GROWTH_RESEARCHER_ROL (también inactivos).
 * Copia fija del catálogo; su spec falla si se separan.
 */
export const GROWTH_IMPORT_PERMISSION_ROWS: Array<{
  id: string;
  name: string;
  label: string;
  description: string;
  level: string;
  dependsOn: string[];
}> = [
  {
    id: '0f70355f-ebc8-41c0-83d0-2fc39725d123',
    name: 'IMPORT_GROWTH_DATA',
    label: 'Importar Prospectos',
    description: 'Importar empresas, personas y copropiedades desde CSV o XLSX',
    level: 'HIGH',
    dependsOn: ['EDIT_GROWTH_PROSPECTS'],
  },
];

export const GROWTH_IMPORT_ROLE_GRANTS: Record<string, string[]> = {
  GROWTH_MANAGER_ROL: ['IMPORT_GROWTH_DATA'],
  GROWTH_RESEARCHER_ROL: ['IMPORT_GROWTH_DATA'],
};

export class GrowthImportPermissionsData1781011000000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const p of GROWTH_IMPORT_PERMISSION_ROWS) {
      await queryRunner.query(
        `INSERT INTO "permissions" ("id", "name", "label", "description", "group", "level", "isSystem", "status")
         VALUES ($1, $2, $3, $4, 'GROWTH', $5, false, false)
         ON CONFLICT DO NOTHING`,
        [p.id, p.name, p.label, p.description, p.level],
      );
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
    for (const [role, perms] of Object.entries(GROWTH_IMPORT_ROLE_GRANTS)) {
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
    const names = GROWTH_IMPORT_PERMISSION_ROWS.map((p) => p.name);
    for (const sql of [
      `DELETE FROM "role_permissions" rp USING "permissions" p WHERE p."id" = rp."permission_id" AND p."name"::text = ANY($1::text[])`,
      `DELETE FROM "user_permission_overrides" upo USING "permissions" p WHERE p."id" = upo."permission_id" AND p."name"::text = ANY($1::text[])`,
      `DELETE FROM "permission_dependencies" pd USING "permissions" p WHERE (p."id" = pd."permission_id" OR p."id" = pd."depends_on_id") AND p."name"::text = ANY($1::text[])`,
      `DELETE FROM "permissions" WHERE "name"::text = ANY($1::text[])`,
    ]) {
      await queryRunner.query(sql, [names]);
    }
  }
}
