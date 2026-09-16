import { registerEnumType } from '@nestjs/graphql';

/**
 * Cómo quedó fijada la ubicación del daño.
 *
 * Se guarda el MÉTODO y no solo las coordenadas porque no todos merecen la
 * misma confianza: un punto puesto con un TAG pegado en la pared del cuarto de
 * bombas es exacto, y uno de GPS en un sótano puede estar a media cuadra. El
 * tablero y el mapa necesitan saber cuál de los dos están pintando.
 */
export enum MaintenanceLocationType {
  /** Coordenada del dispositivo. Sirve en exteriores. */
  GPS = 'GPS',
  /** Código QR o TAG NFC pegado en el sitio. Es el más confiable. */
  TAG = 'TAG',
  /** Torre + piso + referencia escrita. Para interiores sin tag. */
  TREE = 'TREE',
  /** Zona común ya modelada en el sistema (piscina, gimnasio, salón). */
  AMENITY = 'AMENITY',
}

registerEnumType(MaintenanceLocationType, {
  name: 'MaintenanceLocationType',
  description: 'Método con el que se fijó la ubicación del daño',
});
