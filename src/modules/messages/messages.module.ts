import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SentMessage }      from './entities/sent-message.entity';
import { MessagesService }  from './services/messages.service';
import { MessagesResolver } from './resolvers/messages.resolver';

import { ResidentialComplexModule } from '../residential-complex/residential-complex.module';
import { AuditModule }              from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SentMessage]),
    ResidentialComplexModule,
    AuditModule,
  ],
  providers: [MessagesService, MessagesResolver],
  exports:   [MessagesService],
})
export class MessagesModule {}
