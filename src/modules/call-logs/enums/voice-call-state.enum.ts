import { registerEnumType } from '@nestjs/graphql';

/**
 * Estado en vivo de una llamada por internet. Las de SIM no lo usan (null):
 * el marcador las registra cuando ya terminaron.
 */
export enum VoiceCallState {
  /** Sonando en el equipo de quien recibe. */
  RINGING = 'RINGING',
  /** Contestada: las dos partes están hablando. */
  ACTIVE = 'ACTIVE',
  /** Terminó (contestada, perdida, rechazada o cancelada). */
  ENDED = 'ENDED',
}

registerEnumType(VoiceCallState, {
  name: 'VoiceCallState',
  description: 'Estado en vivo de una llamada por internet',
});
