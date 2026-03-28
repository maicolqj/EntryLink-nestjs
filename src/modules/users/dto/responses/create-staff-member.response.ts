import { ObjectType, Field, ID, registerEnumType } from '@nestjs/graphql';
import { UserStatus } from '../../enums/user.enums';

export enum StaffMemberAction {
  CREATED          = 'CREATED',          // Usuario nuevo creado e incorporado
  REINTEGRATED     = 'REINTEGRATED',     // Usuario existente reintegrado (ej: guardia que vuelve)
  ADDED_TO_COMPLEX = 'ADDED_TO_COMPLEX', // Supervisor/Contador añadido a un complejo adicional
}

registerEnumType(StaffMemberAction, {
  name: 'StaffMemberAction',
  description: 'Resultado de la operación createStaffMember',
  valuesMap: {
    CREATED:          { description: 'Usuario nuevo creado e incorporado al complejo' },
    REINTEGRATED:     { description: 'Usuario existente reactivado y reintegrado a este complejo' },
    ADDED_TO_COMPLEX: { description: 'Usuario existente asignado a este complejo adicional (sin alterar sus otras asignaciones)' },
  },
});

@ObjectType({ description: 'Resultado de crear o reintegrar un miembro del personal' })
export class CreateStaffMemberResponse {

  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String)
  lastName: string;

  @Field(() => String)
  email: string;

  @Field(() => String)
  phoneNumber: string;

  @Field(() => String, { nullable: true })
  complexId?: string;

  @Field(() => UserStatus)
  status: UserStatus;

  @Field(() => StaffMemberAction)
  action: StaffMemberAction;
}
