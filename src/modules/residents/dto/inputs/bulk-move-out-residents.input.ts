import { InputType, Field } from '@nestjs/graphql';
import { IsUUID, ArrayMinSize, ArrayNotEmpty, IsDateString, MaxLength } from 'class-validator';

@InputType()
export class BulkMoveOutResidentsInput {

  @Field(() => [String])
  @ArrayNotEmpty()
  @ArrayMinSize(1)
  @IsUUID('all', { each: true })
  residentIds: string[];

  @Field(() => String)
  @IsDateString()
  moveOutDate: string;

  @Field(() => String)
  @MaxLength(500)
  moveOutReason: string;

}
