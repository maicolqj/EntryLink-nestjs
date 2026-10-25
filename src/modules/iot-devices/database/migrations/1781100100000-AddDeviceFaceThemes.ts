import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Temas de caras. Sigue siendo SOLO aditiva respecto a producción: crea una
 * tabla nueva y añade dos columnas a `iot_devices`, que es una tabla de ESTE
 * módulo (la crea la migración anterior, 1781100000000). Ninguna tabla
 * existente de EntryLink se toca. down() lo revierte.
 */
export class AddDeviceFaceThemes1781100100000 implements MigrationInterface {
  public async up(q: QueryRunner): Promise<void> {
    await q.query(`
      CREATE TABLE IF NOT EXISTS "iot_device_face_themes" (
        "id" varchar(24) PRIMARY KEY,
        "nombre" varchar(40) NOT NULL,
        "kind" varchar(8) NOT NULL,
        "requires" varchar(8) NOT NULL DEFAULT 'none',
        "preview_url" varchar(300),
        "activo" boolean NOT NULL DEFAULT true,
        "sort_order" smallint NOT NULL DEFAULT 0
      )`);
    // Semilla: los dos temas vectoriales que trae el firmware
    await q.query(`
      INSERT INTO "iot_device_face_themes" ("id","nombre","kind","requires","activo","sort_order")
      VALUES ('classic','Clásico','VECTOR','none',true,0),
             ('minimal','Minimalista','VECTOR','none',true,1)
      ON CONFLICT ("id") DO NOTHING`);
    await q.query(
      `ALTER TABLE "iot_devices" ADD COLUMN IF NOT EXISTS "face_theme" varchar(24) NOT NULL DEFAULT 'classic'`,
    );
    await q.query(
      `ALTER TABLE "iot_devices" ADD COLUMN IF NOT EXISTS "capabilities" jsonb`,
    );
  }

  public async down(q: QueryRunner): Promise<void> {
    await q.query(
      `ALTER TABLE "iot_devices" DROP COLUMN IF EXISTS "capabilities"`,
    );
    await q.query(
      `ALTER TABLE "iot_devices" DROP COLUMN IF EXISTS "face_theme"`,
    );
    await q.query(`DROP TABLE IF EXISTS "iot_device_face_themes"`);
  }
}
