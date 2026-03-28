import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, IsOptional, IsString } from 'class-validator';

@InputType()
export class UpdateUserInput {
  @Field(() => String)
  @IsUUID()
  userId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  name?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  lastName?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  phoneNumber?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  role?: string;
}
