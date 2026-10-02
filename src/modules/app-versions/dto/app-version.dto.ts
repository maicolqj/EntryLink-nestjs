import { Field, InputType, Int, ObjectType } from '@nestjs/graphql';
import {
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  MaxLength,
  Min,
} from 'class-validator';

import { ClientApp, ClientPlatform } from '../enums/client-app.enum';

@ObjectType({ description: 'Resultado de revisar la versión instalada' })
export class AppVersionCheck {
  @Field(() => Boolean, {
    description:
      'true = la versión instalada ya no es compatible: la app debe bloquearse hasta actualizar',
  })
  updateRequired: boolean;

  @Field(() => Int)
  minVersionCode: number;

  @Field(() => String, { nullable: true })
  message?: string | null;
}

@InputType({ description: 'Fijar la versión mínima obligatoria de una app' })
export class SetAppVersionPolicyInput {
  @Field(() => ClientApp)
  @IsEnum(ClientApp)
  app: ClientApp;

  @Field(() => ClientPlatform)
  @IsEnum(ClientPlatform)
  platform: ClientPlatform;

  @Field(() => Int, { description: '0 = no se obliga a nadie' })
  @IsInt()
  @Min(0)
  minVersionCode: number;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  message?: string;
}
