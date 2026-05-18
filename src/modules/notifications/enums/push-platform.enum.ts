import { registerEnumType } from '@nestjs/graphql';

export enum PushPlatform {
  WEB     = 'WEB',
  ANDROID = 'ANDROID',
  IOS     = 'IOS',
}

registerEnumType(PushPlatform, {
  name: 'PushPlatform',
  description: 'Plataforma de destino para notificaciones push',
});
