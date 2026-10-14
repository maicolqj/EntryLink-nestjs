import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Borra las asignaciones de rol que quedaron sin usuario.
 *
 * `updateUser` guardaba el usuario con la lista de roles cargada antes de
 * cambiarle el cargo, y TypeORM ponía user_id = NULL en la fila del cargo
 * recién creada. Esas filas no le dan el rol a nadie: el cargo se perdía.
 * Ninguna asignación válida tiene user_id nulo.
 *
 * Sin `down`: no hay a quién devolverle esas filas.
 */
export class DeleteOrphanUserRoles1781009300000 implements MigrationInterface {
  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `DELETE FROM "user_has_roles" WHERE "user_id" IS NULL`,
    );
  }

  public async down(): Promise<void> {}
}
