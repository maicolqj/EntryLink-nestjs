import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Note }           from './entities/note.entity';
import { NotesService }   from './services/notes.service';
import { NotesResolver }  from './resolvers/notes.resolver';
import { NotesController } from './controllers/notes.controller';

import { ResidentialComplexModule }  from '../residential-complex/residential-complex.module';
import { AuditModule }               from '../audit/audit.module';
import { SupervisorVisitsModule }    from '../supervisor-visits/supervisor-visits.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Note]),
    ResidentialComplexModule,
    AuditModule,
    SupervisorVisitsModule,
    // R2Module es @Global() — disponible automáticamente
  ],
  controllers: [NotesController],
  providers:   [NotesService, NotesResolver],
  exports:     [NotesService],
})
export class NotesModule {}
