import { Module } from '@nestjs/common';
import { PermissionsService } from './services/permissions.service';
import { PermissionsResolver } from './permissions.resolver';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Permission } from './entities/permission.entity';
import { PermissionDependencyService } from './services/permission-dependecy.service';

@Module({
  imports: [TypeOrmModule.forFeature([Permission])],
  providers: [PermissionsResolver, PermissionsService, PermissionDependencyService],
})
export class PermissionsModule {}
