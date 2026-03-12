import { ObjectType, Field } from "@nestjs/graphql";
import { Role } from "../../entities/role.entity";
import { PaginationReponse } from "../../../shared/dto/responses/pagination-object.response";

@ObjectType()
export class PaginatedRolesResponse {

    @Field(() => [Role])
    items: Role[];

    @Field(() => PaginationReponse)
    meta: PaginationReponse;
}