import { readFileSync } from 'fs';
import { join } from 'path';
import { Controller, Get } from '@nestjs/common';
import { SkipThrottle } from '@nestjs/throttler';
import { Public } from '../shared/decorators/public.decorator';

/**
 * Versión de `package.json`, leída una sola vez al cargar el módulo. La imagen
 * copia `package.json` en `/app` y el proceso arranca desde ahí, igual que en
 * local. El workflow de deploy la compara para saber si el contenedor nuevo
 * reemplazó al viejo: un 200 solo no lo prueba.
 */
export function readAppVersion(cwd: string = process.cwd()): string {
  try {
    const pkg = JSON.parse(readFileSync(join(cwd, 'package.json'), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : 'unknown';
  } catch {
    return 'unknown';
  }
}

const APP_VERSION = readAppVersion();

@SkipThrottle()
@Public()
@Controller('health')
export class HealthController {
  @Get()
  check() {
    return {
      status: 'ok',
      version: APP_VERSION,
      timestamp: new Date().toISOString(),
    };
  }
}
