import { Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { AppVersionPolicy } from '../entities/app-version-policy.entity';
import { ClientApp, ClientPlatform } from '../enums/client-app.enum';
import {
  AppVersionCheck,
  SetAppVersionPolicyInput,
} from '../dto/app-version.dto';

const APPS = Object.values(ClientApp);
const PLATFORMS = Object.values(ClientPlatform);

@Injectable()
export class AppVersionsService {
  private readonly logger = new Logger(AppVersionsService.name);

  constructor(
    @InjectRepository(AppVersionPolicy)
    private readonly repo: Repository<AppVersionPolicy>,
  ) {}

  /**
   * ¿Debe bloquearse esta instalación? Sin política registrada no se obliga a
   * nadie: una tabla vacía nunca deja a los usuarios sin app.
   */
  async check(
    app: ClientApp,
    platform: ClientPlatform,
    versionCode: number,
  ): Promise<AppVersionCheck> {
    const policy = await this.repo.findOne({ where: { app, platform } });
    const minVersionCode = policy?.minVersionCode ?? 0;
    return {
      updateRequired: versionCode < minVersionCode,
      minVersionCode,
      message: policy?.message ?? null,
    };
  }

  /** Todas las combinaciones app × plataforma, existan o no en la tabla. */
  async list(): Promise<AppVersionPolicy[]> {
    const rows = await this.repo.find();
    return APPS.flatMap((app) =>
      PLATFORMS.map(
        (platform) =>
          rows.find((r) => r.app === app && r.platform === platform) ??
          this.repo.create({ app, platform, minVersionCode: 0, message: null }),
      ),
    );
  }

  async set(
    input: SetAppVersionPolicyInput,
    userId: string,
  ): Promise<AppVersionPolicy> {
    const policy =
      (await this.repo.findOne({
        where: { app: input.app, platform: input.platform },
      })) ?? this.repo.create({ app: input.app, platform: input.platform });

    policy.minVersionCode = input.minVersionCode;
    policy.message = input.message?.trim() || null;
    policy.updatedById = userId;

    const saved = await this.repo.save(policy);
    this.logger.warn(
      `Versión mínima de ${input.app}/${input.platform} = ${input.minVersionCode} (por ${userId})`,
    );
    return saved;
  }
}
