import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Resident } from '../residents/entities/resident.entity';
import { Vehicle } from '../vehicles/entities/vehicle.entity';
import { ParkingRotationConfig } from '../vehicles/entities/parking-rotation-config.entity';
import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { MyUnitService } from './my-unit.service';
import { MyUnitResolver } from './my-unit.resolver';

/**
 * "Mi unidad" del residente. Módulo aparte porque junta unidad, vehículos y
 * residentes: meterlo en cualquiera de esos tres crearía dependencias
 * circulares entre ellos.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([Resident, Vehicle, ParkingRotationConfig]),
    ResidentialComplexModule,
  ],
  providers: [MyUnitService, MyUnitResolver],
})
export class MyUnitModule {}
