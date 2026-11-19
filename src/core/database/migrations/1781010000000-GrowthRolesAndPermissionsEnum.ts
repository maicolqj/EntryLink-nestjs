import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, fase 0 (1/3): valores de enum para los roles y permisos de la
 * suite comercial.
 *
 * Corre FUERA de transacción (`transaction = false`) porque Postgres no
 * permite usar un valor de enum recién agregado dentro de la misma
 * transacción; la siguiente migración es la que inserta las filas.
 */
export const GROWTH_ROLE_ENUM_VALUES = [
  'GROWTH_MANAGER_ROL',
  'SALES_ROL',
  'GROWTH_RESEARCHER_ROL',
];

export const GROWTH_PERMISSION_ENUM_VALUES = [
  'VIEW_GROWTH_TEAM',
  'MANAGE_GROWTH_TEAM',
  'VIEW_GROWTH_ACTIVITY',
  'VIEW_GROWTH_SOURCES',
  'MANAGE_GROWTH_SOURCES',
  'REVIEW_GROWTH_SOURCES_LEGAL',
  'APPROVE_GROWTH_PAID_SOURCES',
  'VIEW_GROWTH_SUPPRESSIONS',
  'ADD_GROWTH_SUPPRESSIONS',
  'LIFT_GROWTH_SUPPRESSIONS',
  'VIEW_GROWTH_PRIVACY_REQUESTS',
  'MANAGE_GROWTH_PRIVACY_REQUESTS',
  'MANAGE_GROWTH_LEGAL_HOLDS',
];

export class GrowthRolesAndPermissionsEnum1781010000000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of GROWTH_ROLE_ENUM_VALUES) {
      await queryRunner.query(
        `ALTER TYPE "roles_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
    for (const value of GROWTH_PERMISSION_ENUM_VALUES) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no permite quitar valores de un enum. Sin filas que los usen
    // (las borra el down de GrowthRolesAndPermissionsData) son inocuos.
  }
}
