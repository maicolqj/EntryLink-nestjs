import { Injectable, Logger, OnModuleDestroy } from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import Redis from 'ioredis';

interface CacheKey {
  prefix: string;
  key: string;
}

interface GetOptions {
  key: CacheKey;
}

interface SetOptions {
  key: CacheKey;
  data: unknown;
  options?: { ttl?: number };
}

interface DeleteOptions {
  key: CacheKey;
}

@Injectable()
export class CacheService implements OnModuleDestroy {
  private readonly logger = new Logger(CacheService.name);
  private readonly client: Redis;

  constructor(private readonly configService: ConfigService) {
    // Initialize in constructor so this.client is never undefined when
    // other modules' onModuleInit / onApplicationBootstrap hooks run.
    const host     = this.configService.get<string>('REDIS_HOST', 'localhost');
    const port     = this.configService.get<number>('REDIS_PORT', 6379);
    const password = this.configService.get<string>('REDIS_PASSWORD');
    const db       = this.configService.get<number>('REDIS_DB', 0);

    this.client = new Redis({
      host,
      port,
      password: password || undefined,
      db,
      lazyConnect: true,
      maxRetriesPerRequest: 3,
      enableReadyCheck: false,
    });

    this.client.on('error', (err) =>
      this.logger.error(`Redis cache error: ${err.message}`),
    );
  }

  async onModuleDestroy(): Promise<void> {
    await this.client?.quit();
  }

  // ── API Pública ──────────────────────────────────────────────────────────

  async get<T>(options: GetOptions): Promise<T | null> {
    try {
      const raw = await this.client.get(this.buildKey(options.key));
      if (!raw) return null;
      return JSON.parse(raw) as T;
    } catch (error: any) {
      this.logger.warn(`Cache GET error [${this.buildKey(options.key)}]: ${error.message}`);
      return null; // Fail open: si Redis falla, continuamos sin cache
    }
  }

  async set(options: SetOptions): Promise<void> {
    try {
      const serialized = JSON.stringify(options.data);
      const k = this.buildKey(options.key);
      const ttl = options.options?.ttl;

      if (ttl && ttl > 0) {
        await this.client.setex(k, ttl, serialized);
      } else {
        await this.client.set(k, serialized);
      }
    } catch (error: any) {
      this.logger.warn(`Cache SET error [${this.buildKey(options.key)}]: ${error.message}`);
    }
  }

  async delete(options: DeleteOptions): Promise<void> {
    try {
      await this.client.del(this.buildKey(options.key));
    } catch (error: any) {
      this.logger.warn(`Cache DEL error [${this.buildKey(options.key)}]: ${error.message}`);
    }
  }

  /**
   * Elimina todas las claves cuyo nombre comience con `rawPrefix`.
   * Usa SCAN para no bloquear Redis en producción (a diferencia de KEYS).
   * Útil para invalidar todos los resultados paginados/filtrados de un scope.
   *
   * @example deleteByPrefix('bld:complexId123:') → borra todas las páginas de torres
   */
  async deleteByPrefix(rawPrefix: string): Promise<void> {
    try {
      let cursor = '0';
      const pattern = `${rawPrefix}*`;
      do {
        const [nextCursor, keys] = await this.client.scan(cursor, 'MATCH', pattern, 'COUNT', 200);
        cursor = nextCursor;
        if (keys.length > 0) {
          await this.client.del(...keys);
        }
      } while (cursor !== '0');
    } catch (error: any) {
      this.logger.warn(`Cache DEL_PREFIX error [${rawPrefix}]: ${error.message}`);
    }
  }

  // ── Helper ───────────────────────────────────────────────────────────────

  private buildKey(cacheKey: CacheKey): string {
    return `${cacheKey.prefix}:${cacheKey.key}`;
  }
}
