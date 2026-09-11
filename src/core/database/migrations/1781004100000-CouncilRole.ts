import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * El consejo de administración pasa de ser una casilla del residente a un rol.
 *
 * Nació como `residents.is_council_member` porque lo único que hacía era
 * habilitar la reserva gratuita. Con los PQRF dirigidos al consejo aparece una
 * frontera de permisos —una queja CONTRA el administrador no puede quedar
 * visible para el administrador—, y eso lo resuelve un rol, no una columna.
 *
 * Se deja una sola fuente de verdad: `user_has_roles`. La casilla de la ficha
 * del residente sigue existiendo en la UI, pero ahora asigna y quita el rol.
 *
 * Corre FUERA de transacción (`transaction = false`) porque Postgres no permite
 * usar un valor de enum recién agregado dentro de la misma transacción en que
 * se agregó, y aquí hace falta agregarlo y usarlo de inmediato.
 */
export class CouncilRole1781004100000 implements MigrationInterface {

  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "roles_name_enum" ADD VALUE IF NOT EXISTS 'COUNCIL_ROL'`,
    );

    // El rol se crea aquí y no solo en el seed porque el backfill de abajo lo
    // necesita: una base ya cargada no vuelve a correr los seeds.
    await queryRunner.query(`
      INSERT INTO "roles" ("id", "name", "description", "frontName", "icon", "hierarchyLevel")
      VALUES (
        'c4d5e6f7-a8b9-4c0d-8e1f-2a3b4c5d6e7f',
        'COUNCIL_ROL',
        'Miembro del consejo de administración del complejo',
        'Consejo de administración',
        'account_balance',
        4
      )
      ON CONFLICT DO NOTHING
    `);

    // Lo ya marcado se convierte en rol: nadie pierde el beneficio.
    await queryRunner.query(`
      INSERT INTO "user_has_roles" ("user_id", "role_id", "is_primary")
      SELECT DISTINCT r."user_id", ro."id", false
        FROM "residents" r
        JOIN "roles" ro ON ro."name" = 'COUNCIL_ROL'
       WHERE r."is_council_member" = true
         AND r."deleted_at" IS NULL
         AND NOT EXISTS (
           SELECT 1 FROM "user_has_roles" uhr
            WHERE uhr."user_id" = r."user_id" AND uhr."role_id" = ro."id"
         )
    `);

    await queryRunner.query(`
      DROP INDEX IF EXISTS "IDX_residents_council_member"
    `);
    await queryRunner.query(`
      ALTER TABLE "residents" DROP COLUMN IF EXISTS "is_council_member"
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residents"
        ADD COLUMN IF NOT EXISTS "is_council_member" boolean NOT NULL DEFAULT false
    `);

    await queryRunner.query(`
      UPDATE "residents" r
         SET "is_council_member" = true
        FROM "user_has_roles" uhr
        JOIN "roles" ro ON ro."id" = uhr."role_id"
       WHERE uhr."user_id" = r."user_id" AND ro."name" = 'COUNCIL_ROL'
    `);

    await queryRunner.query(`
      CREATE INDEX IF NOT EXISTS "IDX_residents_council_member"
        ON "residents" ("complex_id")
        WHERE "is_council_member" = true
    `);

    await queryRunner.query(`
      DELETE FROM "user_has_roles" uhr
       USING "roles" ro
       WHERE ro."id" = uhr."role_id" AND ro."name" = 'COUNCIL_ROL'
    `);
    await queryRunner.query(`DELETE FROM "roles" WHERE "name" = 'COUNCIL_ROL'`);

    // El label del enum no se quita: Postgres no permite eliminar valores.
  }
}
