import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';
import { NotificationType } from './notification-type.enum';

/**
 * `notifications.type` es un enum NATIVO de Postgres y el esquema no se
 * sincroniza solo. Un valor nuevo en `NotificationType` sin su migración no
 * rompe la compilación: rompe en producción, y en silencio. Ya pasó con
 * PROFILE_UPDATED, que dejó la bandeja del residente vacía porque el filtro de
 * audiencia lo manda en un `IN (...)` y Postgres rechaza la consulta completa.
 */
describe('NotificationType', () => {
  const migrationsDir = join(__dirname, '../../../core/database/migrations');
  const migrations = readdirSync(migrationsDir)
    .filter((file) => file.endsWith('.ts'))
    .map((file) => readFileSync(join(migrationsDir, file), 'utf8'))
    .join('\n');

  it('cada valor tiene una migración que lo crea en Postgres', () => {
    const sinMigracion = Object.values(NotificationType).filter(
      (type) => !new RegExp(`'${type}'`).test(migrations),
    );

    // Si falla: agregar una migración con
    // ALTER TYPE "notifications_type_enum" ADD VALUE IF NOT EXISTS '<VALOR>'
    // (y lo mismo para notification_batches_type_enum).
    expect(sinMigracion).toEqual([]);
  });
});
