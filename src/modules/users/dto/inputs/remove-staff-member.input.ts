import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsNotEmpty, IsUUID } from 'class-validator';

import { ValidRoles }              from '../../../roles/enums/valid-roles';
import { STAFF_ROLES, StaffRole }  from './create-staff-member.input';

@InputType({ description: 'Datos para eliminar un miembro del personal del complejo' })
export class RemoveStaffMemberInput {

  @Field(() => String, { description: 'ID del usuario a eliminar del personal' })
  @IsUUID('4')
  @IsNotEmpty()
  userId: string;

  @Field(() => String, { description: 'ID del complejo del que se elimina al personal' })
  @IsUUID('4')
  @IsNotEmpty()
  complexId: string;

  @Field(() => ValidRoles, {
    description: 'Rol específico a revocar: SECURITY_ROL | SUPERVISOR_ROL | ACCOUNTANT_ROL',
  })
  @IsEnum(ValidRoles)
  @IsNotEmpty()
  role: StaffRole;
}
