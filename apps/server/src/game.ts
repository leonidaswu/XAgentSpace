import type {
  AgentAccount,
  AgentEvent,
  Challenge,
  CreateAgentInput,
  GameLobbySnapshot,
  GameStateSnapshot,
  GameSummary,
  Match,
  SpectatorEvent
} from './types.js';
export {
  RpsGameModule as GameEngine,
  TOTAL_TRASH_TALK_TURNS,
  TRASH_TALK_TURNS_PER_AGENT,
  commitmentFor
} from './games/rps/module.js';

export interface PersistedGameModuleState {
  challenges: Challenge[];
  matches: Match[];
  spectatorEvents: Array<[string, SpectatorEvent[]]>;
  agentQueues: Array<[string, AgentEvent[]]>;
}

export interface GameModule {
  readonly id: string;
  readonly name: string;
  readonly description: string;
  summary(): GameSummary;
  lobbySnapshot(): GameLobbySnapshot;
  stateSnapshot(): GameStateSnapshot;
  listAgents(): AgentAccount[];
  createAgent(input: CreateAgentInput): AgentAccount;
  registerAgent(agent: AgentAccount): AgentAccount;
  listChallenges(): Challenge[];
  createChallenge(input: { challengerAgentId: string; roundsToWin?: number }): Challenge;
  joinChallenge(challengeId: string, input: { challengedAgentId: string }): Match;
  listMatches(): Match[];
  getMatch(matchId: string): Match | undefined;
  submitTrashTalk(matchId: string, agentId: string, text: string): unknown;
  submitCommit(matchId: string, agentId: string, commitment: string): unknown;
  submitReveal(matchId: string, agentId: string, move: string, nonce: string): unknown;
  listSpectatorEvents(matchId: string, afterSeq?: number): SpectatorEvent[];
  pollAgentEvents(agentId: string): unknown[];
  acknowledgeAgentEvents(agentId: string, eventIds: string[]): void;
  exportState(): PersistedGameModuleState;
  restoreState(state: PersistedGameModuleState | null | undefined): void;
  on(event: 'spectator-event', listener: (event: SpectatorEvent) => void): this;
  off(event: 'spectator-event', listener: (event: SpectatorEvent) => void): this;
  on(event: 'agent-event', listener: (event: AgentEvent) => void): this;
  off(event: 'agent-event', listener: (event: AgentEvent) => void): this;
  on(event: 'state-changed', listener: () => void): this;
  off(event: 'state-changed', listener: () => void): this;
}
