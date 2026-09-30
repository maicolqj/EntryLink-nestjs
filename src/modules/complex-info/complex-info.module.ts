import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ComplexDocument } from './entities/complex-document.entity';
import { ComplexDocumentAck } from './entities/complex-document-ack.entity';
import { ComplexContact } from './entities/complex-contact.entity';
import { ComplexInfoAccessService } from './services/complex-info-access.service';
import { ComplexDocumentsService } from './services/complex-documents.service';
import { ComplexContactsService } from './services/complex-contacts.service';
import { MyComplexService } from './services/my-complex.service';
import { ComplexInfoResolver } from './resolvers/complex-info.resolver';
import { ComplexDocumentsController } from './controllers/complex-documents.controller';

import { Resident } from '../residents/entities/resident.entity';
import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { NotificationsModule } from '../notifications/notifications.module';

/**
 * "Mi Conjunto": los documentos (manual de convivencia, reglamento, actas…) y
 * el directorio de contactos del conjunto, que la administración publica y el
 * residente consulta desde la app.
 */
@Module({
  imports: [
    TypeOrmModule.forFeature([
      ComplexDocument,
      ComplexDocumentAck,
      ComplexContact,
      Resident, // ficha del residente y audiencia de cada documento
      ResidentialComplex, // datos generales del conjunto
    ]),
    ResidentialComplexModule, // acceso de la administración y slug para R2
    NotificationsModule, // aviso al publicar
  ],
  controllers: [ComplexDocumentsController],
  providers: [
    ComplexInfoAccessService,
    ComplexDocumentsService,
    ComplexContactsService,
    MyComplexService,
    ComplexInfoResolver,
  ],
})
export class ComplexInfoModule {}
