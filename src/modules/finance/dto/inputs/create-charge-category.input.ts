import { InputType, Field } from '@nestjs/graphql';
import { IsString, IsNotEmpty, IsOptional, MaxLength, Matches } from 'class-validator';

@InputType()
export class CreateChargeCategoryInput {

  @Field()
  @IsString()
  @IsNotEmpty()
  @MaxLength(100)
  name: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  /** Color hex, ej: '#3B82F6' */
  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'El color debe ser un valor hex válido (ej: #3B82F6)' })
  color?: string;

  @Field()
  @IsString()
  @IsNotEmpty()
  complexId: string;
}
