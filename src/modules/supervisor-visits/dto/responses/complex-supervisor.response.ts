import { Field, ID, ObjectType } from '@nestjs/graphql';

/**
 * Supervisor con acceso aprobado a un complejo, como lo ve la administración
 * en Personal. Llega por solicitud desde la app, así que la administración
 * solo lo consulta: no lo crea, no lo edita.
 */
@ObjectType({
  description: 'Supervisor con acceso activo a un complejo',
})
export class ComplexSupervisor {
  /** Id del usuario supervisor. */
  @Field(() => ID)
  id: string;

  @Field(() => String)
  name: string;

  @Field(() => String, { nullable: true })
  lastName?: string | null;

  @Field(() => String, { nullable: true })
  email?: string | null;

  @Field(() => String, { nullable: true })
  phoneNumber?: string | null;

  @Field(() => String, { nullable: true })
  identityType?: string | null;

  @Field(() => String, { nullable: true })
  identity?: string | null;

  @Field(() => Date, { description: 'Cuándo se aprobó su acceso' })
  assignedAt: Date;

  @Field(() => Date, {
    nullable: true,
    description: 'Último check-in en el complejo; nulo si nunca ha venido',
  })
  lastCheckInAt?: Date | null;

  @Field(() => Date, {
    description:
      'Desde cuándo el sistema le retira el acceso si no vuelve a hacer check-in',
  })
  autoRemovalAt: Date;
}
