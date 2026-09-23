import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Separa el directorio de servicios de los clasificados.
 *
 * 1. `marketplace_settings.service_listing_duration_days`: vigencia propia de
 *    los avisos de servicio. Nace en 180 días; los clasificados siguen en la
 *    suya (30 por defecto).
 *
 * 2. El interruptor `SERVICIOS` en `enabledModules`. Hasta hoy los servicios
 *    vivían detrás de `CLASIFICADOS`, así que todo conjunto que tenía los
 *    clasificados encendidos tenía también el directorio. Se le agrega
 *    `SERVICIOS` para que nadie amanezca sin los servicios que ya publicó. Los
 *    conjuntos con la lista vacía (= todo encendido) no se tocan.
 *
 * `enabledModules` es `simple-array`: texto separado por comas y columna en
 * camelCase, por eso va entrecomillada. Se compara rodeado de comas para no
 * confundir un módulo con otro que lo contenga.
 */
export class MarketplaceServiceDirectory1781006600000 implements MigrationInterface {
  name = 'MarketplaceServiceDirectory1781006600000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      ALTER TABLE "marketplace_settings"
        ADD COLUMN IF NOT EXISTS "service_listing_duration_days" integer NOT NULL DEFAULT 180
    `);

    await queryRunner.query(`
      UPDATE "residential_complexes"
         SET "enabledModules" = "enabledModules" || ',SERVICIOS'
       WHERE "enabledModules" IS NOT NULL
         AND "enabledModules" <> ''
         AND ',' || "enabledModules" || ',' LIKE '%,CLASIFICADOS,%'
         AND ',' || "enabledModules" || ',' NOT LIKE '%,SERVICIOS,%'
    `);
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "residential_complexes"
         SET "enabledModules" = TRIM(BOTH ',' FROM REPLACE(',' || "enabledModules" || ',', ',SERVICIOS,', ','))
       WHERE ',' || "enabledModules" || ',' LIKE '%,SERVICIOS,%'
    `);

    await queryRunner.query(`
      ALTER TABLE "marketplace_settings"
        DROP COLUMN IF EXISTS "service_listing_duration_days"
    `);
  }
}
