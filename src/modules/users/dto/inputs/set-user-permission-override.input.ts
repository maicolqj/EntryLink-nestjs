import { InputType, Field } from '@nestjs/graphql';
import {
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
} from 'class-validator';

import { PermissionOverrideEffect } from '../../enums/permission-override-effect.enum';

@InputType({
  description: 'Da o quita un permiso a un usuario por encima de sus roles',
})
export class SetUserPermissionOverrideInput {
  @Field(() => String)
  @IsUUID()
  userId: string;

  @Field(() => String)
  @IsUUID()
  permissionId: string;

  @Field(() => PermissionOverrideEffect)
  @IsEnum(PermissionOverrideEffect)
  effect: PermissionOverrideEffect;

  @Field(() => String, {
    nullable: true,
    description: 'Por qué se dio o se quitó',
  })
  @IsOptional()
  @IsString()
  @MaxLength(500)
  reason?: string;
}
