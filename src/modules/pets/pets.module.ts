import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Pet } from './entities/pet.entity';
import { PetIncident } from './entities/pet-incident.entity';
import { PetIncidentStatement } from './entities/pet-incident-statement.entity';

import { PetsService } from './services/pets.service';
import { PetIncidentsService } from './services/pet-incidents.service';
import { PetsResolver } from './resolvers/pets.resolver';
import { PetIncidentsResolver } from './resolvers/pet-incidents.resolver';
import { PetsController } from './controllers/pets.controller';
import { PetsCron } from './cron/pets.cron';
import { PetsNotificationDetailProvider } from './providers/pets-notification-detail.provider';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule } from '../residents/residents.module';
import { NotificationsModule } from '../notifications/notifications.module';
import { FinanceModule } from '../finance/finance.module';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Pet, PetIncident, PetIncidentStatement]),
    ResidentialComplexModule, // ResidentialComplexService + UnitService
    ResidentsModule, // unidad del residente y destinatarios de los avisos
    NotificationsModule, // avisos a la unidad y a la administración
    FinanceModule, // AccountingService: la multa entra a la cartera de la unidad
    AuditModule,
    // R2Module y SocketModule son @Global()
  ],
  controllers: [PetsController],
  providers: [
    PetsService,
    PetIncidentsService,
    PetsResolver,
    PetIncidentsResolver,
    PetsCron,
    // Cómo se lee el expediente de un aviso de mascotas. Se registra solo al
    // arrancar; notificaciones no necesita conocer este módulo.
    PetsNotificationDetailProvider,
  ],
  exports: [PetsService, PetIncidentsService],
})
export class PetsModule {}
