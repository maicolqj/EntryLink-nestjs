import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Vehicle }               from './entities/vehicle.entity';
import { ParkingRotationConfig } from './entities/parking-rotation-config.entity';
import { ParkingConfig }         from './entities/parking-config.entity';
import { ParkingRecord }         from './entities/parking-record.entity';

import { VehiclesService }   from './services/vehicles.service';
import { ParkingService }    from './services/parking.service';
import { VehiclesResolver }  from './resolvers/vehicles.resolver';
import { ParkingResolver }   from './resolvers/parking.resolver';

import { FeeCharge } from '../finance/entities/fee-charge.entity';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { AuditModule }              from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Vehicle,
      ParkingRotationConfig,
      ParkingConfig,
      ParkingRecord,
      FeeCharge,     // necesario para crear cargos en CHARGE_TO_UNIT
    ]),
    ResidentialComplexModule,
    ResidentsModule,
    AuditModule,
  ],
  providers: [
    VehiclesService,
    VehiclesResolver,
    ParkingService,
    ParkingResolver,
  ],
  exports: [VehiclesService],
})
export class VehiclesModule {}
