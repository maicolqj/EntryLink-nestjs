import { ObjectType, Field, Int } from '@nestjs/graphql';
import { User } from '../../entities/user.entity';

@ObjectType()
export class UsersListResponse {
  @Field(() => [User])
  items: User[];

  @Field(() => Int)
  total: number;

  @Field(() => Int)
  limit: number;

  @Field(() => Int)
  offset: number;
}
