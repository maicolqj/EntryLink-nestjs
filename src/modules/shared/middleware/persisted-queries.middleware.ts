import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { existsSync, readFileSync } from 'fs';
import { join } from 'path';
import { stripIgnoredCharacters } from 'graphql';

/**
 * Implements the Automatic Persisted Queries (APQ) protocol and, in production,
 * enforces a trusted-document allowlist so that only pre-registered queries are executed.
 *
 * === Protocol ===
 * 1. Client sends:  { extensions: { persistedQuery: { version: 1, sha256Hash: "abc..." } } }
 *                   (no `query` field)
 *    → Server looks up hash in manifest (prod) or devCache (dev).
 *      Found  → injects query and continues.
 *      Missing→ responds with PersistedQueryNotFound (HTTP 200, GraphQL error).
 *
 * 2. Client retries: { query: "...", extensions: { persistedQuery: { ... } } }
 *    → Server verifies SHA-256(query) === hash.
 *      Mismatch → 400.
 *      Production + hash not in manifest → 403 (query is not trusted).
 *      Dev       → caches hash→query in memory for step 1, logs hash to console.
 *
 * 3. No APQ extension:
 *    Development  → allowed (Playground, REST tooling, etc.).
 *    Production   → rejected with 400.
 *
 * === Manifest ===
 * query-manifest.json at the project root maps sha256Hash → queryDocument.
 * Generate it from the frontend build (Apollo codegen, graphql-codegen, Relay, …)
 * and commit it to the repository.  Redeploy both frontend and backend together.
 *
 * In development, every new query registration logs its hash:
 *   [PersistedQueriesMiddleware] [APQ] hash: <sha256> [OperationName]
 * Copy the hash and the query string into query-manifest.json.
 */
@Injectable()
export class PersistedQueriesMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PersistedQueriesMiddleware.name);
  private readonly manifest: Record<string, string> = {};
  private readonly isProd: boolean;

  // Module-level dev cache so it survives across requests even if NestJS
  // creates multiple instances of this middleware class.
  private static readonly devCache = new Map<string, string>();

  constructor() {
    this.isProd = process.env.NODE_ENV === 'production';
    this.loadManifest();
  }

  private loadManifest(): void {
    const manifestPath = join(process.cwd(), 'query-manifest.json');

    if (!existsSync(manifestPath)) {
      if (this.isProd) {
        this.logger.error(
          'query-manifest.json not found. All queries will be rejected in production!',
        );
      } else {
        this.logger.warn(
          'query-manifest.json not found. APQ hash-only requests will not resolve in dev until queries are sent with their full document first.',
        );
      }
      return;
    }

    try {
      const raw = readFileSync(manifestPath, 'utf-8');
      const parsed = JSON.parse(raw) as Record<string, unknown>;

      // Only store entries whose values are strings (skip metadata fields)
      for (const [hash, doc] of Object.entries(parsed)) {
        if (typeof doc === 'string') {
          this.manifest[hash] = doc;
        }
      }

      this.logger.log(
        `Loaded ${Object.keys(this.manifest).length} trusted queries from query-manifest.json`,
      );
    } catch (err: any) {
      this.logger.error(`Failed to parse query-manifest.json: ${err.message}`);
    }
  }

  use(req: Request, res: Response, next: NextFunction): void {
    // Only inspect POST requests (GraphQL over HTTP); GETs and WS upgrades pass through.
    if (req.method !== 'POST' || !req.body) {
      return next();
    }

    const body = req.body as {
      query?: string;
      operationName?: string;
      extensions?: {
        persistedQuery?: { version: number; sha256Hash: string };
      };
    };

    const apq = body.extensions?.persistedQuery;
    const hash = apq?.sha256Hash;
    const queryInBody = body.query;

    // ── No APQ extension ─────────────────────────────────────────────────────
    if (!apq) {
      if (this.isProd) {
        res.status(400).json({
          errors: [
            {
              message: 'Only persisted queries are accepted in production.',
              extensions: { code: 'PERSISTED_QUERY_REQUIRED' },
            },
          ],
        });
        return;
      }
      // Dev / playground: pass through unrestricted
      return next();
    }

    // ── Hash-only request (no query body) ────────────────────────────────────
    if (!queryInBody) {
      const fromManifest = this.manifest[hash];
      if (fromManifest) {
        req.body = { ...body, query: fromManifest };
        return next();
      }

      if (!this.isProd) {
        const fromDevCache = PersistedQueriesMiddleware.devCache.get(hash);
        if (fromDevCache) {
          req.body = { ...body, query: fromDevCache };
          return next();
        }
      }

      // Hash not found anywhere
      res.status(200).json({
        errors: [
          {
            message: 'PersistedQueryNotFound',
            extensions: { code: 'PERSISTED_QUERY_NOT_FOUND' },
          },
        ],
      });
      return;
    }

    // ── Hash + query present (first-time or re-registration) ─────────────────

    if (this.isProd) {
      // In trusted-document mode the manifest IS the source of truth.
      // If the hash is registered, serve the trusted copy and ignore the
      // client-supplied body (prevents query-substitution attacks).
      // No cryptographic hash verification needed: the manifest already
      // acts as the allowlist, and the client's hash algorithm may differ
      // from SHA-256 (e.g. the codegen tool may use a different digest).
      if (this.manifest[hash]) {
        req.body = { ...body, query: this.manifest[hash] };
        return next();
      }
      res.status(403).json({
        errors: [
          {
            message: 'Query is not in the trusted document manifest.',
            extensions: { code: 'PERSISTED_QUERY_NOT_ALLOWED' },
          },
        ],
      });
      return;
    }

    // Dev: verify hash then cache for future hash-only requests.
    // Use the same normalization the frontend codegen applies so the
    // devCache hash matches subsequent hash-only requests.
    const normalizedQuery = stripIgnoredCharacters(queryInBody);
    const actualHash = createHash('sha256').update(normalizedQuery).digest('hex');

    if (actualHash !== hash) {
      this.logger.warn(
        `[APQ] hash mismatch — received: ${hash}  computed: ${actualHash}  op: ${body.operationName ?? 'anonymous'}`,
      );
    }

    if (!PersistedQueriesMiddleware.devCache.has(hash)) {
      PersistedQueriesMiddleware.devCache.set(hash, normalizedQuery);
      this.logger.log(
        `[APQ] cached hash: ${hash}  op: ${body.operationName ?? 'anonymous'}`,
      );
    }

    return next();
  }
}
