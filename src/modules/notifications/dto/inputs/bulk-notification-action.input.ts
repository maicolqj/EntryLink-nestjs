import { InputType, Field, registerEnumType } from '@nestjs/graphql';
import { ArrayMaxSize, ArrayNotEmpty, IsEnum, IsUUID } from 'class-validator';

/**
 * Qué se le hace a las notificaciones seleccionadas.
 *
 * Una sola mutation con un verbo en vez de cinco mutaciones: la bandeja las
 * ofrece juntas en la misma barra y todas comparten el mismo alcance —solo las
 * filas del propio usuario—, así que separar la autorización en cinco sitios
 * solo multiplica las formas de equivocarse.
 */
export enum BulkNotificationAction {
  MARK_READ = 'MARK_READ',
  /** Devolverla a "sin leer" para retomarla después, como en el correo. */
  MARK_UNREAD = 'MARK_UNREAD',
  STAR = 'STAR',
  UNSTAR = 'UNSTAR',
  DELETE = 'DELETE',
}

registerEnumType(BulkNotificationAction, {
  name: 'BulkNotificationAction',
  description: 'Acción a aplicar sobre las notificaciones seleccionadas',
});

@InputType()
export class BulkNotificationActionInput {
  /**
   * Tope de 200 por llamada: es más de lo que cabe en una página del buzón y
   * mantiene acotada la lista del `IN (...)`.
   */
  @Field(() => [String])
  @ArrayNotEmpty()
  @ArrayMaxSize(200)
  @IsUUID('4', { each: true })
  notificationIds: string[];

  @Field(() => BulkNotificationAction)
  @IsEnum(BulkNotificationAction)
  action: BulkNotificationAction;
}
