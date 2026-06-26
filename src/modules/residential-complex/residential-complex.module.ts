import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { HttpModule } from '@nestjs/axios';

import { ResidentialComplex }           from './entities/residential-complex.entity';
import { Building }                     from './entities/building.entity';
import { Unit }                         from './entities/unit.entity';
import { CoefficientWeighting }         from './entities/coefficient-weighting.entity';
import { SupervisorVisit }             from '../supervisor-visits/entities/supervisor-visit.entity';

import { ResidentialComplexService }    from './services/residential-complex.service';
import { BuildingService }              from './services/building.service';
import { UnitService }                  from './services/unit.service';
import { CoefficientWeightingService }  from './services/coefficient-weighting.service';
import { GeocodingService }             from './services/geocoding.service';

import { ResidentialComplexResolver }    from './resolvers/residential-complex.resolver';
import { BuildingResolver }              from './resolvers/building.resolver';
import { UnitResolver }                  from './resolvers/unit.resolver';
import { CoefficientWeightingResolver }  from './resolvers/coefficient-weighting.resolver';
import { ResidentialComplexController }  from './controllers/residential-complex.controller';
import { User }        from '../users/entities/user.entity';
import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([ResidentialComplex, Building, Unit, CoefficientWeighting, User, SupervisorVisit]),
    AuditModule,
    HttpModule.register({
      timeout: 5000,
      headers: { 'User-Agent': 'entrylink/1.0' },
    }),
  ],
  controllers: [ResidentialComplexController],
  providers: [
    ResidentialComplexService,
    BuildingService,
    UnitService,
    CoefficientWeightingService,
    GeocodingService,
    ResidentialComplexResolver,
    BuildingResolver,
    UnitResolver,
    CoefficientWeightingResolver,
  ],
  exports: [
    ResidentialComplexService,
    BuildingService,
    UnitService,
    CoefficientWeightingService,
  ],
})
export class ResidentialComplexModule {}
