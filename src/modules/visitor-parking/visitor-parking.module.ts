import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ParkingRate }    from './entities/parking-rate.entity';
import { VisitorVehicle } from './entities/visitor-vehicle.entity';

import { Resident } from '../residents/entities/resident.entity';

import { VisitorParkingService }  from './services/visitor-parking.service';
import { VisitorParkingResolver } from './resolvers/visitor-parking.resolver';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { AuditModule }              from '../audit/audit.module';
import { NotificationsModule }      from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ParkingRate, VisitorVehicle, Resident]),
    ResidentialComplexModule,
    ResidentsModule,
    AuditModule,
    NotificationsModule,   // expone NotificationsService
  ],
  providers: [
    VisitorParkingService,
    VisitorParkingResolver,
  ],
  exports: [
    VisitorParkingService,
  ],
})
export class VisitorParkingModule {}
