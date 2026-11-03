import { Global, Module } from '@nestjs/common';
import { PermissionStatusService } from './services/permission-status.service';

/**
 * Global: el guard de permisos (`@Auth`) se instancia en cada módulo que lo
 * usa y necesita el estado vigente de los permisos.
 */
@Global()
@Module({
  providers: [PermissionStatusService],
  exports: [PermissionStatusService],
})
export class PermissionStatusModule {}
