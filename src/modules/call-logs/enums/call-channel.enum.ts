import { registerEnumType } from '@nestjs/graphql';

/**
 * Por dónde salió la llamada. SIM = el marcador de EntryLink con la línea del
 * celular de portería; INTERNET = llamada de voz por la app (WebRTC).
 */
export enum CallChannel {
  SIM = 'SIM',
  INTERNET = 'INTERNET',
}

registerEnumType(CallChannel, {
  name: 'CallChannel',
  description: 'Canal de la llamada: línea del celular (SIM) o por internet',
});
