import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Amenity }         from './entities/amenity.entity';
import { AmenitySchedule } from './entities/amenity-schedule.entity';
import { AmenityBlackout } from './entities/amenity-blackout.entity';
import { AmenityScheduleException } from './entities/amenity-schedule-exception.entity';
import { AmenityBooking }  from './entities/amenity-booking.entity';
import { PropertyAccountStatus } from '../finance/entities/property-account-status.entity';

import { AmenitiesService }           from './services/amenities.service';
import { AmenityAvailabilityService } from './services/amenity-availability.service';
import { AmenityBookingsService }     from './services/amenity-bookings.service';
import { AmenitiesResolver }          from './resolvers/amenities.resolver';
import { AmenityBookingsResolver }    from './resolvers/amenity-bookings.resolver';
import { AmenitiesController }        from './controllers/amenities.controller';
import { AmenityBookingsCron }        from './cron/amenity-bookings.cron';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { NotificationsModule }      from '../notifications/notifications.module';
import { FinanceModule }            from '../finance/finance.module';
import { AuditModule }              from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Amenity,
      AmenitySchedule,
      AmenityBlackout,
      AmenityScheduleException,
      AmenityBooking,
      // Solo lectura: el bloqueo por cartera consulta el saldo materializado de
      // la unidad, que es el mismo número del estado de cuenta.
      PropertyAccountStatus,
    ]),
    ResidentialComplexModule, // ResidentialComplexService + UnitService
    ResidentsModule,          // ResidentsService (unidad del residente, destinatarios)
    NotificationsModule,      // NotificationsService (avisos a residentes y administración)
    FinanceModule,            // FinanceService (cargo de la reserva)
    AuditModule,              // AuditService
    // CacheModule, SocketModule y R2Module son @Global()
  ],
  controllers: [AmenitiesController],
  providers: [
    AmenitiesService,
    AmenityAvailabilityService,
    AmenityBookingsService,
    AmenitiesResolver,
    AmenityBookingsResolver,
    AmenityBookingsCron,
  ],
  exports: [
    AmenitiesService,
    AmenityBookingsService,
  ],
})
export class AmenitiesModule {}
