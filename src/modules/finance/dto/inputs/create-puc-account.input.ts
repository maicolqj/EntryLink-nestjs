import { InputType, Field } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsEnum, IsUUID, IsBoolean, MaxLength,
} from 'class-validator';

import { AccountClass, AccountNature } from '../../enums/account-nature.enum';

@InputType()
export class CreatePucAccountInput {

  @Field()
  @IsUUID()
  complexId: string;

  /** Código PUC, único por copropiedad (ej. "11100501"). */
  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(20)
  code: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(200)
  name: string;

  @Field(() => AccountClass)
  @IsEnum(AccountClass)
  accountClass: AccountClass;

  @Field(() => AccountNature)
  @IsEnum(AccountNature)
  nature: AccountNature;

  /** Cuenta padre (misma copropiedad). Null = cuenta raíz/clase. */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsUUID()
  parentId?: string | null;

  /** Si true, admite movimientos (cuenta hoja). Default true. */
  @Field(() => Boolean, { nullable: true, defaultValue: true })
  @IsOptional()
  @IsBoolean()
  isPostable?: boolean;
}
