import { ObjectType, Field } from "@nestjs/graphql";

@ObjectType()
export class AssignedChildResult {

  @Field(() => String, { description: 'ID of the child role' })
  childId: string;

  @Field(() => String, { description: 'Name of the child role' })
  childName: string;

  @Field(() => Boolean, { description: 'Whether the assignment was successful' })
  success: boolean;

  @Field(() => String, { description: 'Error message if assignment failed', nullable: true })
  error?: string;
}