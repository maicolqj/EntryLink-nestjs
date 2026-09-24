import { MarketplacePriceType } from '../enums/marketplace-price-type.enum';

/**
 * El precio en una línea, como lo leen la app y la web.
 *
 * "Sin precio" y "gratis" no son lo mismo: `ON_REQUEST` invita a preguntar,
 * `FREE` dice que no se cobra nada.
 */
export function listingPriceLabel(listing: {
  priceType: MarketplacePriceType;
  priceAmount?: number | null;
  currency?: string | null;
}): string {
  switch (listing.priceType) {
    case MarketplacePriceType.FREE:
      return 'Gratis';
    case MarketplacePriceType.EXCHANGE:
      return 'Permuta';
    case MarketplacePriceType.ON_REQUEST:
      return 'A convenir';
    default:
      break;
  }

  if (listing.priceAmount === null || listing.priceAmount === undefined) {
    return 'A convenir';
  }

  const amount = `$${Number(listing.priceAmount).toLocaleString('es-CO')}`;
  return listing.priceType === MarketplacePriceType.NEGOTIABLE
    ? `${amount} · negociable`
    : amount;
}
