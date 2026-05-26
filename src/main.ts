import { NestFactory } from '@nestjs/core';
import { AppModule } from './app.module';
import { Logger, ValidationPipe } from '@nestjs/common';
import moment from 'moment-timezone';
import * as os from 'os';
import * as express from 'express';
import * as helmet from 'helmet';
import compression from 'compression';
import { UniversalExceptionFilter } from './modules/shared/filters/custom-errors.filters';
import { SocketIoRedisAdapter } from './core/infrastructure/socket/socket.adapter';

async function bootstrap() {
  const isProd = process.env.NODE_ENV === 'production';

  const app = await NestFactory.create(AppModule, {
    logger: isProd
      ? ['error', 'warn', 'log']
      : ['debug', 'error', 'fatal', 'log', 'verbose', 'warn'],
  });

  // VULN-05 fix: configurar cuántos proxies de confianza hay delante del servidor
  // Con trust proxy = 1, Express solo lee x-forwarded-for del proxy inmediato (nginx/LB)
  // y no permite que el cliente falsifique la IP
  app.getHttpAdapter().getInstance().set('trust proxy', 1);

  // CORS — fail-closed: si ALLOWED_ORIGINS no está definido, bloquea todo origen
  app.enableCors({
    origin: process.env.ALLOWED_ORIGINS?.split(',') || [],
    credentials: true,
    methods: ['GET', 'POST', 'OPTIONS'],
    allowedHeaders: [
      'Content-Type',
      'Authorization',
      'x-device-id',
      'x-app-version',
    ],
  });

  // Gzip — reduce ancho de banda 60-80% en respuestas JSON/GraphQL
  app.use(compression());

  // Cabeceras de seguridad HTTP
  // Bull Board necesita scripts inline; se aplica helmet con CSP relajado solo para esa ruta
  app.use((req: any, res: any, next: any) => {
    if (req.url?.startsWith('/admin/bull-board')) {
      return helmet.default({
        contentSecurityPolicy: {
          directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'"],
            imgSrc: ["'self'", 'data:'],
          },
        },
      })(req, res, next);
    }
    helmet.default()(req, res, next);
  });

  // VULN-06 fix: 10 MB era innecesario para GraphQL/REST — 1 MB es suficiente
  app.use(express.json({ limit: '1mb' }));
  // urlencoded solo para metadata de formularios REST (no afecta multipart/form-data de Multer)
  app.use(express.urlencoded({ limit: '1mb', extended: true }));

  const prefix = 'api/v1';
  app.useGlobalFilters(new UniversalExceptionFilter());

  app.setGlobalPrefix(prefix, {
    exclude: ['/graphql', 'admin/bull-board', 'admin/bull-board/*path', 'health'],
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

  const timeZone = process.env.TZ || 'America/Bogota';
  moment.tz.setDefault(timeZone);

  const socketAdapter = new SocketIoRedisAdapter(app);
  await socketAdapter.connectToRedis({
    host: process.env.REDIS_HOST || 'localhost',
    port: parseInt(process.env.REDIS_PORT || '6379', 10),
    password: process.env.REDIS_PASSWORD || undefined,
    db: parseInt(process.env.REDIS_SOCKET_DB || '6', 10),
  });
  app.useWebSocketAdapter(socketAdapter);

  const port = process.env.PORT || 3001;
  await app.listen(port, () => {
    if (!isProd) {
      const networkInterfaces = os.networkInterfaces();
      Logger.verbose(`API running on:`);
      for (const iface of Object.values(networkInterfaces)) {
        for (const addr of iface) {
          if (addr.family === 'IPv4' && !addr.internal) {
            Logger.verbose(`- http://${addr.address}:${port}/${prefix}`);
          }
        }
      }
    } else {
      Logger.log(`API running on port ${port}`);
    }
  });
}
bootstrap();
