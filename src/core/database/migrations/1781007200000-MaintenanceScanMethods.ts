import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Cómo se identifica el sitio de un daño en las apps: QR, chip NFC o ambos.
 *
 * Cada conjunto pega lo que tiene. Un botón "Leer chip NFC" en un conjunto que
 * solo tiene stickers QR invita a acercar el celular a una pared que no
 * responde. QR nace encendido (es lo que ya existía); NFC apagado hasta que la
 * administración grabe y pegue los chips.
 */
export class MaintenanceScanMethods1781007200000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        ADD COLUMN IF NOT EXISTS "maintenance_qr_enabled" boolean NOT NULL DEFAULT true,
        ADD COLUMN IF NOT EXISTS "maintenance_nfc_enabled" boolean NOT NULL DEFAULT false
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "residential_complexes"
        DROP COLUMN IF EXISTS "maintenance_qr_enabled",
        DROP COLUMN IF EXISTS "maintenance_nfc_enabled"
    `);
  }
}
