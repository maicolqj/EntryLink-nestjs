import {
  Args,
  Int,
  Mutation,
  Parent,
  Query,
  ResolveField,
  Resolver,
} from '@nestjs/graphql';

import { SecurityPost } from '../entities/security-post.entity';
import { SecurityPostsService } from '../services/security-posts.service';
import {
  CreateSecurityPostInput,
  UpdateSecurityPostInput,
} from '../dto/security-post.inputs';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

const MANAGERS = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL];

@Resolver(() => SecurityPost)
export class SecurityPostsResolver {
  constructor(private readonly posts: SecurityPostsService) {}

  @Query(() => [SecurityPost], {
    name: 'securityPosts',
    description:
      'Porterías del conjunto. Vacío = una sola portería, no hay que elegir',
  })
  @Auth({
    roles: [
      ...MANAGERS,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.COMPILANCE_OFFICER_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.RESIDENT_ROL,
    ],
  })
  securityPosts(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SecurityPost[]> {
    return this.posts.list(complexId, currentUser);
  }

  @Query(() => SecurityPost, {
    name: 'mySecurityPost',
    nullable: true,
    description: 'Portería en la que está el vigilante',
  })
  @Auth({ roles: [ValidRoles.SECURITY_ROL] })
  mySecurityPost(
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SecurityPost | null> {
    return this.posts.myPost(currentUser);
  }

  @Mutation(() => SecurityPost, {
    name: 'selectSecurityPost',
    nullable: true,
    description:
      'El vigilante dice en qué portería está (null = en ninguna). Solo le llega lo de esa portería',
  })
  @Auth({ roles: [ValidRoles.SECURITY_ROL] })
  selectSecurityPost(
    @Args('securityPostId', { type: () => String, nullable: true })
    securityPostId: string | null,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SecurityPost | null> {
    return this.posts.select(securityPostId ?? null, currentUser);
  }

  @Mutation(() => SecurityPost, { name: 'createSecurityPost' })
  @Auth({ roles: MANAGERS })
  create(
    @Args('input') input: CreateSecurityPostInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SecurityPost> {
    return this.posts.create(input, currentUser);
  }

  @Mutation(() => SecurityPost, { name: 'updateSecurityPost' })
  @Auth({ roles: MANAGERS })
  update(
    @Args('input') input: UpdateSecurityPostInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<SecurityPost> {
    return this.posts.update(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'removeSecurityPost' })
  @Auth({ roles: MANAGERS })
  remove(
    @Args('id') id: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.posts.remove(id, currentUser);
  }

  @ResolveField('guardsOnDuty', () => Int, {
    description: 'Vigilantes que dijeron estar en esta portería',
  })
  guardsOnDuty(@Parent() post: SecurityPost): Promise<number> {
    return this.posts.countGuards(post.id);
  }

  @ResolveField('guardsWithApp', () => Int, {
    description:
      'De ellos, cuántos pueden recibir llamadas por internet (tienen la app)',
  })
  guardsWithApp(@Parent() post: SecurityPost): Promise<number> {
    return this.posts.countGuardsWithApp(post.id);
  }
}
