import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { VisitorVehicle }       from './entities/visitor-vehicle.entity';
import { VisitorParkingConfig } from './entities/visitor-parking-config.entity';
import { VisitorParkingRate }   from './entities/visitor-parking-rate.entity';

import { Resident } from '../residents/entities/resident.entity';

import { VisitorParkingService }  from './services/visitor-parking.service';
import { VisitorParkingResolver } from './resolvers/visitor-parking.resolver';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { AuditModule }              from '../audit/audit.module';
import { NotificationsModule }      from '../notifications/notifications.module';
import { ParkingRecord } from '../vehicles/entities/parking-record.entity';
import { FeeCharge } from '../finance/entities/fee-charge.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([ParkingRecord, VisitorVehicle, VisitorParkingConfig, VisitorParkingRate, Resident, FeeCharge]),
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
