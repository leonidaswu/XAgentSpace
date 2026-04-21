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
        if (challenge.status !== 'open' || challenge.challengerAgentId === agent.id) {
          continue;
        }

        this.pushAgentEvent(agent.id, {
          type: 'challenge_received',
          payload: {
            challengeId: challenge.id,
            challengerAgentId: challenge.challengerAgentId,
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
    const agent = this.requireAgent(input.challengerAgentId);
    const challenge: Challenge = {
      id: createId('challenge'),
      challengerAgentId: agent.id,
      roundsToWin: input.roundsToWin ?? 2,
      createdAt: now(),
      status: 'open'
    };

    this.challenges.set(challenge.id, challenge);

    for (const otherAgent of this.agents.values()) {
      if (otherAgent.id === challenge.challengerAgentId) {
        continue;
      }

      this.pushAgentEvent(otherAgent.id, {
        type: 'challenge_received',
        payload: {
          challengeId: challenge.id,
          challengerAgentId: challenge.challengerAgentId,
          roundsToWin: challenge.roundsToWin
        }
      });
    }

    this.markStateChanged();
    return challenge;
  }

  listChallenges() {
    return [...this.challenges.values()];
  }

  joinChallenge(challengeId: string, input: JoinChallengeInput) {
    const challenge = this.requireChallenge(challengeId);
    const challenged = this.requireAgent(input.challengedAgentId);

    if (challenge.status !== 'open') {
      throw new Error('Challenge is no longer open');
    }

    if (challenge.challengerAgentId === challenged.id) {
      throw new Error('Agent cannot join its own challenge');
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
      agentIds: [challenge.challengerAgentId, challenged.id],
      roundsToWin: challenge.roundsToWin,
      status: 'active',
      phase: 'trash_talk_round_open',
      currentRound: 1,
      rounds: [firstRound],
      scoreboard: {
        [challenge.challengerAgentId]: 0,
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
      gameId: this.id
    });
    this.broadcastSpectator(match.id, 'phase_changed', {
      phase: match.phase,
      roundNumber: match.currentRound
    });

    for (const agentId of match.agentIds) {
      this.pushAgentEvent(agentId, {
        type: 'match_started',
        payload: {
          matchId: match.id,
          challengeId: challenge.id,
          opponentAgentId: match.agentIds.find((value) => value !== agentId),
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
    return [...this.matches.values()];
  }

  getMatch(matchId: string) {
    return this.matches.get(matchId);
  }

  submitTrashTalk(matchId: string, agentId: string, text: string) {
    const match = this.requireMatch(matchId);
    const round = this.currentRound(match);

    if (match.phase !== 'trash_talk_round_open') {
      throw new Error('Trash talk is closed');
    }

    if (!match.agentIds.includes(agentId)) {
      throw new Error('Agent is not part of the match');
    }

    if (round.trashTalk.length >= TOTAL_TRASH_TALK_TURNS) {
      throw new Error('Trash talk quota reached');
    }

    const expectedAgentId = match.agentIds[round.trashTalk.length % match.agentIds.length];
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
      text,
      createdAt: message.createdAt
    });

    const opponentAgentId = match.agentIds.find((value) => value !== agentId);
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
      submittedAgents: Object.keys(round.commits)
    });

    if (Object.keys(round.commits).length === match.agentIds.length) {
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
      move
    });

    if (Object.keys(round.reveals).length === match.agentIds.length) {
      this.scoreRound(match);
    } else {
      this.markStateChanged();
    }

    return round.reveals[agentId];
  }

  listSpectatorEvents(matchId: string, afterSeq = 0) {
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
    return {
      challenges: clone(this.listChallenges()),
      matches: clone(this.listMatches()),
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
    const agentsById = new Map(this.listAgents().map((agent) => [agent.id, agent]));
    const rooms: GameRoomSummary[] = [
      ...this.listChallenges()
        .filter((challenge) => challenge.status === 'open')
        .map((challenge) => ({
          id: challenge.id,
          kind: 'challenge' as const,
          status: 'waiting' as const,
          gameId: this.id,
          title: `${agentsById.get(challenge.challengerAgentId)?.displayName ?? challenge.challengerAgentId} 的${this.roomTitleSuffix}`,
          roundLabel: `先赢 ${challenge.roundsToWin} 回合`,
          occupantAgentIds: [challenge.challengerAgentId],
          spectatorMatchId: challenge.matchId,
          actionLabel: 'join' as const
        })),
      ...this.listMatches().map((match) => ({
        id: match.id,
        kind: 'match' as const,
        status: match.status === 'finished' ? 'finished' as const : 'active' as const,
        gameId: this.id,
        title: match.agentIds.map((agentId) => agentsById.get(agentId)?.displayName ?? agentId).join(' vs '),
        roundLabel: `${match.phase} · round ${match.currentRound}`,
        occupantAgentIds: [...match.agentIds],
        spectatorMatchId: match.id,
        actionLabel: match.status === 'finished' ? 'replay' as const : 'spectate' as const
      }))
    ];

    const wins = new Map<string, number>();
    const played = new Map<string, number>();
    for (const match of this.listMatches()) {
      for (const agentId of match.agentIds) {
        played.set(agentId, (played.get(agentId) ?? 0) + 1);
      }

      if (match.winnerAgentId) {
        wins.set(match.winnerAgentId, (wins.get(match.winnerAgentId) ?? 0) + 1);
      }
    }

    const leaderboard: GameLeaderboardEntry[] = this.listAgents()
      .map((agent) => {
        const matchCount = played.get(agent.id) ?? 0;
        const winCount = wins.get(agent.id) ?? 0;
        return {
          agentId: agent.id,
          displayName: agent.displayName,
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
    const [leftId, rightId] = match.agentIds;
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
      reveals: {
        [leftId]: leftReveal.move,
        [rightId]: rightReveal.move
      }
    });

    for (const agentId of match.agentIds) {
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

    const matchWinner = match.agentIds.find((agentId) => match.scoreboard[agentId] >= match.roundsToWin);
    if (matchWinner) {
      match.status = 'finished';
      match.phase = 'match_finished';
      match.winnerAgentId = matchWinner;
      this.broadcastSpectator(match.id, 'match_finished', {
        matchId: match.id,
        winnerAgentId: matchWinner,
        scoreboard: { ...match.scoreboard }
      });
      for (const agentId of match.agentIds) {
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

  private advancePhase(match: Match, phase: MatchPhase) {
    const round = this.currentRound(match);
    round.phase = phase;
    match.phase = phase;
    match.updatedAt = now();

    this.broadcastSpectator(match.id, 'phase_changed', {
      phase,
      roundNumber: round.number
    });

    for (const agentId of match.agentIds) {
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

  private requireAgent(agentId: string) {
    const agent = this.agents.get(agentId);
    if (!agent) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return agent;
  }

  private requireChallenge(challengeId: string) {
    const challenge = this.challenges.get(challengeId);
    if (!challenge) {
      throw new Error(`Unknown challenge: ${challengeId}`);
    }
    return challenge;
  }

  private requireMatch(matchId: string) {
    const match = this.matches.get(matchId);
    if (!match) {
      throw new Error(`Unknown match: ${matchId}`);
    }
    return match;
  }
}
