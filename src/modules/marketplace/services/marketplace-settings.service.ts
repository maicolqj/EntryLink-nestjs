import { HttpStatus, Injectable, Logger } from '@nestjs/common';
import { InjectRepository } from '@nestjs/typeorm';
import { Repository } from 'typeorm';

import { MarketplaceSettings } from '../entities/marketplace-settings.entity';
import { UpdateMarketplaceSettingsInput } from '../dto/inputs/update-marketplace-settings.input';
import { DEFAULT_MARKETPLACE_TERMS } from '../constants/default-categories.constant';

import { ResidentialComplexService } from '../../residential-complex/services/residential-complex.service';
import { CustomError } from '../../shared/utils/errors.utils';
import { MarketplaceErrorCode } from '../../shared/constans/error-codes.constants';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';

@Injectable()
export class MarketplaceSettingsService {
  private readonly logger = new Logger(MarketplaceSettingsService.name);

  constructor(
    @InjectRepository(MarketplaceSettings)
    private readonly settingsRepo: Repository<MarketplaceSettings>,
    private readonly complexService: ResidentialComplexService,
  ) {}

  /**
   * Los ajustes del conjunto, creándolos con los valores por defecto si es la
   * primera vez que alguien entra al módulo.
   *
   * El INSERT va con `orIgnore()` en vez de un "busca y si no existe crea":
   * dos residentes abriendo la vitrina en el mismo segundo entrarían los dos
   * por la rama de creación y el segundo chocaría contra la llave primaria.
   *
   * No valida permisos: lo llaman los otros servicios del módulo, que ya
   * validaron el acceso al complejo.
   */
  async getOrCreate(complexId: string): Promise<MarketplaceSettings> {
    const existing = await this.settingsRepo.findOne({ where: { complexId } });
    if (existing) return existing;

    await this.settingsRepo
      .createQueryBuilder()
      .insert()
      .into(MarketplaceSettings)
      .values({ complexId })
      .orIgnore()
      .execute();

    return this.settingsRepo.findOne({ where: { complexId } });
  }

  /** Los ajustes, para la pantalla de la administración. */
  async findByComplex(
    complexId: string,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceSettings> {
    await this.complexService.assertComplexAccess(complexId, currentUser);
    return this.getOrCreate(complexId);
  }

  async update(
    input: UpdateMarketplaceSettingsInput,
    currentUser: JwtAccessPayload,
  ): Promise<MarketplaceSettings> {
    await this.complexService.assertComplexAccess(input.complexId, currentUser);

    const settings = await this.getOrCreate(input.complexId);

    Object.assign(settings, {
      moderationMode: input.moderationMode ?? settings.moderationMode,
      listingDurationDays:
        input.listingDurationDays ?? settings.listingDurationDays,
      maxActiveListingsPerUnit:
        input.maxActiveListingsPerUnit ?? settings.maxActiveListingsPerUnit,
      maxImagesPerListing:
        input.maxImagesPerListing ?? settings.maxImagesPerListing,
      autoPauseAfterReports:
        input.autoPauseAfterReports ?? settings.autoPauseAfterReports,
      allowPhoneContact: input.allowPhoneContact ?? settings.allowPhoneContact,
      allowWantedListings:
        input.allowWantedListings ?? settings.allowWantedListings,
      // Una cadena vacía es "vuelve al texto de la plataforma", no "sin
      // condiciones": la vitrina nunca opera sin un texto que aceptar.
      termsText: input.termsText?.trim()
        ? input.termsText.trim()
        : input.termsText === undefined
          ? settings.termsText
          : null,
      updatedByUserId:
        currentUser.entityType === 'user' ? currentUser.sub : null,
    });

    if (settings.maxImagesPerListing < 1) {
      throw new CustomError({
        message: 'Una publicación tiene que admitir al menos una foto',
        statusCode: HttpStatus.BAD_REQUEST,
        errorCode: MarketplaceErrorCode.MARKETPLACE_SETTINGS_INVALID,
      });
    }

    const saved = await this.settingsRepo.save(settings);
    this.logger.log(
      `Ajustes de clasificados actualizados — complejo ${input.complexId}`,
    );

    return saved;
  }

  /** El texto que el vecino acepta al publicar. */
  resolveTerms(settings: MarketplaceSettings): string {
    return settings.termsText?.trim() || DEFAULT_MARKETPLACE_TERMS;
  }
}
