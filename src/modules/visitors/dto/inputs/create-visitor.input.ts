import { InputType, Field } from '@nestjs/graphql';
import { IsEnum, IsOptional, IsString, IsUUID, MaxLength, MinLength } from 'class-validator';
import { VisitorIdentityType } from '../../enums/visitor-identity-type.enum';

@InputType()
export class CreateVisitorInput {

  @Field(() => String)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  name: string;

  @Field(() => String)
  @IsString()
  @MinLength(2)
  @MaxLength(100)
  lastName: string;

  @Field(() => String)
  @IsString()
  @MinLength(4)
  @MaxLength(30)
  identity: string;

  @Field(() => VisitorIdentityType, { defaultValue: VisitorIdentityType.CC })
  @IsOptional()
  @IsEnum(VisitorIdentityType)
  identityType?: VisitorIdentityType;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(20)
  phone?: string;

  @Field(() => String, { description: 'URL de la foto capturada en portería', nullable: true })
  @IsOptional()
  @IsString()
  photoUrl?: string;

  @Field(() => String, { description: 'ID del complejo' })
  @IsUUID()
  complexId: string;
}
