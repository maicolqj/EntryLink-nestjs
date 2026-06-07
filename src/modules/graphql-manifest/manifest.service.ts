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

    const fileEntries = this.loadFromFile();

    if (persisted && Object.keys(persisted).length > 0) {
      // Merge: file entries take precedence so new deployments always add queries.
      const merged = { ...persisted, ...fileEntries };
      const added  = Object.keys(merged).length - Object.keys(persisted).length;
      this.store = merged;
      if (added > 0) {
        await this.cache.set({ key: { prefix: CACHE_PREFIX, key: CACHE_KEY }, data: merged });
        this.logger.log(
          `Loaded ${Object.keys(persisted).length} trusted queries from Redis + merged ${added} new from ${MANIFEST_FILE} (total: ${Object.keys(merged).length})`,
        );
      } else {
        this.logger.log(`Loaded ${Object.keys(persisted).length} trusted queries from Redis`);
      }
      return;
    }

    // Redis empty — seed from file.
    if (Object.keys(fileEntries).length > 0) {
      this.store = fileEntries;
      await this.cache.set({ key: { prefix: CACHE_PREFIX, key: CACHE_KEY }, data: fileEntries });
      this.logger.log(`Seeded ${Object.keys(fileEntries).length} trusted queries from ${MANIFEST_FILE} into Redis`);
    } else {
      this.logger.warn(
        `Redis empty and ${MANIFEST_FILE} not found or empty. All queries will be rejected in production until POST /graphql-manifest/sync is called.`,
      );
    }
  }

  private loadFromFile(): Record<string, string> {
    const filePath = join(process.cwd(), MANIFEST_FILE);
    if (!existsSync(filePath)) return {};
    try {
      const raw    = readFileSync(filePath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;
      return Object.fromEntries(
        Object.entries(parsed).filter((e): e is [string, string] => typeof e[1] === 'string'),
      );
    } catch (err: any) {
      this.logger.error(`Failed to parse ${MANIFEST_FILE}: ${err.message}`);
      return {};
    }
  }

  /**
   * Merges incoming entries into the in-memory store and persists to Redis atomically.
   * Multiple clients (web, mobile) can sync independently without overwriting each other.
   * Called exclusively by ManifestController on authenticated POST /graphql-manifest/sync.
   */
  async updateManifest(manifest: Record<string, string>): Promise<void> {
    const before = Object.keys(this.store).length;
    this.store = { ...this.store, ...manifest };
    await this.cache.set({
      key:  { prefix: CACHE_PREFIX, key: CACHE_KEY },
      data: this.store,
    });
    const added = Object.keys(this.store).length - before;
    this.logger.log(`Manifest synced — ${Object.keys(manifest).length} incoming, ${added} new, ${Object.keys(this.store).length} total trusted queries`);
  }

  /** O(1) in-memory lookup. Returns undefined when hash is not trusted. */
  getOperation(hash: string): string | undefined {
    return this.store[hash];
  }
}
