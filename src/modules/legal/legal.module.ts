import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { LegalDocument } from './entities/legal-document.entity';
import { LegalDocumentService } from './services/legal-document.service';
import { LegalDocumentResolver } from './resolvers/legal-document.resolver';
import { LegalDocumentController } from './controllers/legal-document.controller';

@Module({
  imports: [TypeOrmModule.forFeature([LegalDocument])],
  controllers: [LegalDocumentController],
  providers: [LegalDocumentService, LegalDocumentResolver],
  exports: [LegalDocumentService],
})
export class LegalModule {}
