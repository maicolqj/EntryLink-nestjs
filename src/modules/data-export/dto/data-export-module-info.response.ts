import { Field, ObjectType } from '@nestjs/graphql';

import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';

@ObjectType({ description: 'Módulo cuyos datos se pueden descargar' })
export class DataExportModuleInfo {
  @Field(() => ComplexModule)
  module: ComplexModule;

  @Field(() => String)
  label: string;

  @Field(() => Boolean, {
    description: 'Si el módulo está habilitado en el complejo',
  })
  enabled: boolean;
}
