import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Nuevo tipo de personal: aseo y mantenimiento.
 *
 * Un ticket de mantenimiento se podía asignar a "personal interno", pero la
 * administración tenía que escribir el id del usuario a mano. Con este rol el
 * personal de mantenimiento se registra desde Personal y el tablero lo ofrece
 * por nombre.
 *
 * El rol y sus permisos se crean aquí y no solo en el seed: una base ya
 * cargada no vuelve a correr los seeds.
 *
 * Corre FUERA de transacción (`transaction = false`) porque Postgres no permite
 * usar un valor de enum recién agregado dentro de la misma transacción.
 */
export class MaintenanceStaffRole1781005500000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `ALTER TYPE "roles_name_enum" ADD VALUE IF NOT EXISTS 'MAINTENANCE_ROL'`,
    );

    await queryRunner.query(`
      INSERT INTO "roles" ("id", "name", "description", "frontName", "icon", "hierarchyLevel")
      VALUES (
        'ee40cee9-6505-4608-9032-ae429bdc7d0d',
        'MAINTENANCE_ROL',
        'Personal de aseo y mantenimiento del complejo',
        'Aseo y mantenimiento',
        'wrench',
        3
      )
      ON CONFLICT DO NOTHING
    `);

    // Ver los tickets y recibir el aviso de asignación.
    await queryRunner.query(`
      INSERT INTO "role_permissions" ("role_id", "permission_id")
      SELECT ro."id", p."id"
        FROM "roles" ro
        JOIN "permissions" p
          ON p."name" IN ('VIEW_MAINTENANCE_TICKETS', 'VIEW_NOTIFICATIONS')
       WHERE ro."name" = 'MAINTENANCE_ROL'
      ON CONFLICT DO NOTHING
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      DELETE FROM "role_permissions" rp
       USING "roles" ro
       WHERE ro."id" = rp."role_id" AND ro."name" = 'MAINTENANCE_ROL'
    `);
    await queryRunner.query(`
      DELETE FROM "user_has_roles" uhr
       USING "roles" ro
       WHERE ro."id" = uhr."role_id" AND ro."name" = 'MAINTENANCE_ROL'
    `);
    await queryRunner.query(
      `DELETE FROM "roles" WHERE "name" = 'MAINTENANCE_ROL'`,
    );

    // El label del enum no se quita: Postgres no permite eliminar valores.
  }
}
