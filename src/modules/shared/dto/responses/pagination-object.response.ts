import { ObjectType, Field, Int } from "@nestjs/graphql";

@ObjectType()
export class PaginationReponse {

    @Field(() => Int)
    currentPage: number;

    @Field(() => Int)
    itemsPerPage: number;

    @Field(() => Int)
    totalItems: number;

    @Field(() => Int)
    totalPages: number;

    @Field()
    hasNextPage: boolean;

    @Field()
    hasPreviousPage: boolean;
}