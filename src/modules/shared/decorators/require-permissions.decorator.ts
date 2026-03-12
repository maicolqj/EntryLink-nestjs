import { SetMetadata } from '@nestjs/common';
import { META_PERMISSIONS } from './rol-protected.decorator';


export const RequirePermissions = (...permissions: string[]) => {
  return SetMetadata(META_PERMISSIONS, permissions);
};