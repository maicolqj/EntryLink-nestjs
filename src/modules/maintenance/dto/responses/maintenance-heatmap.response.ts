import { ObjectType, Field, Int, Float } from '@nestjs/graphql';

import { MaintenanceCategory } from '../../enums/maintenance-category.enum';

/**
 * Una celda del mapa de calor: un sitio y cuántas veces se dañó.
 *
 * Se agrega por SITIO —tag, torre o zona común— y no por coordenada. Un mapa de
 * calor por píxel exige un plano digital del conjunto que ningún complejo tiene
 * levantado, y de todos modos respondería la pregunta equivocada: lo que le
 * sirve al consejo no es dónde se concentran los puntos, sino que el ascensor
 * de la torre 2 lleva nueve fallas en tres meses y ya no es mantenimiento sino
 * reposición.
 */
@ObjectType({ description: 'Concentración de incidencias por sitio' })
export class MaintenanceHeatmapCell {
  @Field(() => String, { description: 'Identificador del sitio agrupado' })
  key: string;

  @Field(() => String, { description: 'Nombre visible del sitio' })
  label: string;

  @Field(() => Int)
  total: number;

  @Field(() => Int, { description: 'Los que siguen sin resolver' })
  openCount: number;

  @Field(() => Int, { description: 'Los que vencieron su plazo' })
  overdueCount: number;

  @Field(() => MaintenanceCategory, {
    nullable: true,
    description: 'Categoría que más se repite en el sitio',
  })
  topCategory?: MaintenanceCategory | null;

  @Field(() => Float, { nullable: true })
  lat?: number | null;

  @Field(() => Float, { nullable: true })
  lng?: number | null;
}
