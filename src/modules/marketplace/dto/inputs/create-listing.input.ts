import {
  IsEnum,
  IsNumber,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  Min,
  MinLength,
} from 'class-validator';
import { Transform } from 'class-transformer';

import { readOptionalBoolean } from '../../utils/marketplace-module.util';
import { MarketplaceListingType } from '../../enums/marketplace-listing-type.enum';
import { MarketplacePriceType } from '../../enums/marketplace-price-type.enum';
import { MarketplaceItemCondition } from '../../enums/marketplace-item-condition.enum';
import { MarketplaceContactPreference } from '../../enums/marketplace-contact-preference.enum';

/**
 * Se lee del objeto ORIGINAL y no del `value` de class-transformer: el
 * ValidationPipe global corre con `enableImplicitConversion: true`, que para
 * una propiedad declarada `boolean` ya hizo `Boolean("false")` —es decir,
 * `true`— antes de llegar aquí.
 */
const toOptionalBoolean = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown => readOptionalBoolean(obj?.[key]);

/** En multipart el precio llega como texto. */
const toOptionalNumber = ({
  obj,
  key,
}: {
  obj: Record<string, unknown>;
  key: string;
}): unknown => {
  const raw = obj?.[key];
  if (raw === undefined || raw === null || raw === '') return undefined;
  const parsed = Number(raw);
  return Number.isFinite(parsed) ? parsed : raw;
};

/**
 * DTO para publicar un aviso vía REST (POST /api/v1/marketplace/listings).
 *
 * Va por REST y no por GraphQL porque las fotos llegan como archivo, y en este
 * proyecto GraphQL no recibe multipart. Un aviso sin foto casi nadie lo abre,
 * así que el servicio las exige salvo en los avisos de "busco".
 */
export class CreateListingDto {
  @IsUUID()
  complexId: string;

  /**
   * Opcional para el residente: se deduce de su ficha. La administración —si
   * algún día se le concede `PUBLISH_LISTING`— sí debe enviarla.
   */
  @IsOptional()
  @IsUUID()
  unitId?: string;

  @IsEnum(MarketplaceListingType)
  type: MarketplaceListingType;

  @IsUUID()
  categoryId: string;

  @IsString()
  @MinLength(5)
  @MaxLength(120)
  title: string;

  @IsString()
  @MinLength(10)
  @MaxLength(4000)
  description: string;

  @IsOptional()
  @IsEnum(MarketplaceItemCondition)
  condition?: MarketplaceItemCondition;

  @IsOptional()
  @Transform(toOptionalNumber)
  @IsNumber()
  @Min(0)
  priceAmount?: number;

  @IsOptional()
  @IsEnum(MarketplacePriceType)
  priceType?: MarketplacePriceType;

  @IsOptional()
  @IsEnum(MarketplaceContactPreference)
  contactPreference?: MarketplaceContactPreference;

  /** Consentimiento para mostrar el teléfono. Sin marcarlo, no se muestra. */
  @IsOptional()
  @Transform(toOptionalBoolean)
  showPhone?: boolean;

  /**
   * Aceptación de las condiciones de la vitrina. El servicio la exige la
   * primera vez: es la prueba de que al publicador se le dijo que la
   * administración no media en el negocio ni responde por él.
   */
  @IsOptional()
  @Transform(toOptionalBoolean)
  acceptTerms?: boolean;

  /**
   * Guardar sin publicar. Sirve para el residente que arma el aviso y quiere
   * revisar las fotos antes de mandarlo a revisión.
   */
  @IsOptional()
  @Transform(toOptionalBoolean)
  asDraft?: boolean;
}
