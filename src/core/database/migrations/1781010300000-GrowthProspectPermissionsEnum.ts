import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Growth Suite, entrega 1A (1/3): valores de enum de los permisos de
 * EntryLink Prospect. Fuera de transacción: Postgres no permite usar en la
 * misma transacción un valor de enum recién agregado.
 */
export const GROWTH_PROSPECT_PERMISSION_ENUM_VALUES = [
  'VIEW_GROWTH_PROSPECTS',
  'VIEW_ALL_GROWTH_PROSPECTS',
  'EDIT_GROWTH_PROSPECTS',
  'VIEW_GROWTH_CONTACT_DATA',
  'VALIDATE_GROWTH_PROSPECTS',
  'ASSIGN_GROWTH_PROSPECTS',
  'REVIEW_GROWTH_LEGAL_BASIS',
  'AUTHORIZE_GROWTH_CONTACT',
];

export class GrowthProspectPermissionsEnum1781010300000 implements MigrationInterface {
  public transaction = false;

  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const value of GROWTH_PROSPECT_PERMISSION_ENUM_VALUES) {
      await queryRunner.query(
        `ALTER TYPE "permissions_name_enum" ADD VALUE IF NOT EXISTS '${value}'`,
      );
    }
  }

  public async down(): Promise<void> {
    // Postgres no permite quitar valores de un enum; sin filas son inocuos.
  }
}
