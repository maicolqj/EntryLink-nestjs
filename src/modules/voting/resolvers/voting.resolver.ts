import {
  Resolver,
  Query,
  Mutation,
  Args,
  ResolveField,
  Parent,
} from '@nestjs/graphql';

import { VotingMeeting } from '../entities/voting-meeting.entity';
import { VotingQuestion } from '../entities/voting-question.entity';
import { VotingService } from '../services/voting.service';
import { VotingAudience } from '../enums/voting.enums';
import { VotingSettingsResponse } from '../dto/responses/voting-settings.response';
import {
  CreateVotingMeetingInput,
  CreateVotingQuestionInput,
  UpdateVotingQuestionInput,
} from '../dto/inputs/voting.inputs';
import { VotingResults } from '../dto/responses/voting-results.response';
import { VotingCouncilMember } from '../dto/responses/voting-council-member.response';

import { Auth } from '../../shared/decorators/auth.decorator';
import { CurrentUser } from '../../shared/decorators/current-user.decorator';
import { JwtAccessPayload } from '../../shared/interfaces/jwt-payload.interface';
import { ValidRoles } from '../../roles/enums/valid-roles';

import { RequireModule } from '../../shared/decorators/require-module.decorator';
import { ComplexModule } from '../../residential-complex/enums/complex-module.enum';
/**
 * La autorización va por ROL y no por permiso a propósito: los permisos viajan
 * en el JWT que se emitió al iniciar sesión, y un permiso nuevo no le llegaría
 * a nadie hasta que vuelva a entrar —justo el día de la asamblea—. El corte
 * fino (quién ve qué reunión, quién puede votar) lo hace el servicio.
 */
const ADMIN = [ValidRoles.SUPER_ADMIN_ROL, ValidRoles.COMPLEX_ROL];
const VOTERS = [ValidRoles.RESIDENT_ROL, ValidRoles.COUNCIL_ROL];

@RequireModule(ComplexModule.VOTACIONES)
@Resolver(() => VotingMeeting)
export class VotingResolver {
  constructor(private readonly votingService: VotingService) {}

  // ─── Interruptor ──────────────────────────────────────────────────────────

  /** La app lo consulta para mostrar —o no— el menú de votaciones. */
  @Query(() => Boolean, { name: 'votingEnabled' })
  @Auth({ roles: [...ADMIN, ...VOTERS] })
  isEnabled(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.votingService.isEnabled(complexId, currentUser);
  }

  /** Módulo e interruptores del complejo, para la pantalla de la administración. */
  @Query(() => VotingSettingsResponse, { name: 'votingSettings' })
  @Auth({ roles: ADMIN })
  getSettings(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingSettingsResponse> {
    return this.votingService.getSettings(complexId, currentUser);
  }

  /** Asambleas para los residentes o reuniones del consejo para el consejo. */
  @Mutation(() => Boolean, { name: 'setVotingEnabled' })
  @Auth({ roles: ADMIN })
  setEnabled(
    @Args('complexId') complexId: string,
    @Args('audience', { type: () => VotingAudience }) audience: VotingAudience,
    @Args('enabled') enabled: boolean,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.votingService.setEnabled(
      complexId,
      audience,
      enabled,
      currentUser,
    );
  }

  // ─── Consultas ────────────────────────────────────────────────────────────

  @Query(() => [VotingMeeting], {
    name: 'votingMeetings',
    description: 'Todas las reuniones (administración)',
  })
  @Auth({ roles: ADMIN })
  findMeetings(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingMeeting[]> {
    return this.votingService.findMeetings(complexId, currentUser);
  }

  @Query(() => [VotingMeeting], {
    name: 'myVotingMeetings',
    description: 'Lo que el residente puede votar o consultar',
  })
  @Auth({ roles: VOTERS })
  findMyMeetings(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingMeeting[]> {
    return this.votingService.findMyMeetings(complexId, currentUser);
  }

  @Query(() => VotingQuestion, { name: 'votingQuestion' })
  @Auth({ roles: [...ADMIN, ...VOTERS] })
  findQuestion(
    @Args('questionId') questionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingQuestion> {
    return this.votingService.findQuestion(questionId, currentUser);
  }

  // ─── Administración ───────────────────────────────────────────────────────

  @Mutation(() => VotingMeeting, { name: 'createVotingMeeting' })
  @Auth({ roles: ADMIN })
  createMeeting(
    @Args('input') input: CreateVotingMeetingInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingMeeting> {
    return this.votingService.createMeeting(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'deleteVotingMeeting' })
  @Auth({ roles: ADMIN })
  deleteMeeting(
    @Args('meetingId') meetingId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.votingService.deleteMeeting(meetingId, currentUser);
  }

  @Mutation(() => VotingQuestion, { name: 'createVotingQuestion' })
  @Auth({ roles: ADMIN })
  createQuestion(
    @Args('input') input: CreateVotingQuestionInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingQuestion> {
    return this.votingService.createQuestion(input, currentUser);
  }

  @Mutation(() => VotingQuestion, { name: 'updateVotingQuestion' })
  @Auth({ roles: ADMIN })
  updateQuestion(
    @Args('input') input: UpdateVotingQuestionInput,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingQuestion> {
    return this.votingService.updateQuestion(input, currentUser);
  }

  @Mutation(() => Boolean, { name: 'deleteVotingQuestion' })
  @Auth({ roles: ADMIN })
  deleteQuestion(
    @Args('questionId') questionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.votingService.deleteQuestion(questionId, currentUser);
  }

  @Mutation(() => VotingQuestion, { name: 'openVotingQuestion' })
  @Auth({ roles: ADMIN })
  openQuestion(
    @Args('questionId') questionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingQuestion> {
    return this.votingService.openQuestion(questionId, currentUser);
  }

  @Mutation(() => VotingQuestion, { name: 'closeVotingQuestion' })
  @Auth({ roles: ADMIN })
  closeQuestion(
    @Args('questionId') questionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingQuestion> {
    return this.votingService.closeQuestion(questionId, currentUser);
  }

  // ─── Consejo: voz y voto ──────────────────────────────────────────────────

  @Query(() => [VotingCouncilMember], {
    name: 'votingCouncilMembers',
    description: 'El consejo y quién tiene voto',
  })
  @Auth({ roles: ADMIN })
  findCouncilMembers(
    @Args('complexId') complexId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingCouncilMember[]> {
    return this.votingService.findCouncilMembers(complexId, currentUser);
  }

  /** Lista de quienes tienen voz pero NO voto. Vacía = todo el consejo vota. */
  @Mutation(() => [VotingCouncilMember], {
    name: 'updateVotingCouncilVoiceOnly',
  })
  @Auth({ roles: ADMIN })
  updateCouncilVoiceOnly(
    @Args('complexId') complexId: string,
    @Args('voiceOnlyUserIds', { type: () => [String] })
    voiceOnlyUserIds: string[],
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingCouncilMember[]> {
    return this.votingService.updateCouncilVoiceOnly(
      complexId,
      voiceOnlyUserIds,
      currentUser,
    );
  }

  // ─── Votar ────────────────────────────────────────────────────────────────

  @Mutation(() => VotingQuestion, {
    name: 'castVote',
    description: 'Un voto por unidad (asamblea) o por consejero',
  })
  @Auth({ roles: VOTERS })
  castVote(
    @Args('questionId') questionId: string,
    @Args('optionId') optionId: string,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingQuestion> {
    return this.votingService.castVote(questionId, optionId, currentUser);
  }
}

/** Campos que dependen de quién mira la pregunta. */
@Resolver(() => VotingQuestion)
export class VotingQuestionResolver {
  constructor(private readonly votingService: VotingService) {}

  @ResolveField(() => VotingResults, {
    nullable: true,
    description:
      'Resultados. El residente los ve al cerrarse; la administración, siempre',
  })
  results(
    @Parent() question: VotingQuestion,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<VotingResults | null> {
    return this.votingService.results(question, currentUser);
  }

  @ResolveField(() => String, {
    nullable: true,
    description: 'Opción que eligió quien consulta (o su unidad, en asamblea)',
  })
  async myVoteOptionId(
    @Parent() question: VotingQuestion,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<string | null> {
    return (await this.votingService.viewerBallot(question, currentUser))
      .optionId;
  }

  @ResolveField(() => Boolean, {
    description: 'Quien consulta es del consejo pero solo tiene voz',
  })
  viewerHasVoiceOnly(
    @Parent() question: VotingQuestion,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    return this.votingService.isVoiceOnly(question, currentUser);
  }

  @ResolveField(() => Boolean, {
    description: 'Quien consulta todavía puede votar',
  })
  async viewerCanVote(
    @Parent() question: VotingQuestion,
    @CurrentUser() currentUser: JwtAccessPayload,
  ): Promise<boolean> {
    if (question.status !== 'OPEN') return false;
    const ballot = await this.votingService.viewerBallot(question, currentUser);
    return ballot.eligible && !ballot.optionId;
  }
}
