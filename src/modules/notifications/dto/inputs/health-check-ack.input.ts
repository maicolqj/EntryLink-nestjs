import { IsString, MaxLength } from 'class-validator';

/** Cuerpo del ACK de la prueba de humo. Lo arma el cliente en la ruta crítica. */
export class HealthCheckAckInput {

  /** Token firmado que viajó en el push de prueba como `ackToken`. */
  @IsString()
  @MaxLength(200)
  token: string;
}
