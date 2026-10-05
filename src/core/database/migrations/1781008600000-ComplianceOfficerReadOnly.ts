import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El oficial de cumplimiento revisa (registros de conjuntos, DPA, documentos
 * legales, auditoría) pero no opera los conjuntos: se le quita el permiso de
 * editar residentes, que traía del seed original.
 *
 * El valor en la base es 'EDIT_RECIDENTS' (así lo define
 * ValidPermissions.EDIT_RESIDENTS; el error de tipeo se mantiene para no
 * romper datos).
 *
 * Se hace aquí y no solo en el seed: una base ya cargada no vuelve a correr
 * los seeds. Los permisos viajan en el JWT, así que el cambio aplica desde el
 * próximo inicio de sesión o renovación del token.
 */
export class ComplianceOfficerReadOnly1781008600000 implements MigrationInterface {
  name = 'ComplianceOfficerReadOnly1781008600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
       USING "roles" ro, "permissions" p
       WHERE ro."id" = rp."role_id"
         AND p."id" = rp."permission_id"
         AND ro."name" = 'COMPILANCE_OFFICER_ROL'
         AND p."name" = 'EDIT_RECIDENTS'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT ro."id", p."id"
        FROM "roles" ro
        JOIN "permissions" p ON p."name" = 'EDIT_RECIDENTS'
       WHERE ro."name" = 'COMPILANCE_OFFICER_ROL'
      ON CONFLICT DO NOTHING
    `);
  }
}
