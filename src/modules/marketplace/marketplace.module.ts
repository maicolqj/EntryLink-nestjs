import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MarketplaceListing } from './entities/marketplace-listing.entity';
import { MarketplaceCategory } from './entities/marketplace-category.entity';
import { MarketplaceListingReport } from './entities/marketplace-listing-report.entity';
import { MarketplaceListingContact } from './entities/marketplace-listing-contact.entity';
import { MarketplaceListingFavorite } from './entities/marketplace-listing-favorite.entity';
import { MarketplaceSettings } from './entities/marketplace-settings.entity';

import { MarketplaceListingsService } from './services/marketplace-listings.service';
import { MarketplaceCategoriesService } from './services/marketplace-categories.service';
import { MarketplaceReportsService } from './services/marketplace-reports.service';
import { MarketplaceSettingsService } from './services/marketplace-settings.service';

import { MarketplaceListingsResolver } from './resolvers/marketplace-listings.resolver';
import { MarketplaceCategoriesResolver } from './resolvers/marketplace-categories.resolver';
import { MarketplaceReportsResolver } from './resolvers/marketplace-reports.resolver';
import { MarketplaceSettingsResolver } from './resolvers/marketplace-settings.resolver';

import { MarketplaceController } from './controllers/marketplace.controller';
import { MarketplaceCron } from './cron/marketplace.cron';
import { MarketplaceNotificationDetailProvider } from './providers/marketplace-notification-detail.provider';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule } from '../residents/residents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MarketplaceListing,
      MarketplaceCategory,
      MarketplaceListingReport,
      MarketplaceListingContact,
      MarketplaceListingFavorite,
      MarketplaceSettings,
    ]),
    ResidentialComplexModule, // ResidentialComplexService + UnitService
    ResidentsModule, // la unidad desde la que se publica y quién pregunta
    NotificationsModule, // avisos al autor y a la administración
    AuditModule,
    // R2Module y SocketModule son @Global()
  ],
  controllers: [MarketplaceController],
  providers: [
    MarketplaceListingsService,
    MarketplaceCategoriesService,
    MarketplaceReportsService,
    MarketplaceSettingsService,
    MarketplaceListingsResolver,
    MarketplaceCategoriesResolver,
    MarketplaceReportsResolver,
    MarketplaceSettingsResolver,
    MarketplaceCron,
    // Cómo se lee el expediente de un aviso de clasificados. Se registra solo
    // al arrancar; notificaciones no necesita conocer este módulo.
    MarketplaceNotificationDetailProvider,
  ],
  exports: [MarketplaceListingsService, MarketplaceSettingsService],
})
export class MarketplaceModule {}
