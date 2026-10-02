import { registerEnumType } from '@nestjs/graphql';

/** Apps móviles que consultan su política de versión. */
export enum ClientApp {
  /** App del residente (com.alternaqj.remotelink). */
  REMOTELINK = 'REMOTELINK',
  /** App de portería y administración (com.alternaqj.entrylink). */
  ENTRYLINK = 'ENTRYLINK',
}

registerEnumType(ClientApp, {
  name: 'ClientApp',
  description: 'App móvil',
  valuesMap: {
    REMOTELINK: { description: 'RemoteLink (residentes)' },
    ENTRYLINK: { description: 'EntryLink (portería y administración)' },
  },
});

export enum ClientPlatform {
  ANDROID = 'ANDROID',
  IOS = 'IOS',
}

registerEnumType(ClientPlatform, {
  name: 'ClientPlatform',
  description: 'Sistema operativo de la app',
});
