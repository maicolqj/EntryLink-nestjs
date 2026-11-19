import { Field, ID, InputType, Int } from '@nestjs/graphql';
import {
  ArrayMaxSize,
  IsArray,
  IsEnum,
  IsInt,
  IsOptional,
  IsString,
  IsUUID,
  Length,
  Min,
} from 'class-validator';
import { GrowthTeamMemberStatus } from '../../../shared/growth.enums';

@InputType()
export class GrowthAddTeamMemberInput {
  @Field(() => ID, {
    description: 'Usuario existente con un rol de la suite y sin conjunto',
  })
  @IsUUID()
  userId: string;

  @Field()
  @IsString()
  @Length(2, 120)
  displayName: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  jobTitle?: string;

  @Field(() => [String], {
    nullable: true,
    description: 'Localidades de Bogotá a cargo',
  })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  territories?: string[];

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxActiveAssignments?: number;
}

@InputType()
export class GrowthUpdateTeamMemberInput {
  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 120)
  displayName?: string;

  @Field({ nullable: true })
  @IsOptional()
  @IsString()
  @Length(2, 80)
  jobTitle?: string;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMaxSize(20)
  @IsString({ each: true })
  territories?: string[];

  @Field(() => Int, { nullable: true })
  @IsOptional()
  @IsInt()
  @Min(1)
  maxActiveAssignments?: number;
}

@InputType()
export class GrowthTeamMemberFilterInput {
  @Field(() => GrowthTeamMemberStatus, { nullable: true })
  @IsOptional()
  @IsEnum(GrowthTeamMemberStatus)
  status?: GrowthTeamMemberStatus;
}
