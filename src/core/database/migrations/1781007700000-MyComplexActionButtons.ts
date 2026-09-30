import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Botones de acción rápida de "Mi Conjunto" (llamar, correo, cómo llegar,
 * sitio web): la administración decide cuáles muestra la app. Encendidos por
 * defecto para no cambiar lo que ya ven los residentes.
 */
export class MyComplexActionButtons1781007700000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'my_complex_show_call',
      'my_complex_show_email',
      'my_complex_show_directions',
      'my_complex_show_website',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "residential_complexes" ADD COLUMN IF NOT EXISTS "${column}" boolean NOT NULL DEFAULT true`,
      );
    }
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    for (const column of [
      'my_complex_show_call',
      'my_complex_show_email',
      'my_complex_show_directions',
      'my_complex_show_website',
    ]) {
      await queryRunner.query(
        `ALTER TABLE "residential_complexes" DROP COLUMN IF EXISTS "${column}"`,
      );
    }
  }
}
