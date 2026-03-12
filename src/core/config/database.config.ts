// src/config/database.config.ts
import { registerAs } from '@nestjs/config';

// 📝 EXPLICACIÓN: Este archivo configura la conexión a PostgreSQL
// ✅ registerAs() permite agrupar configuraciones bajo un namespace ('database')
console.log(`🔗 Conectando a PostgreSQL en ${process.env.DB_HOST || 'localhost'}:${process.env.DB_PORT || 5432}...`);
export default registerAs('database', () => ({

  localhost: process.env.DB_HOST || 'localhost', // 🏠 Por defecto localhost, útil para Docker

  // 🐘 CONFIGURACIÓN BÁSICA DE PostgreSQL
  type: 'postgres' as const,              // Tipo de base de datos
  host: process.env.DB_HOST || 'localhost', // 🏠 Donde está la BD (localhost cuando Docker expone el puerto)
  port: parseInt(process.env.DB_PORT, 10) || 5432, // 🔌 Puerto de conexión (5432 es el puerto por defecto de PostgreSQL)
  username: process.env.DB_USERNAME || 'postgres', // 👤 Usuario de la BD
  password: process.env.PASSDB_POSTGRES, // 🔐 Contraseña (viene del .env)
  database: process.env.DB_NAME || 'OOOO',   // 🗃️ Nombre de la base de datos

  // 📁 CONFIGURACIÓN DE ENTIDADES Y MIGRACIONES
  entities: [__dirname + '/../**/*.entity{.ts,.js}'], // 📄 Busca todas las entidades en el proyecto
  migrations: [__dirname + '/../migrations/*{.ts,.js}'], // 🔄 Archivos de migración de BD
  autoLoadEntities: true,
  // ⚙️ CONFIGURACIÓN DE DESARROLLO
  synchronize: process.env.NODE_ENV !== 'production', // 🔄 Auto-sincroniza entidades (SOLO en desarrollo)
  // logging: process.env.NODE_ENV === 'development',    // 📝 Muestra consultas SQL en desarrollo
  ssl: false, // 🔒 SSL deshabilitado para desarrollo local

  // 🚀 CONFIGURACIÓN AVANZADA PARA PostgreSQL 17
  extra: {
    max: 20,                    // 🔢 Máximo 20 conexiones simultáneas en el pool
    idleTimeoutMillis: 30000,   // ⏱️ Cierra conexiones inactivas después de 30 segundos
    connectionTimeoutMillis: 2000, // ⏱️ Timeout de 2 segundos para nuevas conexiones
  },

}));

// 🎯 CÓMO SE USA:
// 1. Se importa en app.module.ts
// 2. ConfigService lo inyecta en TypeOrmModule
// 3. TypeORM usa esta configuración para conectarse a PostgreSQL en Docker