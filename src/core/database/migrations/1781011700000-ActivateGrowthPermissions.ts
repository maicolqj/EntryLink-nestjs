import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite: activa todos los permisos del grupo GROWTH.
 *
 * Decisión del dueño de la plataforma (2026-11-05): mientras opere solo,
 * SUPER_ADMIN debe poder hacer todo en la suite, incluido validar lo que él
 * mismo registra (la excepción de autovalidación sigue auditada en
 * `growth.activity_events`). Desde la política de SUPER_ADMIN, un permiso
 * inactivo no autoriza a nadie, tampoco a él; por eso se activan aquí.
 *
 * Solo cambia `permissions.status`. NO asigna permisos a roles ni activa los
 * roles de la suite: GROWTH_MANAGER_ROL, SALES_ROL y GROWTH_RESEARCHER_ROL
 * siguen inactivos y un rol inactivo no concede nada. Lo que el oficial de
 * cumplimiento tenga asignado por el §4 de ACTIVATION.md queda vigente.
 *
 * Incluye los de activación manual (MANAGE_GROWTH_IMPORT_TEMPLATES y
 * APPROVE_GROWTH_SCORING): siguen sin rol; el seed no les cambia el estado
 * (`preserveStatus`), así que no se vuelven a apagar.
 */
export class ActivateGrowthPermissions1781011700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `UPDATE "permissions" SET "status" = true WHERE "group" = 'GROWTH' AND "status" IS DISTINCT FROM true`,
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    // Vuelve al estado con el que nacen: todos inactivos.
    await queryRunner.query(
      `UPDATE "permissions" SET "status" = false WHERE "group" = 'GROWTH'`,
    );
  }
}
