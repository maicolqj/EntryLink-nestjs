import { ObjectType, Field, Int } from '@nestjs/graphql';

@ObjectType({ description: 'Resultado de una acción en lote sobre la bandeja' })
export class BulkNotificationActionResult {
  /** Cuántas filas cambiaron de verdad. */
  @Field(() => Int)
  affected: number;

  /**
   * Cuántas de las pedidas no se tocaron: avisos masivos (una fila compartida
   * por el complejo), de otro destinatario, ya borrados o ya en ese estado.
   *
   * Se informa en vez de fallar: que una selección entera se caiga porque una
   * de veinte filas era un comunicado convierte una acción de un clic en un
   * juego de adivinar cuál estorba.
   */
  @Field(() => Int)
  skipped: number;
}
