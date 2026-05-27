import { Injectable, Logger, OnModuleInit } from '@nestjs/common';
import { CacheService } from '../../core/infrastructure/cache/cache.service';

const CACHE_PREFIX = 'graphql';
const CACHE_KEY    = 'manifest';

@Injectable()
export class ManifestService implements OnModuleInit {
  private readonly logger = new Logger(ManifestService.name);
  private store: Record<string, string> = {};

  constructor(private readonly cache: CacheService) {}

  async onModuleInit(): Promise<void> {
    const persisted = await this.cache.get<Record<string, string>>({
      key: { prefix: CACHE_PREFIX, key: CACHE_KEY },
    });
    if (persisted) {
      this.store = persisted;
      this.logger.log(`Loaded ${Object.keys(persisted).length} trusted queries from Redis`);
    } else {
      this.logger.warn('No trusted-document manifest found in Redis. Sync endpoint awaiting first push.');
    }
  }

  /**
   * Replaces the in-memory store and persists to Redis atomically.
   * Called exclusively by ManifestController on authenticated POST /graphql-manifest/sync.
   */
  async updateManifest(manifest: Record<string, string>): Promise<void> {
    this.store = manifest;
    await this.cache.set({
      key:  { prefix: CACHE_PREFIX, key: CACHE_KEY },
      data: manifest,
    });
    this.logger.log(`Manifest synced — ${Object.keys(manifest).length} trusted queries loaded`);
  }

  /** O(1) in-memory lookup. Returns undefined when hash is not trusted. */
  getOperation(hash: string): string | undefined {
    return this.store[hash];
  }
}
