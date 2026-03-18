import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Resident }               from './entities/resident.entity';
import { ResidentsService }       from './services/residents.service';
import { ResidentsResolver }      from './resolvers/residents.resolver';
import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';

import { User }     from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user_has_roles.entity';
import { Role }     from '../roles/entities/role.entity';

@Module({
  imports: [
    TypeOrmModule.forFeature([Resident, User, UserRole, Role]),
    // Importamos el módulo de complejos para acceder a
    // ResidentialComplexService y UnitService (ya exportados)
    ResidentialComplexModule,
  ],
  providers: [
    ResidentsService,
    ResidentsResolver,
  ],
  exports: [
    // Exportamos el servicio para que otros módulos (Visitors, Finance)
    // puedan verificar si un usuario es residente activo en un complejo
    ResidentsService,
  ],
})
export class ResidentsModule {}
