import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { Note }           from './entities/note.entity';
import { NotesService }   from './services/notes.service';
import { NotesResolver }  from './resolvers/notes.resolver';
import { NotesController } from './controllers/notes.controller';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([Note]),
    ResidentialComplexModule, // provee ResidentialComplexService
    // CloudinaryModule es @Global() — disponible automáticamente
  ],
  controllers: [NotesController],
  providers:   [NotesService, NotesResolver],
  exports:     [NotesService],
})
export class NotesModule {}
