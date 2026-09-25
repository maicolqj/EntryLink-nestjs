import { ObjectType, Field, Int } from '@nestjs/graphql';

import { MaintenanceLocationTag } from '../../entities/maintenance-location-tag.entity';
import { Building } from '../../../residential-complex/entities/building.entity';
import { Amenity } from '../../../amenities/entities/amenity.entity';

/**
 * Todo lo que la app necesita para armar el formulario de reporte en una sola
 * petición: torres, zonas comunes y puntos señalizados del conjunto.
 *
 * Va junto y no en tres consultas porque el residente abre esta pantalla
 * parado frente a la gotera, muchas veces en un sótano con una raya de señal.
 * Tres viajes ahí son tres oportunidades de que el formulario no cargue.
 *
 * El residente no puede consultar `buildings` por su cuenta —ese permiso es de
 * la administración—, así que el recorte lo hace este módulo: de cada torre
 * solo salen el nombre y los pisos, que es lo que se necesita para señalar
 * dónde está el daño.
 */
@ObjectType({ description: 'Opciones de ubicación para radicar un ticket' })
export class MaintenanceReportOptionsResponse {
  @Field(() => [Building])
  buildings: Building[];

  @Field(() => [Amenity])
  amenities: Amenity[];

  @Field(() => [MaintenanceLocationTag])
  tags: MaintenanceLocationTag[];

  /** Si viene en false, la app esconde el botón de reportar. */
  @Field(() => Boolean)
  residentReportingEnabled: boolean;

  @Field(() => Int, {
    description: 'Error máximo del GPS aceptado como ubicación confiable',
  })
  gpsAccuracyMeters: number;

  /** La app muestra "Escanear el código del sitio" solo si viene en true. */
  @Field(() => Boolean, {
    description: 'El conjunto identifica sus sitios con stickers QR',
  })
  qrEnabled: boolean;

  /** La app muestra "Leer chip NFC" solo si viene en true (y el celular tiene NFC). */
  @Field(() => Boolean, {
    description: 'El conjunto identifica sus sitios con chips NFC',
  })
  nfcEnabled: boolean;
}

@ObjectType({ description: 'Medios con que las apps identifican el sitio de un daño' })
export class MaintenanceScanMethodsResponse {
  @Field(() => Boolean)
  qrEnabled: boolean;

  @Field(() => Boolean)
  nfcEnabled: boolean;
}
