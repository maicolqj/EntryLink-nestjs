import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { MaintenanceTicket } from './entities/maintenance-ticket.entity';
import { MaintenanceTicketEvent } from './entities/maintenance-ticket-event.entity';
import { MaintenanceLocationTag } from './entities/maintenance-location-tag.entity';
import { MaintenanceVendor } from './entities/maintenance-vendor.entity';
import { MaintenanceSlaConfig } from './entities/maintenance-sla-config.entity';
import { MaintenanceEndorsement } from './entities/maintenance-endorsement.entity';
import { User } from '../users/entities/user.entity';

import { MaintenanceTicketsService } from './services/maintenance-tickets.service';
import { MaintenanceLocationsService } from './services/maintenance-locations.service';
import { MaintenanceVendorsService } from './services/maintenance-vendors.service';
import { MaintenanceSlaService } from './services/maintenance-sla.service';
import { MaintenanceTicketsResolver } from './resolvers/maintenance-tickets.resolver';
import { MaintenanceLocationsResolver } from './resolvers/maintenance-locations.resolver';
import { MaintenanceVendorsResolver } from './resolvers/maintenance-vendors.resolver';
import { MaintenanceController } from './controllers/maintenance.controller';
import { MaintenanceCron } from './cron/maintenance.cron';
import { MaintenanceNotificationDetailProvider } from './providers/maintenance-notification-detail.provider';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule } from '../residents/residents.module';
import { AmenitiesModule } from '../amenities/amenities.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      MaintenanceTicket,
      MaintenanceTicketEvent,
      MaintenanceLocationTag,
      MaintenanceVendor,
      MaintenanceSlaConfig,
      MaintenanceEndorsement,
      // Solo para validar que el interno asignado pertenece al complejo.
      User,
    ]),
    ResidentialComplexModule, // ResidentialComplexService + BuildingService
    ResidentsModule, // unidad de quien reporta
    AmenitiesModule, // el daño puede caer sobre una zona común ya modelada
    NotificationsModule, // avisos al reportante, al personal y al consejo
    AuditModule,
    // R2Module y SocketModule son @Global()
  ],
  controllers: [MaintenanceController],
  providers: [
    MaintenanceTicketsService,
    MaintenanceLocationsService,
    MaintenanceVendorsService,
    MaintenanceSlaService,
    MaintenanceTicketsResolver,
    MaintenanceLocationsResolver,
    MaintenanceVendorsResolver,
    MaintenanceCron,
    // Cómo se lee el expediente de un aviso de mantenimiento. Se registra solo
    // al arrancar; notificaciones no necesita conocer este módulo.
    MaintenanceNotificationDetailProvider,
  ],
  exports: [MaintenanceTicketsService, MaintenanceLocationsService],
})
export class MaintenanceModule {}
