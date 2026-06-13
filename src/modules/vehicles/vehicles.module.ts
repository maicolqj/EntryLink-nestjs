import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Vehicle }               from './entities/vehicle.entity';
import { ParkingRotationConfig } from './entities/parking-rotation-config.entity';
import { ParkingRecord }         from './entities/parking-record.entity';

import { VehiclesService }    from './services/vehicles.service';
import { VehiclesResolver }   from './resolvers/vehicles.resolver';
import { VehiclesController } from './controllers/vehicles.controller';


import { FeeCharge } from '../finance/entities/fee-charge.entity';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';
import { AuditModule }              from '../audit/audit.module';
import { FinanceModule }            from '../finance/finance.module';
import { NotificationsModule }      from '../notifications/notifications.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([
      Vehicle,
      ParkingRotationConfig,

      ParkingRecord,
      FeeCharge,     // necesario para crear cargos en CHARGE_TO_UNIT
    ]),
    ResidentialComplexModule,
    ResidentsModule,
    AuditModule,
    FinanceModule,
    NotificationsModule,
  ],
  controllers: [VehiclesController],
  providers: [
    VehiclesService,
    VehiclesResolver,
  ],
  exports: [VehiclesService],
})
export class VehiclesModule {}
