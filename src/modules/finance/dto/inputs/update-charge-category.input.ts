import { InputType, Field, ID } from '@nestjs/graphql';
import {
  IsString, IsNotEmpty, IsOptional, IsBoolean, MaxLength, Matches,
} from 'class-validator';

@InputType()
export class UpdateChargeCategoryInput {

  @Field(() => ID)
  @IsString()
  @IsNotEmpty()
  id: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(100)
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(300)
  description?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @Matches(/^#[0-9A-Fa-f]{6}$/, { message: 'El color debe ser un valor hex válido (ej: #3B82F6)' })
  color?: string;

  @Field(() => Boolean, { nullable: true })
  @IsOptional()
  @IsBoolean()
  isActive?: boolean;
}
