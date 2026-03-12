import { Logger, Module } from '@nestjs/common';
import { RolesService } from './roles.service';
import { RolesResolver } from './roles.resolver';
import { TypeOrmModule } from '@nestjs/typeorm';
import { Role } from './entities/role.entity';
import { Permission } from '../permissions/entities/permission.entity';
import { User } from '../users/entities/user.entity';
import { UserRole } from '../users/entities/user_has_roles.entity';


@Module({
  imports: [TypeOrmModule.forFeature([Role, Permission, User, UserRole])],
  providers: [RolesResolver, RolesService, Logger,],
  exports: [RolesService, TypeOrmModule]
})
export class RolesModule {}
