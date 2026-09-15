import { ObjectType, Field } from '@nestjs/graphql';

/** Qué tiene encendido el complejo en votaciones. Lo usa la administración. */
@ObjectType('VotingSettings', {
  description: 'Módulo e interruptores de votaciones del complejo',
})
export class VotingSettingsResponse {
  @Field(() => Boolean, {
    description: 'El SUPER_ADMIN le habilitó el módulo al complejo',
  })
  moduleEnabled: boolean;

  @Field(() => Boolean, {
    description: 'Asambleas visibles para los residentes',
  })
  residentsEnabled: boolean;

  @Field(() => Boolean, {
    description: 'Reuniones del consejo visibles para el consejo',
  })
  councilEnabled: boolean;
}
