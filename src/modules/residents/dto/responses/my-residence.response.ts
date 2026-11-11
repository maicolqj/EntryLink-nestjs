import { Field, Int, ObjectType } from '@nestjs/graphql';

/** Un conjunto donde vive la persona, para el selector de RemoteLink. */
@ObjectType({
  description:
    'Un conjunto donde vive la persona, para el selector de RemoteLink.',
})
export class MyResidence {
  @Field(() => String)
  complexId: string;

  @Field(() => String)
  complexName: string;

  @Field(() => String, { nullable: true })
  buildingName?: string | null;

  @Field(() => String, { nullable: true })
  unitNumber?: string | null;

  @Field(() => Boolean, { description: 'Es el conjunto de la sesión actual' })
  isCurrent: boolean;

  @Field(() => Int, { description: 'Avisos sin leer en ese conjunto' })
  unreadCount: number;
}
