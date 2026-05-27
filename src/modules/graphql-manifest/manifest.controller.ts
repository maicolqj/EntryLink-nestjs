import {
  Body,
  Controller,
  Headers,
  HttpCode,
  HttpStatus,
  Post,
  UnauthorizedException,
} from '@nestjs/common';
import { ConfigService } from '@nestjs/config';
import { ManifestService } from './manifest.service';

@Controller('graphql-manifest')
export class ManifestController {
  constructor(
    private readonly manifestService: ManifestService,
    private readonly config: ConfigService,
  ) {}

  /**
   * Receives the hash→query dictionary from the frontend CI/CD build and
   * replaces the active trusted-document manifest.
   *
   * Authorization: x-sync-secret header must match GRAPHQL_SYNC_SECRET env var.
   * Body: { "<sha256hash>": "<query string>", ... }
   */
  @Post('sync')
  @HttpCode(HttpStatus.OK)
  async sync(
    @Headers('x-sync-secret') secret: string,
    @Body() body: Record<string, unknown>,
  ): Promise<{ ok: boolean; synced: number }> {
    const expected = this.config.get<string>('GRAPHQL_SYNC_SECRET');

    if (!expected || secret !== expected) {
      throw new UnauthorizedException('Invalid or missing x-sync-secret header');
    }

    // Only accept string values — skip metadata or non-query entries
    const manifest = Object.fromEntries(
      Object.entries(body).filter((entry): entry is [string, string] =>
        typeof entry[1] === 'string',
      ),
    );

    await this.manifestService.updateManifest(manifest);

    return { ok: true, synced: Object.keys(manifest).length };
  }
}
