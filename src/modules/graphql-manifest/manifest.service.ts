import { Injectable, Logger, OnApplicationBootstrap } from '@nestjs/common';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { CacheService } from '../../core/infrastructure/cache/cache.service';

const CACHE_PREFIX  = 'graphql';
const CACHE_KEY     = 'manifest';
const MANIFEST_FILE = 'query-manifest.json';

@Injectable()
export class ManifestService implements OnApplicationBootstrap {
  private readonly logger = new Logger(ManifestService.name);
  private store: Record<string, string> = {};

  constructor(private readonly cache: CacheService) {}

  async onApplicationBootstrap(): Promise<void> {
    const persisted = await this.cache.get<Record<string, string>>({
      key: { prefix: CACHE_PREFIX, key: CACHE_KEY },
    });

    if (persisted && Object.keys(persisted).length > 0) {
      this.store = persisted;
      this.logger.log(`Loaded ${Object.keys(persisted).length} trusted queries from Redis`);
      return;
    }

    // Redis empty — seed from file so existing deployments keep working
    // until the frontend CI calls POST /graphql-manifest/sync for the first time.
    const filePath = join(process.cwd(), MANIFEST_FILE);
    if (existsSync(filePath)) {
      try {
        const raw     = readFileSync(filePath, 'utf-8');
        const parsed  = JSON.parse(raw) as Record<string, unknown>;
        const entries = Object.fromEntries(
          Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
        );
        this.store = entries;
        // Persist into Redis so subsequent restarts/instances skip the file.
        await this.cache.set({ key: { prefix: CACHE_PREFIX, key: CACHE_KEY }, data: entries });
        this.logger.log(`Seeded ${Object.keys(entries).length} trusted queries from ${MANIFEST_FILE} into Redis`);
      } catch (err: any) {
        this.logger.error(`Failed to parse ${MANIFEST_FILE}: ${err.message}`);
      }
    } else {
      this.logger.warn(
        `Redis empty and ${MANIFEST_FILE} not found. All queries will be rejected in production until POST /graphql-manifest/sync is called.`,
      );
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
