import { DataSource } from 'typeorm';

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
