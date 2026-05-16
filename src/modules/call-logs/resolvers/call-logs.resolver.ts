import { Resolver, Query, Mutation, Args } from '@nestjs/graphql';

import { CallLog }          from '../entities/call-log.entity';
import { CallLogsService }  from '../services/call-logs.service';
import { LogCallInput }     from '../dto/inputs/log-call.input';
import { CallLogsInput }    from '../dto/inputs/call-logs.input';
import { CallLogsPage }     from '../dto/responses/call-logs-page.response';

import { Auth }             from '../../shared/decorators/auth.decorator';
import { CurrentUser }      from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles }       from '../../roles/enums/valid-roles';
import { ValidPermissions } from '../../permissions/enums/valid-permissions';

@Resolver(() => CallLog)
export class CallLogsResolver {

  constructor(private readonly callLogsService: CallLogsService) {}

  // ================================================================
  // MUTATIONS
  // ================================================================

  @Mutation(() => CallLog, { name: 'logCall' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SECURITY_ROL,
      ValidRoles.SUPERVISOR_ROL,
    ],
    permissions: [ValidPermissions.LOG_CALL],
  })
  logCall(
    @Args('input') input: LogCallInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<CallLog> {
    return this.callLogsService.logCall(input, currentUser);
  }

  // ================================================================
  // QUERIES
  // ================================================================

  @Query(() => CallLogsPage, { name: 'callLogs' })
  @Auth({
    roles: [
      ValidRoles.SUPER_ADMIN_ROL,
      ValidRoles.COMPLEX_ROL,
      ValidRoles.SUPERVISOR_ROL,
      ValidRoles.SECURITY_ROL,
    ],
    permissions: [ValidPermissions.VIEW_CALL_LOGS],
  })
  callLogs(
    @Args('input') input: CallLogsInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<CallLogsPage> {
    return this.callLogsService.getCallLogs(input, currentUser);
  }
}
