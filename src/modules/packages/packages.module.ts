import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Package } from './entities/package.entity';

import { PackagesService }    from './services/packages.service';
import { PackagesResolver }   from './resolvers/packages.resolver';
import { PackagesController } from './controllers/packages.controller';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { NotificationsModule }      from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Package]),
    ResidentialComplexModule, // ResidentialComplexService + UnitService
    ResidentsModule,          // ResidentsService (para notificar al residente de la unidad)
    NotificationsModule,      // NotificationsService (para crear notificaciones)
    // R2Module es @Global() — disponible automáticamente
  ],
  controllers: [PackagesController],
  providers: [
    PackagesService,
    PackagesResolver,
  ],
  exports: [
    PackagesService,
  ],
})
export class PackagesModule {}
