import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * Personal de aseo y mantenimiento que se le puede asignar a un ticket. Solo
 * lo que el tablero necesita para elegir por nombre, no la ficha del usuario.
 */
@ObjectType({
  description:
    'Miembro del personal de aseo y mantenimiento asignable a un ticket',
})
export class MaintenanceStaffMember {
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String, { nullable: true })
  lastName?: string | null;

  @Field(() => String, { nullable: true })
  phoneNumber?: string | null;
}
