import { registerEnumType } from '@nestjs/graphql';

/** Qué hizo la administración con el reporte. */
export enum MarketplaceReportStatus {
  PENDING = 'PENDING',
  ACCEPTED = 'ACCEPTED',
  DISMISSED = 'DISMISSED',
}

registerEnumType(MarketplaceReportStatus, {
  name: 'MarketplaceReportStatus',
  description: 'Estado de un reporte de publicación',
  valuesMap: {
    PENDING: { description: 'Sin revisar' },
    ACCEPTED: { description: 'Procede: la publicación se retira' },
    DISMISSED: { description: 'No procede: la publicación vuelve' },
  },
});
