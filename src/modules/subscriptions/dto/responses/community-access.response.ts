import { Field, ObjectType } from '@nestjs/graphql';

@ObjectType({
  description: 'Acceso de la comunidad según la suscripción del conjunto',
})
export class CommunityAccess {
  @Field(() => Boolean, {
    description: 'La comunidad perdió el acceso por no renovar',
  })
  accessCut: boolean;

  @Field(() => Boolean, { description: 'El botón de pánico sigue funcionando' })
  panicAvailable: boolean;

  @Field(() => Date, {
    nullable: true,
    description:
      'Fecha del corte: ya ocurrió si accessCut, si no es la prevista',
  })
  cutAt: Date | null;
}
