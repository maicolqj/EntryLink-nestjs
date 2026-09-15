import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config();

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
  entities: [join(__dirname, '../../**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, './migrations/*{.ts,.js}')],
  synchronize: false,

  /**
   * Una transacción POR migración, no una sola para todas.
   *
   * Con el modo por defecto ('all') ninguna migración puede agregar un valor a
   * un enum nativo y usarlo enseguida —Postgres lo prohíbe dentro de la misma
   * transacción— y este esquema tiene varios enums nativos (roles, permisos,
   * tipos de notificación), así que el caso se repite. A cambio, si una
   * migración falla las anteriores quedan aplicadas, que es como se comporta
   * la mayoría de los proyectos y permite reintentar desde donde quedó.
   */
  migrationsTransactionMode: 'each' as const,

  ssl: false,
});
