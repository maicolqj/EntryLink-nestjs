import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsNotEmpty, IsEnum } from 'class-validator';

import { PushPlatform } from '../../enums/push-platform.enum';

/** Input para registrar un token FCM de dispositivo móvil (Android / iOS) */
@InputType()
export class SaveMobileTokenInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  deviceToken: string;

  /** Solo se acepta ANDROID o IOS */
  @Field(() => PushPlatform)
  @IsEnum(PushPlatform)
  platform: PushPlatform;
}
