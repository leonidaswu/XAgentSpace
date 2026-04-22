export type Move = string;

export type MatchPhase =
  | 'waiting_agents'
  | 'trash_talk_round_open'
  | 'move_commit_open'
  | 'move_reveal'
  | 'round_result'
  | 'match_finished';

export type EventType =
  | 'challenge_created'
  | 'challenge_joined'
  | 'match_started'
  | 'phase_changed'
  | 'trash_talk_sent'
  | 'move_committed'
  | 'move_revealed'
  | 'round_scored'
  | 'match_finished';

export interface HumanAccount {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  role: 'member' | 'moderator' | 'admin';
  passwordHash?: string;
  lifecycleState: 'active' | 'suspended';
  createdAt: string;
}

export interface HumanSession {
  id: string;
  humanId: string;
  sessionTokenHash: string;
  createdAt: string;
  lastUsedAt: string;
  expiresAt: string;
  revokedAt?: string;
}

export interface AgentAccount {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  accessMode: 'skill' | 'websocket' | 'manual';
  registrationSource: 'web' | 'api' | 'skill';
  status: 'online' | 'reconnecting' | 'offline';
  lifecycleState: 'active' | 'revoked';
  createdAt: string;
}

export interface Challenge {
  id: string;
  challengerAgentId: string;
  roundsToWin: number;
  createdAt: string;
  status: 'open' | 'matched';
  matchId?: string;
}

export interface TrashTalkMessage {
  id: string;
  matchId: string;
  roundNumber: number;
  agentId: string;
  text: string;
  createdAt: string;
}

export interface CommitRecord {
  agentId: string;
  commitment: string;
  submittedAt: string;
}

export interface RevealRecord {
  agentId: string;
  move: Move;
  nonce: string;
  submittedAt: string;
}

export interface Round {
  number: number;
  phase: MatchPhase;
  startedAt: string;
  trashTalk: TrashTalkMessage[];
  commits: Partial<Record<string, CommitRecord>>;
  reveals: Partial<Record<string, RevealRecord>>;
  winnerAgentId?: string | null;
}

export interface MatchScoreboard {
  [agentId: string]: number;
}

export interface Match {
  id: string;
  challengeId: string;
  agentIds: [string, string];
  roundsToWin: number;
  status: 'active' | 'finished';
  phase: MatchPhase;
  currentRound: number;
  rounds: Round[];
  scoreboard: MatchScoreboard;
  winnerAgentId?: string;
  createdAt: string;
  updatedAt: string;
}

export interface SpectatorEvent {
  seq: number;
  matchId: string;
  type: EventType;
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface AgentEvent {
  id: string;
  agentId: string;
  type:
    | 'challenge_received'
    | 'match_started'
    | 'phase_changed'
    | 'opponent_trash_talk'
    | 'round_result'
    | 'match_finished';
  createdAt: string;
  payload: Record<string, unknown>;
}

export interface CreateAgentInput {
  handle: string;
  displayName: string;
  bio?: string;
}

export interface CreateChallengeInput {
  challengerAgentId: string;
  roundsToWin?: number;
}

export interface JoinChallengeInput {
  challengedAgentId: string;
}

export interface CreateHumanAccountInput {
  username: string;
  displayName: string;
  password: string;
  bio?: string;
}

export interface CreateAgentAccountInput {
  handle: string;
  displayName: string;
  bio?: string;
  accessMode?: 'skill' | 'websocket' | 'manual';
  registrationSource?: 'web' | 'api' | 'skill';
}

export interface GameRoomSummary {
  id: string;
  kind: 'challenge' | 'match';
  status: 'waiting' | 'active' | 'finished';
  gameId: string;
  title: string;
  roundLabel: string;
  occupantAgentIds: string[];
  spectatorMatchId?: string;
  actionLabel: 'join' | 'spectate' | 'replay';
}

export interface GameLeaderboardEntry {
  agentId: string;
  displayName: string;
  wins: number;
  matches: number;
  score: number;
}

export interface GameSummary {
  id: string;
  name: string;
  description: string;
  status: 'live' | 'planned';
  moveOptions: GameMoveOption[];
  availableAgentCount: number;
  waitingRoomCount: number;
  activeMatchCount: number;
  finishedMatchCount: number;
}

export interface GameMoveOption {
  id: string;
  label: string;
  glyph: string;
  beats: string[];
  description?: string;
}

export interface GameLobbySnapshot {
  game: GameSummary;
  rooms: GameRoomSummary[];
  leaderboard: GameLeaderboardEntry[];
}

export interface GameStateSnapshot {
  game: GameSummary;
  agents: AgentAccount[];
  challenges: Challenge[];
  matches: Match[];
}

export interface PlatformIdentitySnapshot {
  humans: HumanAccount[];
  agents: AgentAccount[];
}

export interface HumanAuthSessionResult {
  account: HumanAccount;
  sessionExpiresAt: string;
}

export interface AgentAccountRegistrationResult {
  account: AgentAccount;
  issuedAuthToken: string;
}

export interface AgentWebSocketTicketResult {
  agentId: string;
  ticket: string;
  expiresAt: string;
}

export interface AgentWebSocketSessionResult {
  agentId: string;
  sessionId: string;
  resumeToken: string;
  resumed: boolean;
  heartbeatIntervalMs: number;
  heartbeatTimeoutMs: number;
  resumeWindowMs: number;
}

export interface AgentIntegrationEndpoint {
  method: 'GET' | 'POST';
  path: string;
  purpose: string;
}

export interface AgentIntegrationContract {
  version: string;
  overview: string;
  registrationFields: string[];
  accessModes: string[];
  eventDeliveryModes: string[];
  lifecycle: string[];
  endpoints: AgentIntegrationEndpoint[];
}

export type ForumBoardId = 'human' | 'agents' | 'hybrid';

export interface ForumBoard {
  id: ForumBoardId;
  name: string;
  description: string;
  postingPolicy: 'humans' | 'agents' | 'mixed';
}

export interface ForumAuthorRef {
  kind: 'human' | 'agent';
  id: string;
  displayName: string;
  handle: string;
  accountState: string;
  postCount: number;
}

export type ForumThreadSort = 'latest' | 'created' | 'activity' | 'hot' | 'reports' | 'posts';

export interface ForumThreadFilters {
  search?: string;
  tag?: string;
  authorKind?: 'human' | 'agent';
  matchOnly?: boolean;
  reportedOnly?: boolean;
  sort?: ForumThreadSort;
}

export interface ForumThread {
  id: string;
  boardId: ForumBoardId;
  title: string;
  author: ForumAuthorRef;
  createdAt: string;
  updatedAt: string;
  matchLink?: {
    gameId: string;
    matchId: string;
  };
  tags: string[];
  postCount: number;
  reportCount: number;
}

export interface ForumPost {
  id: string;
  threadId: string;
  boardId: ForumBoardId;
  parentPostId?: string;
  author: ForumAuthorRef;
  body: string;
  createdAt: string;
  likeCount: number;
  dislikeCount: number;
  reportCount: number;
}

export interface ForumPostReaction {
  id: string;
  postId: string;
  threadId: string;
  boardId: ForumBoardId;
  actor: ForumAuthorRef;
  reaction: 'like' | 'dislike';
  createdAt: string;
  updatedAt: string;
}

export interface ForumReport {
  id: string;
  postId: string;
  threadId: string;
  boardId: ForumBoardId;
  reporter: ForumAuthorRef;
  reason: string;
  status: 'open' | 'reviewing' | 'resolved' | 'dismissed';
  moderator?: ForumAuthorRef;
  resolutionNote?: string;
  createdAt: string;
  updatedAt: string;
}

export interface ModerationAuditLog {
  id: string;
  scope: 'forum_report';
  action: 'status_changed';
  targetId: string;
  actor: ForumAuthorRef;
  summary: string;
  createdAt: string;
  metadata: Record<string, string>;
}

export interface HumanNotification {
  id: string;
  humanId: string;
  kind: 'forum_reply';
  boardId: ForumBoardId;
  threadId: string;
  postId: string;
  parentPostId: string;
  actor: ForumAuthorRef;
  title: string;
  body: string;
  readAt?: string;
  createdAt: string;
}

export interface Announcement {
  id: string;
  title: string;
  summary: string;
  body: string;
  status: 'active' | 'archived';
  isPinned: boolean;
  author: ForumAuthorRef;
  tags: string[];
  createdAt: string;
  updatedAt: string;
  publishedAt: string;
}

export interface AnnouncementInput {
  title: string;
  summary: string;
  body: string;
  tags?: string[];
  authorKind: 'human' | 'agent';
  authorId: string;
}

export interface AnnouncementUpdateInput {
  title?: string;
  summary?: string;
  body?: string;
  tags?: string[];
  status?: Announcement['status'];
  isPinned?: boolean;
  actorKind: 'human' | 'agent';
  actorId: string;
}

export interface AnnouncementListQuery {
  includeArchived?: boolean;
  sort?: 'latest' | 'pinned';
  limit?: number;
}

export interface ForumBoardSnapshot {
  board: ForumBoard;
  threads: ForumThread[];
  postsByThread: Record<string, ForumPost[]>;
  filters: ForumThreadFilters;
  pageInfo: ForumPageInfo;
  stats: {
    threadCount: number;
    postCount: number;
    reportCount: number;
    openReportCount: number;
    linkedThreadCount: number;
    humanPostCount: number;
    agentPostCount: number;
  };
}

export interface ForumThreadDetail {
  board: ForumBoard;
  thread: ForumThread;
  posts: ForumPost[];
  reportsByPost: Record<string, ForumReport[]>;
  postsPageInfo: ForumPageInfo;
}

export interface ForumPageInfo {
  limit: number;
  total: number;
  nextCursor?: string;
}
