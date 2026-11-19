import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config();

/**
 * Data-source SOLO para las migraciones del módulo IoT. Misma conexión que
 * src/core/database/data-source.ts, pero:
 *  - migraciones: solo las de esta carpeta;
 *  - tabla de control propia (`iot_migrations`): no se mezcla con el
 *    historial de las migraciones de producción, y el `yarn migration:run` de
 *    siempre no ve ni ejecuta estas;
 *  - sin entidades: las migraciones son SQL a mano (cargar las entidades
 *    obligaría a cargar también User, Unit y ResidentialComplex por sus
 *    relaciones).
 *
 * Staging (README_IOT.md):
 *   npx ts-node -r tsconfig-paths/register ./node_modules/typeorm/cli.js \
 *     -d src/modules/iot-devices/database/iot-data-source.ts migration:run    (o :revert)
 */
export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(
    process.env.DB_PORT || process.env.DB_PORT_LOCAL || '5432',
    10,
  ),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.PASSDB_POSTGRES,
  database: process.env.DB_NAME || 'Entrylink',
  entities: [],
  migrations: [join(__dirname, './migrations/*{.ts,.js}')],
  migrationsTableName: 'iot_migrations',
  migrationsTransactionMode: 'each' as const,
  synchronize: false,
  ssl: false,
});
