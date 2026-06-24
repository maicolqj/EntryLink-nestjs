import { MigrationInterface, QueryRunner } from 'typeorm';

/**
 * Unifica el cobro en RecurringCharge (mecanismo canónico).
 *
 * Por cada FeeConfig activa que aún no tenga un RecurringCharge equivalente
 * (match por complexId + concepto/nombre), crea el RecurringCharge:
 *   - chargeType MONTHLY→indefinite, LIMITED→deferred, ONCE→one_time
 *   - incomeAccountId = cuenta PUC de ingreso (clase '4') posteable+activa del
 *     complejo (prefiere code '4225'). Si el complejo no tiene cuenta de ingreso,
 *     la FeeConfig se omite (queda activa) y se sembrará/migrará luego vía
 *     seedPucAccounts + recausación manual.
 * Luego desactiva las FeeConfigs que sí quedaron cubiertas por un RecurringCharge
 * (evita doble facturación con generateCharges).
 *
 * Idempotente: re-ejecutar no duplica (NOT EXISTS por concepto).
 */
export class MigrateFeeConfigsToRecurringCharges1781000400000 implements MigrationInterface {

  private readonly SYSTEM_USER = '00000000-0000-0000-0000-000000000000';

  public async up(queryRunner: QueryRunner): Promise<void> {
    // 1. Crear RecurringCharge por cada FeeConfig activa migrable
    await queryRunner.query(`
      INSERT INTO "recurring_charges"
        ("concept","type","amount","totalInstallments","currentInstallment","isActive",
         "billingDay","incomeAccountId","complexId","unitId","prorateByCoefficient","createdByUserId")
      SELECT
        fc."name",
        (CASE fc."chargeType"
           WHEN 'MONTHLY' THEN 'indefinite'
           WHEN 'LIMITED' THEN 'deferred'
           ELSE 'one_time'
         END)::"recurring_charge_type_enum",
        fc."amount",
        CASE WHEN fc."chargeType" = 'LIMITED' THEN fc."installments" ELSE NULL END,
        0, true,
        GREATEST(1, LEAST(COALESCE(fc."dueDayOfMonth", 1), 28)),
        inc.id,
        fc."complexId",
        fc."unitId",
        false,
        $1
      FROM "fee_configs" fc
      CROSS JOIN LATERAL (
        SELECT p."id"
        FROM "puc_accounts" p
        WHERE p."complexId" = fc."complexId"
          AND p."accountClass" = '4'
          AND p."isPostable" = true
          AND p."isActive" = true
        ORDER BY (p."code" = '4225') DESC, p."code" ASC
        LIMIT 1
      ) inc
      WHERE fc."isActive" = true
        AND fc."deletedAt" IS NULL
        AND NOT EXISTS (
          SELECT 1 FROM "recurring_charges" rc
          WHERE rc."complexId" = fc."complexId"
            AND lower(btrim(rc."concept")) = lower(btrim(fc."name"))
        )
    `, [this.SYSTEM_USER]);

    // 2. Desactivar las FeeConfigs ya cubiertas por un RecurringCharge
    await queryRunner.query(`
      UPDATE "fee_configs" fc
      SET "isActive" = false
      WHERE fc."isActive" = true
        AND fc."deletedAt" IS NULL
        AND EXISTS (
          SELECT 1 FROM "recurring_charges" rc
          WHERE rc."complexId" = fc."complexId"
            AND lower(btrim(rc."concept")) = lower(btrim(fc."name"))
        )
    `);
  }

  public async down(): Promise<void> {
    // No reversible de forma segura: no se borran RecurringCharges ya causados.
    // La reactivación de FeeConfigs migradas debe hacerse manualmente si se requiere.
  }
}
