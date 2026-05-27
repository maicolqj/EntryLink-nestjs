import { Injectable, Logger, NestMiddleware } from '@nestjs/common';
import { Request, Response, NextFunction } from 'express';
import { createHash } from 'crypto';
import { stripIgnoredCharacters } from 'graphql';
import { ManifestService } from '../../graphql-manifest/manifest.service';

/**
 * Implements the Automatic Persisted Queries (APQ) protocol and, in production,
 * enforces a trusted-document allowlist sourced from ManifestService (Redis-backed).
 *
 * === Protocol ===
 * 1. Client sends:  { extensions: { persistedQuery: { version: 1, sha256Hash: "abc..." } } }
 *                   (no `query` field)
 *    → Looks up hash in ManifestService (prod) or devCache (dev).
 *      Found  → injects query and continues.
 *      Missing→ responds with PersistedQueryNotFound (HTTP 200, GraphQL error).
 *
 * 2. Client retries: { query: "...", extensions: { persistedQuery: { ... } } }
 *    → Production + hash not in manifest → 403.
 *      Dev       → verifies SHA-256, caches hash→query, continues.
 *
 * 3. No APQ extension:
 *    Development  → allowed (Playground, REST tooling, etc.).
 *    Production   → rejected with 400.
 *
 * === Manifest ===
 * Loaded from Redis on startup via ManifestService.onModuleInit.
 * Updated at runtime via POST /graphql-manifest/sync (authenticated).
 */
@Injectable()
export class PersistedQueriesMiddleware implements NestMiddleware {
  private readonly logger = new Logger(PersistedQueriesMiddleware.name);
  private readonly isProd: boolean;

  // Module-level dev cache so it survives across requests even if NestJS
  // creates multiple instances of this middleware class.
  private static readonly devCache = new Map<string, string>();

  constructor(private readonly manifestService: ManifestService) {
    this.isProd = process.env.NODE_ENV === 'production';
  }

  use(req: Request, res: Response, next: NextFunction): void {
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

    const apq       = body.extensions?.persistedQuery;
    const hash      = apq?.sha256Hash;
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
      return next();
    }

    // ── Hash-only request (no query body) ────────────────────────────────────
    if (!queryInBody) {
      const fromManifest = this.manifestService.getOperation(hash);
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
      // Serve the trusted copy from ManifestService and discard the client-supplied
      // body to prevent query-substitution attacks.
      const trusted = this.manifestService.getOperation(hash);
      if (trusted) {
        req.body = { ...body, query: trusted };
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
    const normalizedQuery = stripIgnoredCharacters(queryInBody);
    const actualHash      = createHash('sha256').update(normalizedQuery).digest('hex');

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
