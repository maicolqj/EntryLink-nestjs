import { Field, ObjectType } from '@nestjs/graphql';

/**
 * Una portería a la que el residente puede llamar por la app. Es la cuenta de
 * vigilante con la que está abierta EntryLink en ese puesto; el nombre es el de
 * la cuenta (ej. "PORTERÍA NORTE").
 */
@ObjectType()
export class IntercomSecurityContact {
  @Field(() => String)
  userId: string;

  @Field(() => String)
  name: string;
}
