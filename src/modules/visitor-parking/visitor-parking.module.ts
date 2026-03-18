import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ParkingRate }    from './entities/parking-rate.entity';
import { VisitorVehicle } from './entities/visitor-vehicle.entity';

import { VisitorParkingService }  from './services/visitor-parking.service';
import { VisitorParkingResolver } from './resolvers/visitor-parking.resolver';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ParkingRate, VisitorVehicle]),
    ResidentialComplexModule, // ResidentialComplexService
    ResidentsModule,          // ResidentsService.findById
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
