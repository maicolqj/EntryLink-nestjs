import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import moment from 'moment-timezone';
import { ConfigService } from '@nestjs/config';
import { Pool } from 'pg';
import * as os from 'os';
import { UniversalExceptionFilter } from './modules/shared/filters/custom-errors.filters';

async function bootstrap() {
  const app = await NestFactory.create(AppModule, {
    logger: ['debug', 'error', 'fatal', 'log', 'verbose', 'warn']
  });

  const prefix = 'api/v1';
  app.useGlobalFilters(new UniversalExceptionFilter());

  app.setGlobalPrefix(prefix, {
    exclude: ['/graphql']
  });

  app.useGlobalPipes(
    new ValidationPipe({
      whitelist: true,
      forbidNonWhitelisted: true,
      transform: true,
      transformOptions: { enableImplicitConversion: true },
      stopAtFirstError: true,
    })
  );

  // app.use('/admin/bull-board', bullBoardService.getRouter());
  
  const timeZone = process.env.TZ || 'America/Bogota';
  moment.tz.setDefault(timeZone);


  const configService = app.get(ConfigService);


  const pool = new Pool({
    host: configService.get('DB_HOST'),
    port: +configService.get('DB_PORT'),
    user: configService.get('DB_USERNAME'),
    password: configService.get('PASSDB_POSTGRES'),
    database: configService.get('DB_NAME'),
  });

  try {
    const client = await pool.connect();
    Logger.log('Successfully connected to the database');
    client.release();
  } catch (error: any) {
    Logger.error('Failed to connect to the database', error.stack);
  }


  const port = process.env.PORT || 3001;
  await app.listen(port, () => {
    const networkInterfaces = os.networkInterfaces();
    const addresses = [];

    // Itera sobre las interfaces de red para obtener las direcciones IPv4 locales
    for (const interfaceName of Object.keys(networkInterfaces)) {
      for (const networkInterface of networkInterfaces[interfaceName]) {
        if (networkInterface.family === 'IPv4' && !networkInterface.internal) {
          addresses.push(networkInterface.address);
        }
      }
    }

    // Imprime la IP y el puerto en consola
    Logger.verbose(`API running on:`);
    addresses.forEach(address => {
      Logger.verbose(`- http://${address}:${port}/${prefix}`);
    });
  });
}
bootstrap();
