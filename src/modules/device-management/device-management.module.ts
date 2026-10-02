import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';

import { ResidentialComplex } from '../residential-complex/entities/residential-complex.entity';
import { ManagedEnterprise } from './entities/managed-enterprise.entity';
import { AndroidManagementClient } from './services/android-management.client';
import { DeviceManagementService } from './services/device-management.service';
import { DeviceManagementResolver } from './resolvers/device-management.resolver';

/**
 * Equipos de portería en modo kiosco con Android Management API: EntryLink se
 * instala desde Google Play y queda como única app del equipo. Ver
 * `kiosk-policy.ts`.
 */
@Module({
  imports: [TypeOrmModule.forFeature([ManagedEnterprise, ResidentialComplex])],
  providers: [AndroidManagementClient, DeviceManagementService, DeviceManagementResolver],
})
export class DeviceManagementModule {}
