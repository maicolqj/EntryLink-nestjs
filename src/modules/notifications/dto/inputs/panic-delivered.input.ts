import { IsOptional, IsString, MaxLength } from 'class-validator';

/**
 * Cuerpo del ACK de entrega. Deliberadamente mínimo: lo arma Kotlin a mano en la
 * ruta crítica, sin serializadores ni modelos.
 */
export class PanicDeliveredInput {

  /** Token firmado que viajó en el payload FCM como `ackToken`. */
  @IsString()
  @MaxLength(200)
  token: string;

  /**
   * Token FCM del equipo que confirma, para atribuir la entrega a un
   * dispositivo concreto. Opcional: sin él la alerta igual queda marcada como
   * entregada, solo se pierde el detalle de por cuál equipo.
   */
  @IsOptional()
  @IsString()
  @MaxLength(400)
  deviceToken?: string;
}
