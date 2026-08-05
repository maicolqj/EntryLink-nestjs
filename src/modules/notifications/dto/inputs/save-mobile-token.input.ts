import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsNotEmpty, IsEnum, IsOptional, MaxLength } from 'class-validator';

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

  // ─── Identificación del equipo (opcional) ──────────────────────────────────
  // Permite medir la entrega por marca de dispositivo. Opcional para no romper
  // las versiones de la app ya publicadas, que no lo envían.

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString() @MaxLength(120)
  deviceModel?: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString() @MaxLength(80)
  manufacturer?: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString() @MaxLength(40)
  osVersion?: string;

  @Field(() => String, { nullable: true })
  @IsOptional() @IsString() @MaxLength(40)
  appVersion?: string;
}
