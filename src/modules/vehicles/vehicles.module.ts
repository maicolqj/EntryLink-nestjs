import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Vehicle } from './entities/vehicle.entity';

import { VehiclesService }  from './services/vehicles.service';
import { VehiclesResolver } from './resolvers/vehicles.resolver';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { ResidentsModule }          from '../residents/residents.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Vehicle]),
    ResidentialComplexModule, // ResidentialComplexService + UnitService
    ResidentsModule,          // ResidentsService
  ],
  providers: [
    VehiclesService,
    VehiclesResolver,
  ],
  exports: [
    // Exportado para que el módulo de seguridad/logs pueda
    // registrar accesos vehiculares y hacer consultas de placa
    VehiclesService,
  ],
})
export class VehiclesModule {}
