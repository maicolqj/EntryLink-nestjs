import { InputType, Field } from '@nestjs/graphql';
import {
  ArrayMaxSize,
  ArrayMinSize,
  IsArray,
  IsDate,
  IsEnum,
  IsOptional,
  IsString,
  IsUUID,
  MaxLength,
  MinLength,
} from 'class-validator';

import {
  VoteSecrecy,
  VoteWeighting,
  VotingMeetingKind,
} from '../../enums/voting.enums';

@InputType()
export class CreateVotingMeetingInput {
  @Field(() => String)
  @IsUUID()
  complexId: string;

  @Field(() => VotingMeetingKind)
  @IsEnum(VotingMeetingKind)
  kind: VotingMeetingKind;

  @Field(() => String)
  @IsString()
  @MinLength(3)
  @MaxLength(200)
  title: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Field(() => Date)
  @IsDate()
  scheduledAt: Date;
}

@InputType()
export class CreateVotingQuestionInput {
  @Field(() => String)
  @IsUUID()
  meetingId: string;

  @Field(() => String)
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  text: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Field(() => VoteWeighting, {
    nullable: true,
    description:
      'Solo asambleas: COEFFICIENT (por defecto) o UNIT. En el consejo vota cada miembro',
  })
  @IsOptional()
  @IsEnum(VoteWeighting)
  weighting?: VoteWeighting;

  @Field(() => VoteSecrecy, {
    nullable: true,
    defaultValue: VoteSecrecy.NOMINAL,
  })
  @IsOptional()
  @IsEnum(VoteSecrecy)
  secrecy?: VoteSecrecy;

  @Field(() => [String], { description: 'Opciones de respuesta, de 2 a 10' })
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options: string[];
}

/** Solo mientras la pregunta está en borrador. `options` reemplaza la lista entera. */
@InputType()
export class UpdateVotingQuestionInput {
  @Field(() => String)
  @IsUUID()
  questionId: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MinLength(3)
  @MaxLength(500)
  text?: string;

  @Field(() => String, { nullable: true })
  @IsOptional()
  @IsString()
  @MaxLength(2000)
  description?: string;

  @Field(() => VoteWeighting, { nullable: true })
  @IsOptional()
  @IsEnum(VoteWeighting)
  weighting?: VoteWeighting;

  @Field(() => VoteSecrecy, { nullable: true })
  @IsOptional()
  @IsEnum(VoteSecrecy)
  secrecy?: VoteSecrecy;

  @Field(() => [String], { nullable: true })
  @IsOptional()
  @IsArray()
  @ArrayMinSize(2)
  @ArrayMaxSize(10)
  @IsString({ each: true })
  @MaxLength(200, { each: true })
  options?: string[];
}
