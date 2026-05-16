import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { SpecialNumber }         from './entities/special-number.entity';
import { SpecialNumbersService } from './special-numbers.service';
import { SpecialNumbersResolver } from './special-numbers.resolver';

import { AuditModule } from '../audit/audit.module';

@Module({
  imports: [
    TypeOrmModule.forFeature([SpecialNumber]),
    AuditModule,
  ],
  providers: [SpecialNumbersService, SpecialNumbersResolver],
  exports:   [SpecialNumbersService],
})
export class SpecialNumbersModule {}
