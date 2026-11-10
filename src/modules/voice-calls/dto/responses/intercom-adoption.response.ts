import { Field, Int, ObjectType } from '@nestjs/graphql';

@ObjectType()
export class IntercomUnitAdoption {
  @Field(() => String)
  unitId: string;

  @Field(() => String)
  unitNumber: string;

  @Field(() => String, { nullable: true })
  buildingName: string | null;

  @Field(() => Int, { description: 'Residentes activos de la unidad' })
  residents: number;

  @Field(() => Int, {
    description: 'De ellos, cuántos tienen la app instalada',
  })
  residentsWithApp: number;
}

/**
 * Cuántas unidades podrían recibir citofonía por internet. Se mira antes de
 * pasar un conjunto a INTERNET: la unidad donde nadie tiene la app queda sin
 * citofonía.
 */
@ObjectType()
export class IntercomAdoption {
  @Field(() => Int, { description: 'Unidades con residentes activos' })
  totalUnits: number;

  @Field(() => Int, {
    description: 'Unidades con al menos un residente con la app',
  })
  unitsWithApp: number;

  @Field(() => [IntercomUnitAdoption], {
    description: 'Unidades donde nadie tiene la app',
  })
  unitsWithoutApp: IntercomUnitAdoption[];
}
