import { InputType, Field } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsUUID, IsBoolean, MaxLength,
} from 'class-validator';

import { AccountNature } from '../../enums/account-nature.enum';

/**
 * Actualización de una cuenta PUC. No permite cambiar `code` ni `accountClass`
 * (se validan/bloquean en el servicio si la cuenta ya tiene movimientos).
 */
@InputType()
export class UpdatePucAccountInput {

  @Field()
  @IsUUID()
  id: string;

  @Field()
  @IsUUID()
  complexId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name?: string;

  @Field(() => AccountNature, { nullable: true })
  @IsOptional()
  @IsEnum(AccountNature)
  nature?: AccountNature;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
