import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import { ResidentialComplex }           from './entities/residential-complex.entity';
import { Building }                     from './entities/building.entity';
import { Unit }                         from './entities/unit.entity';

import { ResidentialComplexService }    from './services/residential-complex.service';
import { BuildingService }              from './services/building.service';
import { UnitService }                  from './services/unit.service';
import { GeocodingService }             from './services/geocoding.service';

import { ResidentialComplexResolver }   from './resolvers/residential-complex.resolver';
import { BuildingResolver }             from './resolvers/building.resolver';
import { UnitResolver }                 from './resolvers/unit.resolver';
import { User }        from '../users/entities/user.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResidentialComplex, Building, Unit, User]),
    AuditModule,
    HttpModule.register({
      timeout: 5000,
      headers: { 'User-Agent': 'Residash/1.0' },
    }),
  ],
  providers: [
    ResidentialComplexService,
    BuildingService,
    UnitService,
    GeocodingService,
    ResidentialComplexResolver,
    BuildingResolver,
    UnitResolver,
  ],
  exports: [
    ResidentialComplexService,
    BuildingService,
    UnitService,
  ],
})
export class ResidentialComplexModule {}
