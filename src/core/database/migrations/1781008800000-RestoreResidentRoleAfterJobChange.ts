import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Devuelve RESIDENT_ROL a quien lo perdió cuando le cambiaron el cargo.
 *
 * Hasta 0.23.0, `updateUser` reemplazaba el rol principal en vez de cambiar
 * solo el cargo: si el principal era RESIDENT_ROL, al darle a alguien un cargo
 * (por ejemplo, oficial de cumplimiento) dejaba de ser residente. Se repara con
 * el mismo criterio de BackfillResidentRole1781006500000: quien es residente
 * de una unidad (ACTIVE o SUSPENDED) y quien tiene un cargo que lleva el rol
 * base.
 *
 * `is_primary` queda en false si la cuenta ya tiene otro rol: el cargo sigue
 * mandando a dónde entra con correo y contraseña. Idempotente.
 */
export class RestoreResidentRoleAfterJobChange1781008800000 implements MigrationInterface {
  name = 'RestoreResidentRoleAfterJobChange1781008800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    const inserted = (await queryRunner.query(`
      WITH resident_role AS (
        SELECT "id" FROM "roles" WHERE "name" = 'RESIDENT_ROL' LIMIT 1
      )
      INSERT INTO "user_has_roles" ("id", "user_id", "role_id", "is_primary", "assigned_at")
      SELECT
        gen_random_uuid(),
        u."id",
        rr."id",
        NOT EXISTS (
          SELECT 1 FROM "user_has_roles" x WHERE x."user_id" = u."id"
        ),
        NOW()
      FROM "users" u
      CROSS JOIN resident_role rr
      WHERE u."deleted_at" IS NULL
        AND (
          EXISTS (
            SELECT 1 FROM "residents" res
             WHERE res."user_id" = u."id"
               AND res."deleted_at" IS NULL
               AND res."status" IN ('ACTIVE', 'SUSPENDED')
          )
          OR EXISTS (
            SELECT 1 FROM "user_has_roles" uhr
              JOIN "roles" ro ON ro."id" = uhr."role_id"
             WHERE uhr."user_id" = u."id"
               AND ro."name" IN (
                 'SUPER_ADMIN_ROL',
                 'COMPILANCE_OFFICER_ROL',
                 'ACCOUNTANT_ROL',
                 'SUPERVISOR_ROL',
                 'SECURITY_ROL'
               )
          )
        )
        AND NOT EXISTS (
          SELECT 1 FROM "user_has_roles" ur
           WHERE ur."user_id" = u."id" AND ur."role_id" = rr."id"
        )
      RETURNING "user_id"
    `)) as { user_id: string }[];

    console.log(
      `[RestoreResidentRoleAfterJobChange] RESIDENT_ROL devuelto a ${inserted?.length ?? 0} cuenta(s).`,
    );
  }

  public async down(): Promise<void> {
    // No se deshace: quitarle otra vez el rol base a esas cuentas sería
    // reintroducir el error.
  }
}
