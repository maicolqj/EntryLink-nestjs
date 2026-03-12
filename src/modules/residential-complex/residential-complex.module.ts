import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ResidentialComplex }           from './entities/residential-complex.entity';
import { Building }                     from './entities/building.entity';
import { Unit }                         from './entities/unit.entity';

import { ResidentialComplexService }    from './services/residential-complex.service';
import { BuildingService }              from './services/building.service';
import { UnitService }                  from './services/unit.service';

import { ResidentialComplexResolver }   from './resolvers/residential-complex.resolver';
import { BuildingResolver }             from './resolvers/building.resolver';
import { UnitResolver }                 from './resolvers/unit.resolver';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResidentialComplex, Building, Unit]),
  ],
  providers: [
    // Servicios
    ResidentialComplexService,
    BuildingService,
    UnitService,
    // Resolvers
    ResidentialComplexResolver,
    BuildingResolver,
    UnitResolver,
  ],
  exports: [
    // Exportamos los servicios para que otros módulos puedan usarlos
    // (ej: ResidentsModule necesitará UnitService y ResidentialComplexService)
    ResidentialComplexService,
    BuildingService,
    UnitService,
  ],
})
export class ResidentialComplexModule {}
