import { registerEnumType } from '@nestjs/graphql';

/**
 * Cómo llama la portería a los residentes. Lo elige el SUPER_ADMIN por
 * conjunto; no hay modo mixto.
 */
export enum IntercomMode {
  /** Con la línea del celular de portería (marcador de EntryLink). */
  SIM = 'SIM',
  /** Por internet, de EntryLink a la app RemoteLink del residente. */
  INTERNET = 'INTERNET',
}

registerEnumType(IntercomMode, {
  name: 'IntercomMode',
  description: 'Citofonía del conjunto: por línea celular o por internet',
});
