import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AgentAccount,
  AgentEvent,
  Challenge,
  CreateAgentInput,
  CreateChallengeInput,
  GameLeaderboardEntry,
  GameLobbySnapshot,
  GameMoveOption,
  GameParticipantRef,
  GameRoomSummary,
  GameStateSnapshot,
  GameSummary,
  JoinChallengeInput,
  Match,
  MatchPhase,
  Move,
  Round,
  SpectatorEvent,
  TrashTalkMessage
} from '../../types.js';
import type { PersistedGameModuleState } from '../../game.js';

export const TRASH_TALK_TURNS_PER_AGENT = 3;
export const TOTAL_TRASH_TALK_TURNS = TRASH_TALK_TURNS_PER_AGENT * 2;
export const MAX_CONSECUTIVE_DRAW_ROUNDS = 5;
export const FINISHED_MATCH_REPLAY_WINDOW_MS = 60 * 60 * 1000;

type DuelGameConfig = {
  id: string;
  name: string;
  description: string;
  moveOptions: GameMoveOption[];
  roomTitleSuffix?: string;
};

function now() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

export function commitmentFor(move: Move, nonce: string) {
  return crypto.createHash('sha256').update(`${move}:${nonce}`).digest('hex');
}

function clone<T>(value: T): T {
  return JSON.parse(JSON.stringify(value)) as T;
}

export class CommitRevealDuelGameModule extends EventEmitter {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  private readonly moveOptions: GameMoveOption[];
  private readonly moveOptionIds: Set<string>;
  private readonly roomTitleSuffix: string;

  private agents = new Map<string, AgentAccount>();
  private challenges = new Map<string, Challenge>();
  private matches = new Map<string, Match>();
  private spectatorEvents = new Map<string, SpectatorEvent[]>();
  private agentQueues = new Map<string, AgentEvent[]>();

  constructor(config: DuelGameConfig) {
    super();
    this.id = config.id;
    this.name = config.name;
    this.description = config.description;
    this.moveOptions = config.moveOptions.map((option) => ({ ...option, beats: [...option.beats] }));
    this.moveOptionIds = new Set(this.moveOptions.map((option) => option.id));
    this.roomTitleSuffix = config.roomTitleSuffix ?? '公开房间';
  }

  createAgent(input: CreateAgentInput) {
    const handle = input.handle.trim();
    const displayName = input.displayName.trim();
    if (!handle) {
      throw new Error('Agent handle is required');
    }
    if (!displayName) {
      throw new Error('Agent displayName is required');
    }

    const agent: AgentAccount = {
      id: createId('agentacct'),
      handle,
      displayName,
      bio: input.bio?.trim() ?? '',
      accessMode: 'manual',
      registrationSource: 'web',
      status: 'online',
      lifecycleState: 'active',
      createdAt: now()
    };

    return this.registerAgent(agent);
  }

  registerAgent(agent: AgentAccount) {
    const alreadyKnown = this.agents.has(agent.id) || this.agentQueues.has(agent.id);
    this.agents.set(agent.id, agent);
    if (!this.agentQueues.has(agent.id)) {
      this.agentQueues.set(agent.id, []);
    }

    if (!alreadyKnown) {
      for (const challenge of this.challenges.values()) {
        const challenger = this.challengeParticipant(challenge);
        if (challenge.status !== 'open' || (challenger.kind === 'agent' && challenger.id === agent.id)) {
          continue;
        }

        this.pushAgentEvent(agent.id, {
          type: 'challenge_received',
          payload: {
            challengeId: challenge.id,
            challengerAgentId: challenger.kind === 'agent' ? challenger.id : undefined,
            challenger,
            roundsToWin: challenge.roundsToWin
          }
        });
      }
    }

    return agent;
  }

  listAgents() {
    return [...this.agents.values()];
  }

  getAgent(agentId: string) {
    return this.agents.get(agentId);
  }

  createChallenge(input: CreateChallengeInput) {
    const challenger = this.resolveParticipant(input.challenger, input.challengerAgentId, 'challenger');
    const challenge: Challenge = {
      id: createId('challenge'),
      challengerAgentId: challenger.kind === 'agent' ? challenger.id : undefined,
      challenger,
      readyParticipantIds: [],
      roundsToWin: input.roundsToWin ?? 2,
      createdAt: now(),
      status: 'open'
    };

    this.challenges.set(challenge.id, challenge);

    for (const otherAgent of this.agents.values()) {
      if (challenger.kind === 'agent' && otherAgent.id === challenger.id) {
        continue;
      }

      this.pushAgentEvent(otherAgent.id, {
        type: 'challenge_received',
        payload: {
          challengeId: challenge.id,
          challengerAgentId: challenger.kind === 'agent' ? challenger.id : undefined,
          challenger,
          roundsToWin: challenge.roundsToWin
        }
      });
    }

    this.markStateChanged();
    return challenge;
  }

  listChallenges() {
    this.pruneExpiredFinishedMatches();
    return [...this.challenges.values()];
  }

  joinChallenge(challengeId: string, input: JoinChallengeInput & { autoStart: false }): Challenge;
  joinChallenge(challengeId: string, input: JoinChallengeInput): Match;
  joinChallenge(challengeId: string, input: JoinChallengeInput): Challenge | Match {
    const challenge = this.requireChallenge(challengeId);
    const challenger = this.challengeParticipant(challenge);
    const challenged = this.resolveParticipant(input.challenged, input.challengedAgentId, 'challenged');

    if (challenge.status !== 'open') {
      throw new Error('Challenge is no longer open');
    }

    if (challenger.kind === challenged.kind && challenger.id === challenged.id) {
      throw new Error('Participant cannot join their own challenge');
    }

    if (challenge.challenged && challenge.challenged.id !== challenged.id) {
      throw new Error('Challenge already has a second participant');
    }

    const shouldAutoStart = input.autoStart !== false && challenger.kind === 'agent' && challenged.kind === 'agent';
    if (!shouldAutoStart) {
      challenge.challenged = challenged;
      challenge.readyParticipantIds = (challenge.readyParticipantIds ?? []).filter((participantId) =>
        [challenger.id, challenged.id].includes(participantId)
      );
      this.markStateChanged();
      return challenge;
    }

    challenge.challenged = challenged;
    return this.startChallengeMatch(challenge);
  }

  readyChallenge(challengeId: string, participant: GameParticipantRef) {
    const challenge = this.requireChallenge(challengeId);
    const participants = this.challengeParticipants(challenge);

    if (challenge.status !== 'open') {
      throw new Error('Challenge is no longer open');
    }

    if (!participants.some((candidate) => candidate.kind === participant.kind && candidate.id === participant.id)) {
      throw new Error('Participant is not part of the challenge');
    }

    const ready = new Set(challenge.readyParticipantIds ?? []);
    ready.add(participant.id);
    challenge.readyParticipantIds = [...ready];

    if (participants.length === 2 && participants.every((candidate) => ready.has(candidate.id))) {
      return this.startChallengeMatch(challenge);
    }

    this.markStateChanged();
    return challenge;
  }

  leaveChallenge(challengeId: string, participant: GameParticipantRef) {
    const challenge = this.requireChallenge(challengeId);
    const challenger = this.challengeParticipant(challenge);

    if (challenge.status !== 'open') {
      throw new Error('Challenge is no longer open');
    }

    if (challenger.kind === participant.kind && challenger.id === participant.id) {
      this.challenges.delete(challenge.id);
      this.markStateChanged();
      return null;
    }

    if (challenge.challenged?.kind === participant.kind && challenge.challenged.id === participant.id) {
      challenge.challenged = undefined;
      challenge.readyParticipantIds = (challenge.readyParticipantIds ?? []).filter((participantId) => participantId !== participant.id);
      this.markStateChanged();
      return challenge;
    }

    throw new Error('Participant is not part of the challenge');
  }

  private startChallengeMatch(challenge: Challenge) {
    const [challenger, challenged] = this.challengeParticipants(challenge);
    if (!challenged) {
      throw new Error('Challenge needs two participants before starting');
    }

    challenge.status = 'matched';

    const createdAt = now();
    const firstRound: Round = {
      number: 1,
      phase: 'trash_talk_round_open',
      startedAt: createdAt,
      trashTalk: [],
      commits: {},
      reveals: {},
      winnerAgentId: null
    };

    const matchId = createId('match');
    const match: Match = {
      id: matchId,
      challengeId: challenge.id,
      agentIds: [challenger.id, challenged.id],
      participants: [challenger, challenged],
      roundsToWin: challenge.roundsToWin,
      status: 'active',
      phase: 'trash_talk_round_open',
      currentRound: 1,
      rounds: [firstRound],
      scoreboard: {
        [challenger.id]: 0,
        [challenged.id]: 0
      },
      createdAt,
      updatedAt: createdAt
    };

    challenge.matchId = matchId;
    this.matches.set(match.id, match);
    this.spectatorEvents.set(match.id, []);

    this.broadcastSpectator(match.id, 'match_started', {
      matchId: match.id,
      challengeId: challenge.id,
      agentIds: match.agentIds,
      participants: match.participants,
      gameId: this.id
    });
    this.broadcastSpectator(match.id, 'phase_changed', {
      phase: match.phase,
      roundNumber: match.currentRound
    });

    for (const agentId of this.agentParticipantIds(match)) {
      const matchParticipants = this.matchParticipants(match);
      this.pushAgentEvent(agentId, {
        type: 'match_started',
        payload: {
          matchId: match.id,
          challengeId: challenge.id,
          opponentAgentId: matchParticipants.find((value) => value.id !== agentId && value.kind === 'agent')?.id,
          opponent: matchParticipants.find((value) => value.id !== agentId),
          gameId: this.id
        }
      });
      this.pushAgentEvent(agentId, {
        type: 'phase_changed',
        payload: {
          matchId: match.id,
          phase: match.phase,
          roundNumber: match.currentRound
        }
      });
    }

    this.markStateChanged();
    return match;
  }

  listMatches() {
    this.pruneExpiredFinishedMatches();
    return [...this.matches.values()];
  }

  getMatch(matchId: string) {
    this.pruneExpiredFinishedMatches();
    return this.matches.get(matchId);
  }

  submitTrashTalk(matchId: string, agentId: string, text: string) {
    const match = this.requireMatch(matchId);
    const round = this.currentRound(match);

    if (match.phase !== 'trash_talk_round_open') {
      throw new Error('Trash talk is closed');
    }

    if (!this.matchParticipantIds(match).includes(agentId)) {
      throw new Error('Participant is not part of the match');
    }

    if (round.trashTalk.length >= TOTAL_TRASH_TALK_TURNS) {
      throw new Error('Trash talk quota reached');
    }

    const participantIds = this.matchParticipantIds(match);
    const expectedAgentId = participantIds[round.trashTalk.length % participantIds.length];
    if (agentId !== expectedAgentId) {
      throw new Error(`It is not ${agentId}'s turn to speak`);
    }

    const message: TrashTalkMessage = {
      id: createId('trash'),
      matchId,
      roundNumber: round.number,
      agentId,
      text,
      createdAt: now()
    };

    round.trashTalk.push(message);
    match.updatedAt = message.createdAt;

    this.broadcastSpectator(match.id, 'trash_talk_sent', {
      roundNumber: round.number,
      agentId,
      participant: this.participantForId(match, agentId),
      text,
      createdAt: message.createdAt
    });

    const opponentAgentId = this.agentParticipantIds(match).find((value) => value !== agentId);
    if (opponentAgentId) {
      this.pushAgentEvent(opponentAgentId, {
        type: 'opponent_trash_talk',
        payload: {
          matchId: match.id,
          roundNumber: round.number,
          agentId,
          text
        }
      });
    }

    if (round.trashTalk.length === TOTAL_TRASH_TALK_TURNS) {
      this.advancePhase(match, 'move_commit_open');
    } else {
      this.markStateChanged();
    }

    return message;
  }

  submitCommit(matchId: string, agentId: string, commitment: string) {
    const match = this.requireMatch(matchId);
    const round = this.currentRound(match);

    if (match.phase !== 'move_commit_open') {
      throw new Error('Move commitment is closed');
    }

    if (!this.matchParticipantIds(match).includes(agentId)) {
      throw new Error('Participant is not part of the match');
    }

    if (round.commits[agentId]) {
      throw new Error('Commitment already submitted');
    }

    round.commits[agentId] = {
      agentId,
      commitment,
      submittedAt: now()
    };

    this.broadcastSpectator(match.id, 'move_committed', {
      roundNumber: round.number,
      agentId,
      participant: this.participantForId(match, agentId),
      submittedAgents: Object.keys(round.commits)
    });

    if (Object.keys(round.commits).length === this.matchParticipantIds(match).length) {
      this.advancePhase(match, 'move_reveal');
    } else {
      this.markStateChanged();
    }

    return round.commits[agentId];
  }

  submitReveal(matchId: string, agentId: string, move: Move, nonce: string) {
    const match = this.requireMatch(matchId);
    const round = this.currentRound(match);

    if (!this.moveOptionIds.has(move)) {
      throw new Error(`Unsupported move for ${this.id}: ${move}`);
    }

    if (match.phase !== 'move_reveal') {
      throw new Error('Move reveal is closed');
    }

    if (!this.matchParticipantIds(match).includes(agentId)) {
      throw new Error('Participant is not part of the match');
    }

    const commit = round.commits[agentId];
    if (!commit) {
      throw new Error('Commitment missing');
    }

    if (round.reveals[agentId]) {
      throw new Error('Reveal already submitted');
    }

    const derivedCommitment = commitmentFor(move, nonce);
    if (commit.commitment !== derivedCommitment) {
      throw new Error('Reveal does not match commitment');
    }

    round.reveals[agentId] = {
      agentId,
      move,
      nonce,
      submittedAt: now()
    };

    this.broadcastSpectator(match.id, 'move_revealed', {
      roundNumber: round.number,
      agentId,
      participant: this.participantForId(match, agentId),
      move
    });

    if (Object.keys(round.reveals).length === this.matchParticipantIds(match).length) {
      this.scoreRound(match);
    } else {
      this.markStateChanged();
    }

    return round.reveals[agentId];
  }

  listSpectatorEvents(matchId: string, afterSeq = 0) {
    this.pruneExpiredFinishedMatches();
    return (this.spectatorEvents.get(matchId) ?? []).filter((event) => event.seq > afterSeq);
  }

  pollAgentEvents(agentId: string) {
    this.requireAgent(agentId);
    return [...(this.agentQueues.get(agentId) ?? [])];
  }

  acknowledgeAgentEvents(agentId: string, eventIds: string[]) {
    const queue = this.agentQueues.get(agentId) ?? [];
    this.agentQueues.set(
      agentId,
      queue.filter((item) => !eventIds.includes(item.id))
    );
    this.markStateChanged();
  }

  exportState(): PersistedGameModuleState {
    this.pruneExpiredFinishedMatches(false);
    return {
      challenges: clone([...this.challenges.values()]),
      matches: clone([...this.matches.values()]),
      spectatorEvents: [...this.spectatorEvents.entries()].map(([matchId, events]) => [matchId, clone(events)]),
      agentQueues: [...this.agentQueues.entries()].map(([agentId, events]) => [agentId, clone(events)])
    };
  }

  restoreState(state: PersistedGameModuleState | null | undefined) {
    this.challenges = new Map((state?.challenges ?? []).map((challenge) => [challenge.id, clone(challenge)]));
    this.matches = new Map((state?.matches ?? []).map((match) => [match.id, clone(match)]));
    this.spectatorEvents = new Map(
      (state?.spectatorEvents ?? []).map(([matchId, events]) => [matchId, clone(events)])
    );
    this.agentQueues = new Map(
      (state?.agentQueues ?? []).map(([agentId, events]) => [agentId, clone(events)])
    );
  }

  stateSnapshot(): GameStateSnapshot {
    return {
      game: this.summary(),
      agents: this.listAgents(),
      challenges: this.listChallenges(),
      matches: this.listMatches()
    };
  }

  summary(): GameSummary {
    const matches = this.listMatches();
    return {
      id: this.id,
      name: this.name,
      description: this.description,
      status: 'live',
      moveOptions: this.moveOptions.map((option) => ({ ...option, beats: [...option.beats] })),
      availableAgentCount: this.listAgents().filter((agent) => agent.status === 'online').length,
      waitingRoomCount: this.listChallenges().filter((challenge) => challenge.status === 'open').length,
      activeMatchCount: matches.filter((match) => match.status === 'active').length,
      finishedMatchCount: matches.filter((match) => match.status === 'finished').length
    };
  }

  lobbySnapshot(): GameLobbySnapshot {
    const rooms: GameRoomSummary[] = [
      ...this.listChallenges()
        .filter((challenge) => challenge.status === 'open')
        .map((challenge) => {
          const occupants = this.challengeParticipants(challenge);
          const readyCount = new Set(challenge.readyParticipantIds ?? []).size;
          return {
            id: challenge.id,
            kind: 'challenge' as const,
            status: 'waiting' as const,
            gameId: this.id,
            title: `${this.challengeParticipant(challenge).displayName} 的${this.roomTitleSuffix}`,
            roundLabel: occupants.length === 2 ? `${readyCount}/2 已准备` : `先赢 ${challenge.roundsToWin} 回合`,
            occupantAgentIds: occupants.map((participant) => participant.id),
            occupants,
            spectatorMatchId: challenge.matchId,
            actionLabel: occupants.length >= 2 ? 'enter' as const : 'join' as const
          };
        }),
      ...this.listMatches().map((match) => ({
        id: match.id,
        kind: 'match' as const,
        status: match.status === 'finished' ? 'finished' as const : 'active' as const,
        gameId: this.id,
        title: this.matchParticipants(match).map((participant) => participant.displayName).join(' vs '),
        roundLabel: `${match.phase} · round ${match.currentRound}`,
        occupantAgentIds: [...this.matchParticipantIds(match)],
        occupants: this.matchParticipants(match),
        spectatorMatchId: match.id,
        actionLabel: match.status === 'finished' ? 'replay' as const : 'spectate' as const
      }))
    ];

    const wins = new Map<string, number>();
    const played = new Map<string, number>();
    const humansById = new Map<string, GameParticipantRef>();
    for (const match of this.listMatches()) {
      for (const participant of this.matchParticipants(match)) {
        played.set(participant.id, (played.get(participant.id) ?? 0) + 1);
        if (participant.kind === 'human') {
          humansById.set(participant.id, participant);
        }
      }

      if (match.winnerAgentId) {
        wins.set(match.winnerAgentId, (wins.get(match.winnerAgentId) ?? 0) + 1);
      }
    }

    const leaderboard: GameLeaderboardEntry[] = this.listAgents()
      .map((agent) => this.participantFromAgent(agent))
      .concat([...humansById.values()])
      .map((participant) => {
        const matchCount = played.get(participant.id) ?? 0;
        const winCount = wins.get(participant.id) ?? 0;
        return {
          agentId: participant.id,
          displayName: participant.displayName,
          wins: winCount,
          matches: matchCount,
          score: winCount * 3 + matchCount
        };
      })
      .sort((left, right) => right.score - left.score || right.wins - left.wins || left.displayName.localeCompare(right.displayName));

    return {
      game: this.summary(),
      rooms,
      leaderboard
    };
  }

  private scoreRound(match: Match) {
    const round = this.currentRound(match);
    const [leftId, rightId] = this.matchParticipantIds(match);
    const leftReveal = round.reveals[leftId];
    const rightReveal = round.reveals[rightId];

    if (!leftReveal || !rightReveal) {
      return;
    }

    const outcome = this.decideRoundWinner(leftReveal.move, rightReveal.move);
    round.phase = 'round_result';
    match.phase = 'round_result';

    if (outcome === 1) {
      round.winnerAgentId = leftId;
      match.scoreboard[leftId] += 1;
    } else if (outcome === -1) {
      round.winnerAgentId = rightId;
      match.scoreboard[rightId] += 1;
    } else {
      round.winnerAgentId = null;
    }

    match.updatedAt = now();

    this.broadcastSpectator(match.id, 'round_scored', {
      roundNumber: round.number,
      scoreboard: { ...match.scoreboard },
      winnerAgentId: round.winnerAgentId,
      winner: round.winnerAgentId ? this.participantForId(match, round.winnerAgentId) : null,
      reveals: {
        [leftId]: leftReveal.move,
        [rightId]: rightReveal.move
      }
    });

    for (const agentId of this.agentParticipantIds(match)) {
      this.pushAgentEvent(agentId, {
        type: 'round_result',
        payload: {
          matchId: match.id,
          roundNumber: round.number,
          winnerAgentId: round.winnerAgentId,
          scoreboard: { ...match.scoreboard }
        }
      });
    }

    const matchWinner = this.matchParticipantIds(match).find((agentId) => match.scoreboard[agentId] >= match.roundsToWin);
    if (matchWinner) {
      match.status = 'finished';
      match.phase = 'match_finished';
      match.winnerAgentId = matchWinner;
      this.broadcastSpectator(match.id, 'match_finished', {
        matchId: match.id,
        winnerAgentId: matchWinner,
        winner: this.participantForId(match, matchWinner),
        scoreboard: { ...match.scoreboard }
      });
      for (const agentId of this.agentParticipantIds(match)) {
        this.pushAgentEvent(agentId, {
          type: 'match_finished',
          payload: {
            matchId: match.id,
            winnerAgentId: matchWinner,
            scoreboard: { ...match.scoreboard }
          }
        });
      }
      this.markStateChanged();
      return;
    }

    const consecutiveDraws = this.countTrailingDrawRounds(match);
    if (consecutiveDraws >= MAX_CONSECUTIVE_DRAW_ROUNDS) {
      match.status = 'finished';
      match.phase = 'match_finished';
      match.winnerAgentId = undefined;
      this.broadcastSpectator(match.id, 'match_finished', {
        matchId: match.id,
        winnerAgentId: null,
        winner: null,
        drawReason: 'max_consecutive_draws',
        consecutiveDraws,
        scoreboard: { ...match.scoreboard }
      });
      for (const agentId of this.agentParticipantIds(match)) {
        this.pushAgentEvent(agentId, {
          type: 'match_finished',
          payload: {
            matchId: match.id,
            winnerAgentId: null,
            drawReason: 'max_consecutive_draws',
            consecutiveDraws,
            scoreboard: { ...match.scoreboard }
          }
        });
      }
      this.markStateChanged();
      return;
    }

    const nextRound: Round = {
      number: round.number + 1,
      phase: 'trash_talk_round_open',
      startedAt: now(),
      trashTalk: [],
      commits: {},
      reveals: {},
      winnerAgentId: null
    };

    match.rounds.push(nextRound);
    match.currentRound = nextRound.number;
    this.advancePhase(match, 'trash_talk_round_open');
  }

  private countTrailingDrawRounds(match: Match) {
    let count = 0;
    for (let index = match.rounds.length - 1; index >= 0; index -= 1) {
      const round = match.rounds[index];
      if (round.phase !== 'round_result' || round.winnerAgentId !== null) {
        break;
      }
      count += 1;
    }
    return count;
  }

  private advancePhase(match: Match, phase: MatchPhase) {
    const round = this.currentRound(match);
    round.phase = phase;
    match.phase = phase;
    match.updatedAt = now();

    this.broadcastSpectator(match.id, 'phase_changed', {
      phase,
      roundNumber: round.number
    });

    for (const agentId of this.agentParticipantIds(match)) {
      this.pushAgentEvent(agentId, {
        type: 'phase_changed',
        payload: {
          matchId: match.id,
          phase,
          roundNumber: round.number
        }
      });
    }

    this.markStateChanged();
  }

  private resolveParticipant(participant: GameParticipantRef | undefined, legacyAgentId: string | undefined, label: string) {
    if (participant) {
      const normalized: GameParticipantRef = {
        kind: participant.kind,
        id: participant.id.trim(),
        displayName: participant.displayName.trim(),
        handle: participant.handle.trim()
      };
      if (normalized.kind !== 'agent' && normalized.kind !== 'human') {
        throw new Error(`Unsupported ${label} participant kind`);
      }
      if (!normalized.id || !normalized.displayName || !normalized.handle) {
        throw new Error(`${label} participant id, displayName, and handle are required`);
      }
      if (normalized.kind === 'agent') {
        const agent = this.requireAgent(normalized.id);
        return this.participantFromAgent(agent);
      }
      return normalized;
    }

    if (!legacyAgentId) {
      throw new Error(`${label} participant is required`);
    }

    return this.participantFromAgent(this.requireAgent(legacyAgentId));
  }

  private participantFromAgent(agent: AgentAccount): GameParticipantRef {
    return {
      kind: 'agent',
      id: agent.id,
      displayName: agent.displayName,
      handle: agent.handle
    };
  }

  private fallbackParticipant(id: string): GameParticipantRef {
    const agent = this.agents.get(id);
    if (agent) {
      return this.participantFromAgent(agent);
    }
    return {
      kind: 'agent',
      id,
      displayName: id,
      handle: id
    };
  }

  private challengeParticipant(challenge: Challenge): GameParticipantRef {
    return challenge.challenger ?? this.fallbackParticipant(challenge.challengerAgentId ?? '');
  }

  private challengeParticipants(challenge: Challenge): GameParticipantRef[] {
    return [this.challengeParticipant(challenge), challenge.challenged].filter(Boolean) as GameParticipantRef[];
  }

  private matchParticipants(match: Match): [GameParticipantRef, GameParticipantRef] {
    if (match.participants?.length === 2) {
      return [match.participants[0], match.participants[1]];
    }
    return [this.fallbackParticipant(match.agentIds[0]), this.fallbackParticipant(match.agentIds[1])];
  }

  private matchParticipantIds(match: Match) {
    return this.matchParticipants(match).map((participant) => participant.id);
  }

  private participantForId(match: Match, participantId: string) {
    return this.matchParticipants(match).find((participant) => participant.id === participantId) ?? this.fallbackParticipant(participantId);
  }

  private agentParticipantIds(match: Match) {
    return this.matchParticipants(match)
      .filter((participant) => participant.kind === 'agent' && this.agents.has(participant.id))
      .map((participant) => participant.id);
  }

  private currentRound(match: Match) {
    return match.rounds[match.rounds.length - 1];
  }

  private broadcastSpectator(matchId: string, type: SpectatorEvent['type'], payload: Record<string, unknown>) {
    const feed = this.spectatorEvents.get(matchId);
    if (!feed) {
      return;
    }

    const event: SpectatorEvent = {
      seq: feed.length + 1,
      matchId,
      type,
      createdAt: now(),
      payload
    };

    feed.push(event);
    this.emit('spectator-event', event);
  }

  private pushAgentEvent(agentId: string, event: Omit<AgentEvent, 'agentId' | 'createdAt' | 'id'>) {
    const queue = this.agentQueues.get(agentId);
    if (!queue) {
      return;
    }

    const nextEvent: AgentEvent = {
      id: createId('aevt'),
      agentId,
      createdAt: now(),
      ...event
    };
    queue.push(nextEvent);
    this.emit('agent-event', nextEvent);
    this.markStateChanged();
  }

  private decideRoundWinner(left: Move, right: Move) {
    if (left === right) {
      return 0;
    }

    const leftOption = this.moveOptions.find((option) => option.id === left);
    if (!leftOption) {
      throw new Error(`Unknown move: ${left}`);
    }

    return leftOption.beats.includes(right) ? 1 : -1;
  }

  private markStateChanged() {
    this.emit('state-changed');
  }

  private pruneExpiredFinishedMatches(emitStateChange = true) {
    const nowMs = Date.now();
    let removedAny = false;

    for (const match of this.matches.values()) {
      if (match.status !== 'finished') {
        continue;
      }

      const finishedAt = Date.parse(match.updatedAt);
      if (!Number.isFinite(finishedAt) || nowMs - finishedAt < FINISHED_MATCH_REPLAY_WINDOW_MS) {
        continue;
      }

      this.matches.delete(match.id);
      this.spectatorEvents.delete(match.id);
      this.challenges.delete(match.challengeId);
      removedAny = true;
    }

    if (removedAny && emitStateChange) {
      this.markStateChanged();
    }
  }

  private requireAgent(agentId: string) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return agent;
  }

  private requireChallenge(challengeId: string) {
    this.pruneExpiredFinishedMatches();
    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      throw new Error(`Unknown challenge: ${challengeId}`);
    }
    return challenge;
  }

  private requireMatch(matchId: string) {
    this.pruneExpiredFinishedMatches();
    const match = this.matches.get(matchId);
    if (!match) {
      throw new Error(`Unknown match: ${matchId}`);
    }
    return match;
  }
}
