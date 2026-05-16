import { ObjectType, Field, registerEnumType } from '@nestjs/graphql';

export enum RemoveStaffAction {
  STAFF_ROLE_REMOVED = 'STAFF_ROLE_REMOVED', // Solo se quitó el rol; el usuario sigue activo como residente
  USER_DELETED       = 'USER_DELETED',       // El usuario fue eliminado del sistema (no era residente)
}

registerEnumType(RemoveStaffAction, {
  name: 'RemoveStaffAction',
  description: 'Resultado de la operación de eliminación de personal',
  valuesMap: {
    STAFF_ROLE_REMOVED: { description: 'Se quitó el rol de personal; el usuario continúa como residente' },
    USER_DELETED:       { description: 'El usuario fue dado de baja (soft delete); sus credenciales quedan disponibles para nuevos registros' },
  },
});

@ObjectType({ description: 'Resultado de eliminar un miembro del personal' })
export class RemoveStaffMemberResponse {
  @Field(() => Boolean)
  success: boolean;

  @Field(() => RemoveStaffAction)
  action: RemoveStaffAction;

  @Field(() => String)
  message: string;
}
