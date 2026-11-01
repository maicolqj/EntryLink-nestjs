import { DataSource } from 'typeorm';
import { SEED_SCORING_RULES } from '../../src/core/database/migrations/1781010800000-CreateGrowthDedupeAndScoring';

/**
 * Limpieza de la base DESECHABLE de integración. Desactiva triggers solo en
 * esta sesión (requiere superusuario, que es el usuario del contenedor de
 * prueba) para poder vaciar tablas append-only. Nunca se usa fuera de test.
 */
export async function resetGrowthTestData(
  ds: DataSource,
  userPrefixes: string[],
): Promise<void> {
  const [{ db }] = (await ds.query(
    'SELECT current_database() AS db',
  )) as Array<{ db: string }>;
  if (!/test/i.test(db))
    throw new Error(`Base "${db}" no parece de prueba: abortado`);

  await ds.query(`SET session_replication_role = replica`);
  for (const table of [
    'merge_log',
    'duplicate_candidates',
    'prospect_scores',
    'prospect_assignments',
    'evidences',
    'property_managements',
    'employments',
    'person_channels',
    'organization_channels',
    'people',
    'properties',
    'organizations',
    'suppression_hashes',
    'suppressions',
    'activity_events',
    'legal_holds',
    'data_subject_requests',
    'team_members',
  ]) {
    await ds.query(`DELETE FROM growth.${table}`);
  }
  await ds.query(`SET session_replication_role = DEFAULT`);
  await ds.query(
    `UPDATE growth.settings SET allow_super_admin_self_validation = true, prospect_goal = 100, updated_by_user_id = NULL`,
  );
  // Reglas de scoring y umbrales vuelven a lo sembrado (entrega 1B).
  await ds.query(`DELETE FROM growth.scoring_rules WHERE key LIKE 'IT_%'`);
  for (const r of SEED_SCORING_RULES) {
    await ds.query(
      `UPDATE growth.scoring_rules SET label = $2, predicate = $3, params = $4::jsonb, points = $5,
              applies_to = $6::text[], active = true, sort_order = $7, updated_by_user_id = NULL
        WHERE key = $1`,
      [
        r.key,
        r.label,
        r.predicate,
        JSON.stringify(r.params),
        r.points,
        r.appliesTo,
        r.sortOrder,
      ],
    );
  }
  await ds.query(
    `UPDATE growth.settings SET scoring_high_threshold = 50, scoring_medium_threshold = 25, scoring_version = 1`,
  );
  await ds.query(`DELETE FROM growth.data_sources WHERE code LIKE 'IT_%'`);
  await ds.query(
    `UPDATE growth.data_sources SET status = 'PENDING_APPROVAL', legal_review_status = 'PENDING',
            legal_review_reference = NULL, legal_reviewed_by_user_id = NULL, legal_reviewed_at = NULL,
            cost_approved_by_user_id = NULL, cost_approved_at = NULL, monthly_budget_cop = NULL,
            monthly_request_cap = NULL, cost_estimate_notes = NULL,
            created_by_user_id = NULL, updated_by_user_id = NULL`,
  );
  for (const prefix of userPrefixes) {
    await ds.query(
      `DELETE FROM public.user_has_roles WHERE user_id::text LIKE $1`,
      [`${prefix}%`],
    );
    await ds.query(`DELETE FROM public.users WHERE id::text LIKE $1`, [
      `${prefix}%`,
    ]);
  }
}
