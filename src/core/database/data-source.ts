import 'reflect-metadata';
import { DataSource } from 'typeorm';
import * as dotenv from 'dotenv';
import { join } from 'path';

dotenv.config();

export default new DataSource({
  type: 'postgres',
  host: process.env.DB_HOST || 'localhost',
  port: parseInt(process.env.DB_PORT || process.env.DB_PORT_LOCAL || '5432', 10),
  username: process.env.DB_USERNAME || 'postgres',
  password: process.env.PASSDB_POSTGRES,
  database: process.env.DB_NAME || 'Entrylink',
  entities: [join(__dirname, '../../**/*.entity{.ts,.js}')],
  migrations: [join(__dirname, './migrations/*{.ts,.js}')],
  synchronize: false,
  ssl: false,
});
