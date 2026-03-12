import { SetMetadata } from '@nestjs/common';
import { ValidRoles } from '../../roles/enums/valid-roles';


export const META_ROLES = 'roles';
export const META_PERMISSIONS = 'permissions';

export const RoleProtected = (...args: ValidRoles[]) => {
  return SetMetadata(META_ROLES, args);
};