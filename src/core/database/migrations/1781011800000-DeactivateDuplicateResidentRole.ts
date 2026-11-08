import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * RESIDENT_ROL duplicado.
 *
 * Producción tiene dos filas con `name = 'RESIDENT_ROL'`:
 *   - la del seed (`d8e9f0a1-b2c3-4d4e-af6a-7b8c9d0e1f2c`, «Residente»), que
 *     tienen todos los residentes;
 *   - una vacía («Usuario», sin usuarios ni permisos) que `RolesService`
 *     creaba al arrancar si todavía no había corrido el seed.
 *
 * El código ya busca la del seed por id (`findResidentRole`). Esta migración
 * desactiva la otra para que ninguna consulta por nombre pueda elegirla. La
 * tabla `roles` no tiene `deleted_at`: el borrado lógico es `status = false`,
 * con el estado anterior guardado en `metadata` para el `down`.
 *
 * Solo toca filas que NO tienen usuarios, permisos ni roles hijos, y solo si
 * la fila del seed existe. Si alguna condición no se cumple, no hace nada.
 */
const SEED_ID = 'd8e9f0a1-b2c3-4d4e-af6a-7b8c9d0e1f2c';
const MARK = 'duplicateResidentRoleDeactivated';

export class DeactivateDuplicateResidentRole1781011800000 implements MigrationInterface {
  name = 'DeactivateDuplicateResidentRole1781011800000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      `
      UPDATE "roles" d
      SET "status" = false,
          "metadata" = COALESCE(d."metadata", '{}'::jsonb) || jsonb_build_object(
            '${MARK}', jsonb_build_object(
              'previousStatus', d."status",
              'previousFrontName', d."frontName",
              'at', NOW()
            )
          ),
          "frontName" = 'Residente (duplicado sin uso)'
      WHERE d."name" = 'RESIDENT_ROL'
        AND d."id" <> $1
        AND EXISTS (SELECT 1 FROM "roles" s WHERE s."id" = $1)
        AND NOT EXISTS (SELECT 1 FROM "user_has_roles" ur WHERE ur."role_id" = d."id")
        AND NOT EXISTS (SELECT 1 FROM "role_permissions" rp WHERE rp."role_id" = d."id")
        AND NOT EXISTS (
          SELECT 1 FROM "roles" c WHERE to_jsonb(c) ->> 'parentId' = d."id"::text
        )
      `,
      [SEED_ID],
    );
  }

  public async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(`
      UPDATE "roles" d
      SET "status" = COALESCE((d."metadata" -> '${MARK}' ->> 'previousStatus')::boolean, true),
          "frontName" = COALESCE(d."metadata" -> '${MARK}' ->> 'previousFrontName', d."frontName"),
          "metadata" = d."metadata" - '${MARK}'
      WHERE d."name" = 'RESIDENT_ROL'
        AND d."metadata" ? '${MARK}'
    `);
  }
}
