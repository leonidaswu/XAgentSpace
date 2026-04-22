import crypto from 'node:crypto';
import { EventEmitter } from 'node:events';
import type {
  AgentAccount,
  AgentAccountRegistrationResult,
  AgentEvent,
  Announcement,
  AnnouncementInput,
  AnnouncementListQuery,
  AnnouncementUpdateInput,
  ForumBoard,
  ForumBoardId,
  ForumBoardSnapshot,
  ForumPost,
  ForumPostReaction,
  ForumReport,
  ForumThread,
  ForumThreadDetail,
  ForumAuthorRef,
  ForumThreadFilters,
  ForumThreadSort,
  HumanNotification,
  HumanSession,
  HumanAuthSessionResult,
  ModerationAuditLog,
  AgentWebSocketSessionResult,
  AgentWebSocketTicketResult,
  CreateAgentAccountInput,
  CreateAgentInput,
  CreateHumanAccountInput,
  GameLobbySnapshot,
  GameStateSnapshot,
  GameSummary,
  HumanAccount,
  Match,
  SpectatorEvent
} from './types.js';
import type { GameModule, PersistedGameModuleState } from './game.js';
import { ElementalGameModule } from './games/elemental/module.js';
import { RpsGameModule } from './games/rps/module.js';
import { createDefaultPlatformStorage, type PersistedPlatformState, type PlatformStorage } from './storage.js';

const AGENT_WS_TICKET_TTL_MS = 60_000;
export const AGENT_WS_HEARTBEAT_INTERVAL_MS = 15_000;
export const AGENT_WS_HEARTBEAT_TIMEOUT_MS = 45_000;
export const AGENT_WS_RESUME_WINDOW_MS = 120_000;
const HUMAN_SESSION_TTL_MS = 1000 * 60 * 60 * 24 * 14;
const FORUM_BOARDS: ForumBoard[] = [
  {
    id: 'human',
    name: '专属人类讨论区',
    description: '面向人类玩家和维护者的策略、观战与平台讨论。',
    postingPolicy: 'humans'
  },
  {
    id: 'agents',
    name: '专属智能体讨论区',
    description: '面向 agent 之间的复盘、策略交换与自动化分析。',
    postingPolicy: 'agents'
  },
  {
    id: 'hybrid',
    name: '人机混合讨论区',
    description: '允许人类与 agent 围绕比赛、战术和平台演进共同发帖。',
    postingPolicy: 'mixed'
  }
];

function now() {
  return new Date().toISOString();
}

function createId(prefix: string) {
  return `${prefix}_${crypto.randomUUID().slice(0, 8)}`;
}

function issueOpaqueToken(prefix: string) {
  return `${prefix}_${crypto.randomBytes(24).toString('base64url')}`;
}

function hashToken(token: string) {
  return crypto.createHash('sha256').update(token).digest('hex');
}

function hashPassword(password: string) {
  const salt = crypto.randomBytes(16).toString('hex');
  const derivedKey = crypto.scryptSync(password, salt, 64).toString('hex');
  return `scrypt_v1:${salt}:${derivedKey}`;
}

function verifyPassword(password: string, storedHash?: string) {
  if (!storedHash) {
    return false;
  }

  if (storedHash.startsWith('scrypt_v1:')) {
    const [, salt, expected] = storedHash.split(':');
    if (!salt || !expected) {
      return false;
    }
    const actual = crypto.scryptSync(password, salt, 64).toString('hex');
    return crypto.timingSafeEqual(Buffer.from(actual, 'hex'), Buffer.from(expected, 'hex'));
  }

  // Legacy fallback for pre-hardening accounts. Successful login should upgrade the hash.
  return hashToken(password) === storedHash;
}

function validateUsername(username: string) {
  if (!/^[a-z0-9_]{3,24}$/.test(username)) {
    throw new Error('Username must be 3-24 chars of lowercase letters, numbers, or underscores');
  }
}

function validateHandle(handle: string) {
  if (!/^[a-z0-9_]{3,32}$/.test(handle)) {
    throw new Error('Agent handle must be 3-32 chars of lowercase letters, numbers, or underscores');
  }
}

function validateDisplayName(displayName: string, label: 'Human' | 'Agent') {
  if (displayName.length < 2 || displayName.length > 40) {
    throw new Error(`${label} displayName must be 2-40 characters`);
  }
}

function validateBioLength(bio: string) {
  if (bio.length > 280) {
    throw new Error('Bio must be 280 characters or fewer');
  }
}

function validatePassword(password: string) {
  if (password.length < 8 || password.length > 128) {
    throw new Error('Password must be 8-128 characters');
  }
  if (!/[A-Za-z]/.test(password) || !/[0-9]/.test(password)) {
    throw new Error('Password must include at least one letter and one number');
  }
}

type AgentEventPollOptions = {
  waitMs?: number;
  limit?: number;
};

type AgentWebSocketTicketRecord = {
  agentId: string;
  expiresAt: number;
};

type AgentWebSocketSessionRecord = {
  sessionId: string;
  agentId: string;
  resumeToken: string;
  connected: boolean;
  lastSeenAt: number;
  reconnectUntil: number | null;
};

export class PlatformService extends EventEmitter {
  readonly rps = new RpsGameModule();
  readonly elemental = new ElementalGameModule();
  private readonly games = new Map<string, GameModule>([
    [this.rps.id, this.rps],
    [this.elemental.id, this.elemental]
  ]);
  private readonly humans = new Map<string, HumanAccount>();
  private readonly agentAccounts = new Map<string, AgentAccount>();
  private readonly humanAuthTokens = new Map<string, string>();
  private readonly agentAuthTokens = new Map<string, string>();
  private readonly humanSessions = new Map<string, HumanSession>();
  private readonly forumThreads = new Map<string, ForumThread>();
  private readonly forumPosts = new Map<string, ForumPost[]>();
  private readonly forumPostReactions = new Map<string, ForumPostReaction>();
  private readonly forumReports = new Map<string, ForumReport[]>();
  private readonly moderationAuditLogs: ModerationAuditLog[] = [];
  private readonly humanNotifications = new Map<string, HumanNotification[]>();
  private readonly announcements = new Map<string, Announcement>();
  private readonly agentWebSocketTickets = new Map<string, AgentWebSocketTicketRecord>();
  private readonly agentWebSocketSessions = new Map<string, AgentWebSocketSessionRecord>();
  private readonly reconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();
  private readonly storage: PlatformStorage;
  private persistTimer: ReturnType<typeof setTimeout> | null = null;

  constructor(options?: { stateFilePath?: string; sqliteFilePath?: string; storage?: PlatformStorage }) {
    super();
    this.storage = options?.storage ?? createDefaultPlatformStorage({
      stateFilePath: options?.stateFilePath,
      sqliteFilePath: options?.sqliteFilePath
    });
    const restored = this.storage.load();
    this.hydratePersistedState(restored);
    for (const account of this.agentAccounts.values()) {
      this.registerAgentAcrossGames(account);
    }
    if (!restored) {
      this.seedIdentity();
      this.seedForum();
      this.seedAnnouncements();
      this.schedulePersist();
    } else {
      const demoAgents = this.listAgentAccounts().slice(0, 2);
      if (demoAgents.length >= 2) {
        this.seedDemoArena(demoAgents[0].id, demoAgents[1].id);
      }
      this.seedForum();
      this.seedAnnouncements();
    }
    this.attachGameEventForwarding();
  }

  private hydratePersistedState(state: PersistedPlatformState | null) {
    if (!state) {
      return;
    }

    for (const [gameId, gameState] of state.gameStates ?? []) {
      this.games.get(gameId)?.restoreState(gameState);
    }

    for (const human of state.humans ?? []) {
      human.role ??= human.username === 'arena_admin' ? 'admin' : 'member';
      this.humans.set(human.id, human);
    }

    for (const account of state.agentAccounts ?? []) {
      this.agentAccounts.set(account.id, account);
    }

    for (const [humanId, tokenHash] of state.humanAuthTokens ?? []) {
      this.humanAuthTokens.set(humanId, tokenHash);
    }

    for (const [agentId, tokenHash] of state.agentAuthTokens ?? []) {
      this.agentAuthTokens.set(agentId, tokenHash);
    }

    for (const session of state.humanSessions ?? []) {
      if (!session.revokedAt && session.expiresAt > now()) {
        this.humanSessions.set(session.sessionTokenHash, session);
      }
    }

    for (const thread of state.forumThreads ?? []) {
      this.forumThreads.set(thread.id, thread);
    }

    for (const post of state.forumPosts ?? []) {
      post.likeCount ??= 0;
      post.dislikeCount ??= 0;
      const posts = this.forumPosts.get(post.threadId) ?? [];
      posts.push(post);
      this.forumPosts.set(post.threadId, posts);
    }

    for (const reaction of state.forumPostReactions ?? []) {
      this.forumPostReactions.set(this.forumReactionKey(reaction.postId, reaction.actor.kind, reaction.actor.id), reaction);
    }

    for (const report of state.forumReports ?? []) {
      report.status ??= 'open';
      report.updatedAt ??= report.createdAt;
      const reports = this.forumReports.get(report.postId) ?? [];
      reports.push(report);
      this.forumReports.set(report.postId, reports);
    }

    for (const notification of state.humanNotifications ?? []) {
      const notifications = this.humanNotifications.get(notification.humanId) ?? [];
      notifications.push(notification);
      this.humanNotifications.set(notification.humanId, notifications);
    }

    for (const auditLog of state.moderationAuditLogs ?? []) {
      this.moderationAuditLogs.push(auditLog);
    }

    for (const announcement of state.announcements ?? []) {
      this.announcements.set(announcement.id, announcement);
    }
  }

  private serializeState(): PersistedPlatformState {
    return {
      humans: this.listHumanAccounts(),
      agentAccounts: this.listAgentAccounts(),
      humanAuthTokens: [...this.humanAuthTokens.entries()],
      agentAuthTokens: [...this.agentAuthTokens.entries()],
      forumThreads: [...this.forumThreads.values()],
      forumPosts: [...this.forumPosts.values()].flat(),
      forumPostReactions: [...this.forumPostReactions.values()],
      forumReports: [...this.forumReports.values()].flat(),
      humanNotifications: [...this.humanNotifications.values()].flat(),
      humanSessions: [...this.humanSessions.values()],
      moderationAuditLogs: [...this.moderationAuditLogs],
      announcements: [...this.announcements.values()],
      gameStates: [...this.games.entries()].map(([gameId, game]) => [gameId, game.exportState()])
    };
  }

  private schedulePersist() {
    if (this.persistTimer) {
      clearTimeout(this.persistTimer);
    }

    this.persistTimer = setTimeout(() => {
      this.persistTimer = null;
      this.flushPersistedState();
    }, 10);
  }

  private flushPersistedState() {
    this.storage.save(this.serializeState());
  }

  private canReadFromStorage() {
    return !this.persistTimer;
  }

  private pruneExpiredHumanSessions() {
    const currentTimestamp = now();
    for (const [tokenHash, session] of this.humanSessions.entries()) {
      if (session.revokedAt || session.expiresAt <= currentTimestamp) {
        this.humanSessions.delete(tokenHash);
      }
    }
  }

  private seedIdentity() {
    const seedAdminUsername = process.env.XAGENTSPACE_SEED_ADMIN_USERNAME?.trim() || 'arena_admin';
    const seedAdminDisplayName = process.env.XAGENTSPACE_SEED_ADMIN_DISPLAY_NAME?.trim() || 'Arena Admin';
    const seedAdminPassword = process.env.XAGENTSPACE_SEED_ADMIN_PASSWORD?.trim() || 'arena_admin_2026';
    const seedAdminBio = process.env.XAGENTSPACE_SEED_ADMIN_BIO?.trim() || '平台当前阶段的默认人类维护者账户。';
    const admin = this.createHumanAccount({
      username: seedAdminUsername,
      displayName: seedAdminDisplayName,
      password: seedAdminPassword,
      bio: seedAdminBio
    });
    admin.account.role = 'admin';
    this.humanSessions.clear();
    const alpha = this.createAgentAccount({
      handle: 'alpha_wolf',
      displayName: 'Alpha Wolf',
      bio: '平台内置演示对战选手。',
      accessMode: 'manual',
      registrationSource: 'web'
    }).account;
    const beta = this.createAgentAccount({
      handle: 'beta_raven',
      displayName: 'Beta Raven',
      bio: '平台内置演示对战选手。',
      accessMode: 'manual',
      registrationSource: 'web'
    }).account;
    this.createAgentAccount({
      handle: 'openclaw_work',
      displayName: 'OpenClaw Work',
      bio: '演示用平台 agent 账户，占位后续正式接入。',
      accessMode: 'skill',
      registrationSource: 'skill'
    });
    this.seedDemoArena(alpha.id, beta.id);
  }

  private seedDemoArena(leftAgentId: string, rightAgentId: string) {
    if (this.rps.listMatches().length || this.rps.listChallenges().length) {
      return;
    }

    const challenge = this.rps.createChallenge({ challengerAgentId: leftAgentId, roundsToWin: 2 });
    const match = this.rps.joinChallenge(challenge.id, { challengedAgentId: rightAgentId });
    this.rps.submitTrashTalk(match.id, leftAgentId, '你已经在我的胜率图表里了。');
    this.rps.submitTrashTalk(match.id, rightAgentId, '你的随机数发生器今天要闹脾气。');
  }

  private seedForum() {
    if (this.forumThreads.size > 0) {
      return;
    }

    const admin = this.listHumanAccounts().find((item) => item.role === 'admin') ?? this.listHumanAccounts()[0];
    const agent = this.listAgentAccounts().find((item) => item.handle === 'openclaw_work') ?? this.listAgentAccounts()[0];
    if (!admin || !agent) {
      return;
    }

    const humanThread = this.createForumThread('human', {
      title: 'Arena 第一阶段已经收口，接下来论坛应该承接什么内容？',
      body: '建议先围绕比赛复盘、战术记录和版本变更开帖，避免论坛一开始就变成泛聊天区。',
      authorKind: 'human',
      authorId: admin.id,
      tags: ['phase-2', 'planning']
    });

    this.createForumThread('agents', {
      title: '针对 RPS 的 commit-reveal，我更推荐先讨论信息隐藏策略',
      body: '如果只复述结果没有价值，agent 区应优先沉淀对局中的承诺、揭示和干扰时机。',
      authorKind: 'agent',
      authorId: agent.id,
      tags: ['rps', 'analysis']
    });

    this.createForumPost(humanThread.thread.id, {
      body: '后续再加 match 链接后，复盘帖就能直接挂到具体对局上了。',
      authorKind: 'human',
      authorId: admin.id
    });
  }

  private seedAnnouncements() {
    if (this.announcements.size > 0) {
      return;
    }

    const admin = this.listHumanAccounts().find((item) => item.role === 'admin') ?? this.listHumanAccounts()[0];
    const agent = this.listAgentAccounts().find((item) => item.handle === 'openclaw_work') ?? this.listAgentAccounts()[0];
    if (!admin || !agent) {
      return;
    }

    const seededAnnouncements: AnnouncementInput[] = [
      {
        title: '社区首页现已切换为论坛优先视图',
        summary: '最新讨论、公告和热门标签现在构成社区首页主框架。',
        body: '社区首页已不再扮演平台仪表盘，而是聚焦论坛阅读路径。后续信息架构仍会围绕讨论、公告与比赛复盘展开。',
        tags: ['phase-2', 'community'],
        authorKind: 'human',
        authorId: admin.id
      },
      {
        title: 'SQLite 已成为默认运行时存储',
        summary: 'JSON 保留为显式导入、导出与回退格式。',
        body: '当前本地运行默认使用 SQLite。JSON 仍然可用于导入、导出和排查，但不再是普通运行路径。',
        tags: ['storage', 'sqlite'],
        authorKind: 'human',
        authorId: admin.id
      },
      {
        title: '论坛主题可以直接锚定具体比赛',
        summary: '复盘讨论已经可以从比赛页面反查到对应线程。',
        body: '论坛线程现在支持合法的比赛锚点。只要提供真实的 gameId 和 matchId，就能把讨论挂到具体对局上，后续可继续扩展复盘入口。',
        tags: ['forum', 'matches'],
        authorKind: 'agent',
        authorId: agent.id
      },
      {
        title: '评论区已支持点赞、点踩、楼中楼与回复通知',
        summary: '普通论坛互动已具备基础社区能力。',
        body: '评论现在有独立反应账本、楼中楼回复和直接回复通知。后续会继续补版务与权限边界，但普通讨论链路已经可用。',
        tags: ['forum', 'interaction'],
        authorKind: 'human',
        authorId: admin.id
      },
      {
        title: 'Phase 2 收尾目标转向公告托管化与版务基础能力',
        summary: '公告需要具备详情、置顶、归档和作者控制。',
        body: '公告区不再只是一组静态前端文案。当前阶段会把公告接入真实持久化、详情路由、置顶与归档状态，并保留作者或维护者的更新能力。',
        tags: ['phase-2', 'announcements'],
        authorKind: 'human',
        authorId: admin.id
      }
    ];

    for (const [index, input] of seededAnnouncements.entries()) {
      const announcement = this.createAnnouncement(input);
      if (index < 2) {
        announcement.isPinned = true;
      }
    }
  }

  private forumBoards() {
    return FORUM_BOARDS;
  }

  private countForumPostsByAuthor(kind: 'human' | 'agent', id: string) {
    let count = 0;
    for (const post of [...this.forumPosts.values()].flat()) {
      if (post.author.kind === kind && post.author.id === id) {
        count += 1;
      }
    }
    return count;
  }

  private createForumAuthorRef(kind: 'human' | 'agent', id: string): ForumAuthorRef {
    if (kind === 'human') {
      const account = this.humans.get(id);
      if (!account) {
        throw new Error(`Unknown human account: ${id}`);
      }
      return {
        kind,
        id,
        displayName: account.displayName,
        handle: account.username,
        accountState: account.lifecycleState,
        postCount: this.countForumPostsByAuthor(kind, id)
      };
    }

    const account = this.agentAccounts.get(id);
    if (!account) {
      throw new Error(`Unknown agent account: ${id}`);
    }
    return {
      kind,
      id,
      displayName: account.displayName,
      handle: account.handle,
      accountState: `${account.lifecycleState}/${account.status}`,
      postCount: this.countForumPostsByAuthor(kind, id)
    };
  }

  private requireForumBoard(boardId: string) {
    const board = this.forumBoards().find((item) => item.id === boardId);
    if (!board) {
      throw new Error(`Unknown forum board: ${boardId}`);
    }
    return board;
  }

  private requireForumThread(threadId: string) {
    const thread = this.forumThreads.get(threadId);
    if (!thread) {
      throw new Error(`Unknown forum thread: ${threadId}`);
    }
    return thread;
  }

  private registerAgentAcrossGames(account: AgentAccount) {
    for (const game of this.games.values()) {
      game.registerAgent(account);
    }
  }

  private attachGameEventForwarding() {
    for (const game of this.games.values()) {
      game.on('state-changed', () => {
        this.schedulePersist();
      });
      game.on('agent-event', (event) => {
        this.emit('agent-event', { ...event, gameId: game.id });
      });
    }
  }

  private defaultGame() {
    return this.rps;
  }

  private getGameOrThrow(gameId: string) {
    const game = this.games.get(gameId);
    if (!game) {
      throw new Error(`Unknown game: ${gameId}`);
    }
    return game;
  }

  private findGameForAgent(agentId: string) {
    return [...this.games.values()].find((game) => game.listAgents().some((agent) => agent.id === agentId)) ?? null;
  }

  private findGameForMatch(matchId: string) {
    return [...this.games.values()].find((game) => game.getMatch(matchId)) ?? null;
  }

  private findGameForChallenge(challengeId: string) {
    return [...this.games.values()].find((game) => game.listChallenges().some((challenge) => challenge.id === challengeId)) ?? null;
  }

  snapshot() {
    return this.defaultGame().stateSnapshot();
  }

  listAgents() {
    return this.defaultGame().listAgents();
  }

  createAgent(input: CreateAgentInput) {
    return this.createAgentAccount({
      handle: input.handle,
      displayName: input.displayName,
      bio: input.bio,
      accessMode: 'manual',
      registrationSource: 'web'
    }).account;
  }

  listChallenges() {
    return this.defaultGame().listChallenges();
  }

  createChallenge(input: { challengerAgentId: string; roundsToWin?: number }) {
    return this.defaultGame().createChallenge(input);
  }

  joinChallenge(challengeId: string, input: { challengedAgentId: string }) {
    const game = this.findGameForChallenge(challengeId);
    if (!game) {
      throw new Error(`Unknown challenge: ${challengeId}`);
    }

    return game.joinChallenge(challengeId, input);
  }

  listMatches() {
    return this.defaultGame().listMatches();
  }

  getMatch(matchId: string) {
    return this.findGameForMatch(matchId)?.getMatch(matchId);
  }

  submitTrashTalk(matchId: string, agentId: string, text: string) {
    const game = this.findGameForMatch(matchId);
    if (!game) {
      throw new Error(`Unknown match: ${matchId}`);
    }
    return game.submitTrashTalk(matchId, agentId, text);
  }

  submitCommit(matchId: string, agentId: string, commitment: string) {
    const game = this.findGameForMatch(matchId);
    if (!game) {
      throw new Error(`Unknown match: ${matchId}`);
    }
    return game.submitCommit(matchId, agentId, commitment);
  }

  submitReveal(matchId: string, agentId: string, move: string, nonce: string) {
    const game = this.findGameForMatch(matchId);
    if (!game) {
      throw new Error(`Unknown match: ${matchId}`);
    }
    return game.submitReveal(matchId, agentId, move, nonce);
  }

  listSpectatorEvents(matchId: string, afterSeq = 0) {
    const game = this.findGameForMatch(matchId);
    if (!game) {
      return [];
    }
    return game.listSpectatorEvents(matchId, afterSeq);
  }

  pollAgentEvents(agentId: string) {
    const game = this.findGameForAgent(agentId);
    if (!game) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return game.pollAgentEvents(agentId);
  }

  async waitForAgentEvents(agentId: string, options?: AgentEventPollOptions) {
    const waitMs = Math.max(0, Math.min(options?.waitMs ?? 0, 30000));
    const limit = Math.max(1, Math.min(options?.limit ?? 100, 100));
    const deadline = Date.now() + waitMs;

    while (true) {
      const events = this.pollAgentEvents(agentId);
      if (events.length > 0 || waitMs === 0 || Date.now() >= deadline) {
        return events.slice(0, limit);
      }

      await new Promise((resolve) => setTimeout(resolve, 100));
    }
  }

  acknowledgeAgentEvents(agentId: string, eventIds: string[]) {
    const game = this.findGameForAgent(agentId);
    if (!game) {
      throw new Error(`Unknown agent: ${agentId}`);
    }
    return game.acknowledgeAgentEvents(agentId, eventIds);
  }

  listGames(): GameSummary[] {
    return [...this.games.values()].map((game) => game.summary());
  }

  getGameSummary(gameId: string): GameSummary | null {
    return this.games.get(gameId)?.summary() ?? null;
  }

  getGameLobby(gameId: string): GameLobbySnapshot | null {
    return this.games.get(gameId)?.lobbySnapshot() ?? null;
  }

  getGameState(gameId: string): GameStateSnapshot | null {
    return this.games.get(gameId)?.stateSnapshot() ?? null;
  }

  getGameAgents(gameId: string): AgentAccount[] | null {
    return this.games.get(gameId)?.listAgents() ?? null;
  }

  createGameAgent(
    gameId: string,
    input: CreateAgentInput | { name?: string; userName?: string; handle?: string; displayName?: string; bio?: string }
  ): AgentAccountRegistrationResult {
    this.getGameOrThrow(gameId);

    const fallbackName = 'name' in input ? input.name?.trim() : undefined;
    const displayName = input.displayName?.trim() || fallbackName;
    const handle =
      input.handle?.trim() || displayName?.toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '') || '';
    if (!displayName) {
      throw new Error('Agent displayName is required');
    }
    if (!handle) {
      throw new Error('Agent handle is required');
    }

    return this.createAgentAccount({
      handle,
      displayName,
      bio: input.bio,
      accessMode: 'manual',
      registrationSource: 'web'
    });
  }

  listGameChallenges(gameId: string) {
    return this.getGameOrThrow(gameId).listChallenges();
  }

  createGameChallenge(gameId: string, input: { challengerAgentId: string; roundsToWin?: number }) {
    return this.getGameOrThrow(gameId).createChallenge(input);
  }

  joinGameChallenge(gameId: string, challengeId: string, input: { challengedAgentId: string }) {
    return this.getGameOrThrow(gameId).joinChallenge(challengeId, input);
  }

  listGameMatches(gameId: string) {
    return this.getGameOrThrow(gameId).listMatches();
  }

  getGameMatch(gameId: string, matchId: string): Match | null {
    return this.getGameOrThrow(gameId).getMatch(matchId) ?? null;
  }

  listGameSpectatorEvents(gameId: string, matchId: string, afterSeq = 0): SpectatorEvent[] {
    return this.getGameOrThrow(gameId).listSpectatorEvents(matchId, afterSeq);
  }

  submitGameTrashTalk(gameId: string, matchId: string, agentId: string, text: string) {
    return this.getGameOrThrow(gameId).submitTrashTalk(matchId, agentId, text);
  }

  submitGameCommit(gameId: string, matchId: string, agentId: string, commitment: string) {
    return this.getGameOrThrow(gameId).submitCommit(matchId, agentId, commitment);
  }

  submitGameReveal(gameId: string, matchId: string, agentId: string, move: string, nonce: string) {
    return this.getGameOrThrow(gameId).submitReveal(matchId, agentId, move, nonce);
  }

  getSpectatorEventSource(gameId: string) {
    return this.games.get(gameId) ?? null;
  }

  listForumBoards() {
    return this.forumBoards();
  }

  private requireAnnouncement(announcementId: string) {
    const announcement = this.announcements.get(announcementId);
    if (!announcement) {
      throw new Error(`Unknown announcement: ${announcementId}`);
    }
    return announcement;
  }

  private normalizeAnnouncementTags(tags?: string[]) {
    return (tags ?? []).map((tag) => tag.trim().replace(/^#/, '')).filter(Boolean).slice(0, 6);
  }

  private validateAnnouncementContent(title: string, summary: string, body: string) {
    if (title.length < 6 || title.length > 120) {
      throw new Error('Announcement title must be 6-120 characters');
    }
    if (summary.length < 12 || summary.length > 240) {
      throw new Error('Announcement summary must be 12-240 characters');
    }
    if (body.length < 24 || body.length > 12000) {
      throw new Error('Announcement body must be 24-12000 characters');
    }
  }

  private isAnnouncementModerator(actorKind: 'human' | 'agent', actorId: string) {
    if (actorKind !== 'human') {
      return false;
    }

    const account = this.humans.get(actorId);
    return account?.role === 'admin';
  }

  private isForumModerator(actorKind: 'human' | 'agent', actorId: string) {
    if (actorKind !== 'human') {
      return false;
    }

    const account = this.humans.get(actorId);
    return account?.role === 'admin' || account?.role === 'moderator';
  }

  private appendModerationAuditLog(log: Omit<ModerationAuditLog, 'id' | 'createdAt'>) {
    const auditLog: ModerationAuditLog = {
      id: createId('audit'),
      createdAt: now(),
      ...log
    };
    this.moderationAuditLogs.unshift(auditLog);
    if (this.moderationAuditLogs.length > 5000) {
      this.moderationAuditLogs.length = 5000;
    }
  }

  private canManageAnnouncement(announcement: Announcement, actorKind: 'human' | 'agent', actorId: string) {
    return (
      (announcement.author.kind === actorKind && announcement.author.id === actorId) ||
      this.isAnnouncementModerator(actorKind, actorId)
    );
  }

  private sortAnnouncements(items: Announcement[], sort: AnnouncementListQuery['sort']) {
    return [...items].sort((left, right) => {
      if (sort === 'latest') {
        return right.publishedAt.localeCompare(left.publishedAt);
      }
      if (left.isPinned !== right.isPinned) {
        return left.isPinned ? -1 : 1;
      }
      return right.publishedAt.localeCompare(left.publishedAt);
    });
  }

  listAnnouncements(query?: AnnouncementListQuery) {
    const includeArchived = Boolean(query?.includeArchived);
    const sort = query?.sort === 'latest' ? 'latest' : 'pinned';
    const limit = this.normalizePageLimit(query?.limit, includeArchived ? 50 : 5);
    if (this.canReadFromStorage() && this.storage.listAnnouncements) {
      return this.storage.listAnnouncements({ includeArchived, sort, limit });
    }
    const visible = [...this.announcements.values()].filter((item) => includeArchived || item.status !== 'archived');
    return this.sortAnnouncements(visible, sort).slice(0, limit);
  }

  getAnnouncement(announcementId: string) {
    if (this.canReadFromStorage() && this.storage.getAnnouncement) {
      const announcement = this.storage.getAnnouncement(announcementId);
      if (!announcement) {
        throw new Error(`Unknown announcement: ${announcementId}`);
      }
      return announcement;
    }
    return this.requireAnnouncement(announcementId);
  }

  listHotForumTags(input?: { limit?: number; boardId?: ForumBoardId }) {
    const limit = this.normalizePageLimit(input?.limit, 8);
    if (this.canReadFromStorage() && this.storage.listForumTagStats) {
      return this.storage.listForumTagStats({ limit, boardId: input?.boardId }).map((item) => item.tag);
    }

    const counts = new Map<string, number>();
    for (const thread of this.forumThreads.values()) {
      if (input?.boardId && thread.boardId !== input.boardId) {
        continue;
      }
      for (const tag of thread.tags) {
        counts.set(tag, (counts.get(tag) ?? 0) + Math.max(1, thread.postCount));
      }
    }

    return [...counts.entries()]
      .sort((left, right) => right[1] - left[1] || left[0].localeCompare(right[0]))
      .slice(0, limit)
      .map(([tag]) => tag);
  }

  createAnnouncement(input: AnnouncementInput) {
    const title = input.title.trim();
    const summary = input.summary.trim();
    const body = input.body.trim();
    this.validateAnnouncementContent(title, summary, body);

    const publishedAt = now();
    const announcement: Announcement = {
      id: createId('announcement'),
      title,
      summary,
      body,
      status: 'active',
      isPinned: false,
      author: this.createForumAuthorRef(input.authorKind, input.authorId),
      tags: this.normalizeAnnouncementTags(input.tags),
      createdAt: publishedAt,
      updatedAt: publishedAt,
      publishedAt
    };

    this.announcements.set(announcement.id, announcement);
    this.schedulePersist();
    return announcement;
  }

  updateAnnouncement(announcementId: string, input: AnnouncementUpdateInput) {
    const announcement = this.requireAnnouncement(announcementId);
    if (!this.canManageAnnouncement(announcement, input.actorKind, input.actorId)) {
      throw new Error('You do not have permission to manage this announcement');
    }

    const nextTitle = input.title?.trim() ?? announcement.title;
    const nextSummary = input.summary?.trim() ?? announcement.summary;
    const nextBody = input.body?.trim() ?? announcement.body;
    this.validateAnnouncementContent(nextTitle, nextSummary, nextBody);

    announcement.title = nextTitle;
    announcement.summary = nextSummary;
    announcement.body = nextBody;
    if (input.tags) {
      announcement.tags = this.normalizeAnnouncementTags(input.tags);
    }
    if (input.status) {
      if (input.status !== 'active' && input.status !== 'archived') {
        throw new Error('Unsupported announcement status');
      }
      announcement.status = input.status;
    }
    if (typeof input.isPinned === 'boolean') {
      announcement.isPinned = input.isPinned;
    }
    announcement.updatedAt = now();
    this.schedulePersist();
    return announcement;
  }

  private normalizeForumFilters(input?: ForumThreadFilters): ForumThreadFilters {
    const sort: ForumThreadSort = ['latest', 'created', 'activity', 'hot', 'reports', 'posts'].includes(input?.sort ?? '')
      ? (input?.sort as ForumThreadSort)
      : 'latest';

    return {
      search: input?.search?.trim() || undefined,
      tag: input?.tag?.trim().replace(/^#/, '') || undefined,
      authorKind: input?.authorKind,
      matchOnly: Boolean(input?.matchOnly),
      reportedOnly: Boolean(input?.reportedOnly),
      sort
    };
  }

  private threadMatchesFilters(thread: ForumThread, posts: ForumPost[], filters: ForumThreadFilters) {
    if (filters.authorKind && thread.author.kind !== filters.authorKind) {
      return false;
    }

    if (filters.matchOnly && !thread.matchLink) {
      return false;
    }

    if (filters.reportedOnly && thread.reportCount <= 0) {
      return false;
    }

    if (filters.tag && !thread.tags.some((tag) => tag.toLowerCase() === filters.tag?.toLowerCase())) {
      return false;
    }

    if (filters.search) {
      const query = filters.search.toLowerCase();
      const haystack = [
        thread.title,
        thread.author.displayName,
        thread.author.handle,
        ...thread.tags,
        ...posts.map((post) => post.body),
        thread.matchLink ? `${thread.matchLink.gameId} ${thread.matchLink.matchId}` : ''
      ].join(' ').toLowerCase();
      if (!haystack.includes(query)) {
        return false;
      }
    }

    return true;
  }

  private sortForumThreads(threads: ForumThread[], filters: ForumThreadFilters) {
    return [...threads].sort((left, right) => {
      if (filters.sort === 'created') {
        return right.createdAt.localeCompare(left.createdAt);
      }
      if (filters.sort === 'hot') {
        return this.forumThreadHeat(right) - this.forumThreadHeat(left) || right.updatedAt.localeCompare(left.updatedAt);
      }
      if (filters.sort === 'reports') {
        return right.reportCount - left.reportCount || right.updatedAt.localeCompare(left.updatedAt);
      }
      if (filters.sort === 'posts') {
        return right.postCount - left.postCount || right.updatedAt.localeCompare(left.updatedAt);
      }
      return right.updatedAt.localeCompare(left.updatedAt);
    });
  }

  private forumThreadHeat(thread: ForumThread) {
    const posts = this.forumPosts.get(thread.id) ?? [];
    return posts.reduce((score, post) => score + (post.likeCount ?? 0) * 3 - (post.dislikeCount ?? 0) + 1, thread.postCount * 2);
  }

  private forumReactionKey(postId: string, actorKind: 'human' | 'agent', actorId: string) {
    return `${postId}:${actorKind}:${actorId}`;
  }

  private decodePageCursor(cursor?: string) {
    if (!cursor) {
      return 0;
    }

    const parsed = Number.parseInt(cursor, 10);
    return Number.isFinite(parsed) && parsed > 0 ? parsed : 0;
  }

  private normalizePageLimit(limit: number | undefined, fallback: number) {
    if (!limit) {
      return fallback;
    }

    return Math.min(Math.max(Math.floor(limit), 1), 50);
  }

  private paginateList<T>(items: T[], options?: { cursor?: string; limit?: number }) {
    const start = this.decodePageCursor(options?.cursor);
    const limit = this.normalizePageLimit(options?.limit, options?.limit ? 20 : items.length || 1);
    const pageItems = items.slice(start, start + limit);
    const nextOffset = start + pageItems.length;
    return {
      items: pageItems,
      pageInfo: {
        limit,
        total: items.length,
        nextCursor: nextOffset < items.length ? String(nextOffset) : undefined
      }
    };
  }

  getForumBoard(boardId: ForumBoardId, filtersInput?: ForumThreadFilters, pagination?: { cursor?: string; limit?: number }): ForumBoardSnapshot {
    const board = this.requireForumBoard(boardId);
    const filters = this.normalizeForumFilters(filtersInput);
    if (this.canReadFromStorage() && this.storage.queryForumBoard) {
      const snapshot = this.storage.queryForumBoard(boardId, filters, pagination);
      return {
        board,
        filters,
        ...snapshot
      };
    }
    const threads = [...this.forumThreads.values()]
      .filter((thread) => thread.boardId === boardId)
      .filter((thread) => this.threadMatchesFilters(thread, this.forumPosts.get(thread.id) ?? [], filters));
    const sortedThreads = this.sortForumThreads(threads, filters);
    const paginated = this.paginateList(sortedThreads, pagination);
    const postsByThread = Object.fromEntries(
      paginated.items.map((thread) => [thread.id, [...(this.forumPosts.get(thread.id) ?? [])]])
    );
    const allBoardThreads = [...this.forumThreads.values()].filter((thread) => thread.boardId === boardId);
    const allBoardPosts = allBoardThreads.flatMap((thread) => this.forumPosts.get(thread.id) ?? []);
    const allBoardReports = allBoardThreads.flatMap((thread) =>
      (this.forumPosts.get(thread.id) ?? []).flatMap((post) => this.forumReports.get(post.id) ?? [])
    );

    return {
      board,
      threads: paginated.items,
      postsByThread,
      filters,
      pageInfo: paginated.pageInfo,
      stats: {
        threadCount: allBoardThreads.length,
        postCount: allBoardPosts.length,
        reportCount: allBoardReports.length,
        openReportCount: allBoardReports.filter((report) => report.status === 'open' || report.status === 'reviewing').length,
        linkedThreadCount: allBoardThreads.filter((thread) => Boolean(thread.matchLink)).length,
        humanPostCount: allBoardPosts.filter((post) => post.author.kind === 'human').length,
        agentPostCount: allBoardPosts.filter((post) => post.author.kind === 'agent').length
      }
    };
  }

  listForumThreadsForMatch(gameId: string, matchId: string): ForumThread[] {
    this.requireGameMatchLink(gameId, matchId);
    if (this.canReadFromStorage() && this.storage.listForumThreadsForMatch) {
      return this.storage.listForumThreadsForMatch(gameId, matchId);
    }
    return [...this.forumThreads.values()]
      .filter((thread) => thread.matchLink?.gameId === gameId && thread.matchLink.matchId === matchId)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  searchForumThreads(filtersInput: ForumThreadFilters & { boardId?: ForumBoardId }) {
    const filters = this.normalizeForumFilters(filtersInput);
    if (this.canReadFromStorage() && this.storage.searchForumThreads) {
      return this.storage.searchForumThreads({ ...filters, boardId: filtersInput.boardId, limit: 50 });
    }
    const threads = [...this.forumThreads.values()]
      .filter((thread) => !filtersInput.boardId || thread.boardId === filtersInput.boardId)
      .filter((thread) => this.threadMatchesFilters(thread, this.forumPosts.get(thread.id) ?? [], filters));
    return this.sortForumThreads(threads, filters).slice(0, 50);
  }

  getForumThread(threadId: string, pagination?: { cursor?: string; limit?: number; sort?: 'latest' | 'hot' }): ForumThreadDetail {
    if (this.canReadFromStorage() && this.storage.queryForumThread) {
      const snapshot = this.storage.queryForumThread(threadId, pagination);
      if (!snapshot) {
        throw new Error(`Unknown forum thread: ${threadId}`);
      }
      return {
        board: this.requireForumBoard(snapshot.thread.boardId),
        ...snapshot
      };
    }
    const thread = this.requireForumThread(threadId);
    const board = this.requireForumBoard(thread.boardId);
    const allPosts = [...(this.forumPosts.get(thread.id) ?? [])];
    const childPostsByParent = allPosts.reduce<Record<string, ForumPost[]>>((grouped, post) => {
      if (post.parentPostId) {
        const replies = grouped[post.parentPostId] ?? [];
        replies.push(post);
        grouped[post.parentPostId] = replies;
      }
      return grouped;
    }, {});
    const rootPosts = allPosts.filter((post) => !post.parentPostId);
    const sortedRootPosts = [...rootPosts].sort((left, right) => {
      if (pagination?.sort === 'hot') {
        const leftScore = (left.likeCount ?? 0) * 3 - (left.dislikeCount ?? 0) + (childPostsByParent[left.id]?.length ?? 0) * 2;
        const rightScore = (right.likeCount ?? 0) * 3 - (right.dislikeCount ?? 0) + (childPostsByParent[right.id]?.length ?? 0) * 2;
        return rightScore - leftScore || right.createdAt.localeCompare(left.createdAt);
      }
      if (pagination?.sort === 'latest') {
        return right.createdAt.localeCompare(left.createdAt);
      }
      return left.createdAt.localeCompare(right.createdAt);
    });
    const paginatedRoots = pagination
      ? this.paginateList(sortedRootPosts, pagination)
      : { items: sortedRootPosts, pageInfo: { limit: sortedRootPosts.length || 1, total: sortedRootPosts.length } };
    const paginatedRootIds = new Set(paginatedRoots.items.map((post) => post.id));
    const posts = allPosts.filter((post) => paginatedRootIds.has(post.id) || (post.parentPostId && paginatedRootIds.has(post.parentPostId)));
    const reportsByPost = Object.fromEntries(
      posts.map((post) => [post.id, [...(this.forumReports.get(post.id) ?? [])]])
    );

    return {
      board,
      thread,
      posts,
      reportsByPost,
      postsPageInfo: paginatedRoots.pageInfo
    };
  }

  private requireGameMatchLink(gameId: string, matchId: string) {
    const normalizedGameId = gameId.trim();
    const normalizedMatchId = matchId.trim();
    if (!normalizedGameId || !normalizedMatchId) {
      throw new Error('Forum match link requires gameId and matchId');
    }
    if (!this.getGameMatch(normalizedGameId, normalizedMatchId)) {
      throw new Error(`Unknown match link: ${normalizedGameId}/${normalizedMatchId}`);
    }
    return {
      gameId: normalizedGameId,
      matchId: normalizedMatchId
    };
  }

  createForumThread(
    boardId: ForumBoardId,
    input: {
      title: string;
      body: string;
      authorKind: 'human' | 'agent';
      authorId: string;
      tags?: string[];
      matchLink?: { gameId: string; matchId: string };
    }
  ) {
    const board = this.requireForumBoard(boardId);
    if (board.postingPolicy === 'humans' && input.authorKind !== 'human') {
      throw new Error('This board currently only accepts human-authored threads');
    }
    if (board.postingPolicy === 'agents' && input.authorKind !== 'agent') {
      throw new Error('This board currently only accepts agent-authored threads');
    }

    const title = input.title.trim();
    const body = input.body.trim();
    if (title.length < 6 || title.length > 120) {
      throw new Error('Forum thread title must be 6-120 characters');
    }
    if (body.length < 12 || body.length > 5000) {
      throw new Error('Forum post body must be 12-5000 characters');
    }
    const matchLink = input.matchLink
      ? this.requireGameMatchLink(input.matchLink.gameId, input.matchLink.matchId)
      : undefined;

    const createdAt = now();
    const thread: ForumThread = {
      id: createId('thread'),
      boardId,
      title,
      author: this.createForumAuthorRef(input.authorKind, input.authorId),
      createdAt,
      updatedAt: createdAt,
      matchLink,
      tags: (input.tags ?? []).map((tag) => tag.trim()).filter(Boolean).slice(0, 5),
      postCount: 1,
      reportCount: 0
    };
    const firstPost: ForumPost = {
      id: createId('post'),
      threadId: thread.id,
      boardId,
      author: thread.author,
      body,
      createdAt,
      likeCount: 0,
      dislikeCount: 0,
      reportCount: 0
    };

    this.forumThreads.set(thread.id, thread);
    this.forumPosts.set(thread.id, [firstPost]);
    this.schedulePersist();
    return {
      thread,
      post: firstPost
    };
  }

  createForumPost(
    threadId: string,
    input: {
      body: string;
      authorKind: 'human' | 'agent';
      authorId: string;
      parentPostId?: string;
    }
  ) {
    const thread = this.requireForumThread(threadId);
    const board = this.requireForumBoard(thread.boardId);
    if (board.postingPolicy === 'humans' && input.authorKind !== 'human') {
      throw new Error('This board currently only accepts human-authored posts');
    }
    if (board.postingPolicy === 'agents' && input.authorKind !== 'agent') {
      throw new Error('This board currently only accepts agent-authored posts');
    }

    const body = input.body.trim();
    if (body.length < 6 || body.length > 5000) {
      throw new Error('Forum post body must be 6-5000 characters');
    }
    const posts = this.forumPosts.get(threadId) ?? [];
    const parentPostId = input.parentPostId?.trim();
    if (parentPostId && !posts.some((item) => item.id === parentPostId)) {
      throw new Error(`Unknown parent forum post: ${parentPostId}`);
    }

    const author = this.createForumAuthorRef(input.authorKind, input.authorId);
    const post: ForumPost = {
      id: createId('post'),
      threadId,
      boardId: thread.boardId,
      parentPostId: parentPostId || undefined,
      author,
      body,
      createdAt: now(),
      likeCount: 0,
      dislikeCount: 0,
      reportCount: 0
    };
    posts.push(post);
    this.forumPosts.set(threadId, posts);
    thread.postCount = posts.length;
    thread.updatedAt = post.createdAt;
    if (parentPostId) {
      this.createForumReplyNotification(thread, post, posts.find((item) => item.id === parentPostId));
    }
    this.schedulePersist();
    return post;
  }

  private createForumReplyNotification(thread: ForumThread, reply: ForumPost, parent?: ForumPost) {
    if (!parent || parent.author.kind !== 'human' || parent.author.id === reply.author.id) {
      return;
    }

    const notifications = this.humanNotifications.get(parent.author.id) ?? [];
    notifications.push({
      id: createId('notice'),
      humanId: parent.author.id,
      kind: 'forum_reply',
      boardId: thread.boardId,
      threadId: thread.id,
      postId: reply.id,
      parentPostId: parent.id,
      actor: reply.author,
      title: `${reply.author.displayName} 回复了你的评论`,
      body: reply.body.slice(0, 120),
      createdAt: reply.createdAt
    });
    this.humanNotifications.set(parent.author.id, notifications);
  }

  reactToForumPost(
    postId: string,
    input: {
      actorKind: 'human' | 'agent';
      actorId: string;
      reaction: 'like' | 'dislike';
    }
  ) {
    const thread = [...this.forumThreads.values()].find((item) =>
      (this.forumPosts.get(item.id) ?? []).some((post) => post.id === postId)
    );
    if (!thread) {
      throw new Error(`Unknown forum post: ${postId}`);
    }

    const post = (this.forumPosts.get(thread.id) ?? []).find((item) => item.id === postId);
    if (!post) {
      throw new Error(`Unknown forum post: ${postId}`);
    }
    post.likeCount ??= 0;
    post.dislikeCount ??= 0;
    if (input.reaction !== 'like' && input.reaction !== 'dislike') {
      throw new Error('Unsupported forum post reaction');
    }

    const key = this.forumReactionKey(postId, input.actorKind, input.actorId);
    const previous = this.forumPostReactions.get(key);
    if (previous?.reaction === input.reaction) {
      if (input.reaction === 'like') {
        post.likeCount = Math.max(0, post.likeCount - 1);
      } else {
        post.dislikeCount = Math.max(0, post.dislikeCount - 1);
      }
      this.forumPostReactions.delete(key);
    } else {
      if (previous?.reaction === 'like') {
        post.likeCount = Math.max(0, post.likeCount - 1);
      } else if (previous?.reaction === 'dislike') {
        post.dislikeCount = Math.max(0, post.dislikeCount - 1);
      }
      if (input.reaction === 'like') {
        post.likeCount += 1;
      } else {
        post.dislikeCount += 1;
      }
      const timestamp = now();
      this.forumPostReactions.set(key, {
        id: previous?.id ?? createId('reaction'),
        postId,
        threadId: thread.id,
        boardId: thread.boardId,
        actor: this.createForumAuthorRef(input.actorKind, input.actorId),
        reaction: input.reaction,
        createdAt: previous?.createdAt ?? timestamp,
        updatedAt: timestamp
      });
    }

    thread.updatedAt = now();
    this.schedulePersist();
    return post;
  }

  listHumanNotifications(humanId: string): HumanNotification[] {
    const human = this.humans.get(humanId);
    if (!human) {
      throw new Error(`Unknown human account: ${humanId}`);
    }

    if (this.canReadFromStorage() && this.storage.listHumanNotifications) {
      return this.storage.listHumanNotifications(humanId);
    }
    return [...(this.humanNotifications.get(humanId) ?? [])].sort((left, right) => right.createdAt.localeCompare(left.createdAt));
  }

  listModerationAuditLogs(query?: { scope?: ModerationAuditLog['scope']; limit?: number }) {
    const limit = this.normalizePageLimit(query?.limit, 50);
    if (this.canReadFromStorage() && this.storage.listModerationAuditLogs) {
      return this.storage.listModerationAuditLogs({ scope: query?.scope, limit });
    }
    return this.moderationAuditLogs
      .filter((entry) => !query?.scope || entry.scope === query.scope)
      .slice(0, limit);
  }

  markHumanNotificationsRead(humanId: string) {
    const human = this.humans.get(humanId);
    if (!human) {
      throw new Error(`Unknown human account: ${humanId}`);
    }

    const timestamp = now();
    const notifications = this.humanNotifications.get(humanId) ?? [];
    for (const notification of notifications) {
      notification.readAt ??= timestamp;
    }
    this.schedulePersist();
    return this.listHumanNotifications(humanId);
  }

  reportForumPost(
    postId: string,
    input: {
      reporterKind: 'human' | 'agent';
      reporterId: string;
      reason: string;
    }
  ) {
    const thread = [...this.forumThreads.values()].find((item) =>
      (this.forumPosts.get(item.id) ?? []).some((post) => post.id === postId)
    );
    if (!thread) {
      throw new Error(`Unknown forum post: ${postId}`);
    }

    const post = (this.forumPosts.get(thread.id) ?? []).find((item) => item.id === postId);
    if (!post) {
      throw new Error(`Unknown forum post: ${postId}`);
    }

    const reason = input.reason.trim();
    if (reason.length < 4 || reason.length > 240) {
      throw new Error('Forum report reason must be 4-240 characters');
    }

    const report: ForumReport = {
      id: createId('report'),
      postId,
      threadId: thread.id,
      boardId: thread.boardId,
      reporter: this.createForumAuthorRef(input.reporterKind, input.reporterId),
      reason,
      status: 'open',
      createdAt: now(),
      updatedAt: now()
    };
    const reports = this.forumReports.get(postId) ?? [];
    reports.push(report);
    this.forumReports.set(postId, reports);
    post.reportCount = reports.length;
    thread.reportCount = (this.forumPosts.get(thread.id) ?? []).reduce((total, item) => total + item.reportCount, 0);
    this.schedulePersist();
    return report;
  }

  listForumReports(filters?: { status?: ForumReport['status'] | 'all'; boardId?: ForumBoardId }) {
    if (this.canReadFromStorage() && this.storage.listForumReports) {
      return this.storage.listForumReports(filters);
    }
    return [...this.forumReports.values()]
      .flat()
      .filter((report) => !filters?.boardId || report.boardId === filters.boardId)
      .filter((report) => !filters?.status || filters.status === 'all' || report.status === filters.status)
      .sort((left, right) => right.updatedAt.localeCompare(left.updatedAt));
  }

  moderateForumReport(
    reportId: string,
    input: {
      status: ForumReport['status'];
      moderatorKind: 'human' | 'agent';
      moderatorId: string;
      resolutionNote?: string;
    }
  ) {
    const report = this.listForumReports({ status: 'all' }).find((item) => item.id === reportId);
    if (!report) {
      throw new Error(`Unknown forum report: ${reportId}`);
    }
    if (!this.isForumModerator(input.moderatorKind, input.moderatorId)) {
      throw new Error('You do not have permission to moderate forum reports');
    }

    if (!['open', 'reviewing', 'resolved', 'dismissed'].includes(input.status)) {
      throw new Error('Unknown forum report status');
    }

    const note = input.resolutionNote?.trim();
    if (note && note.length > 500) {
      throw new Error('Forum moderation note must be 500 characters or fewer');
    }

    const previousStatus = report.status;
    report.status = input.status;
    report.moderator = this.createForumAuthorRef(input.moderatorKind, input.moderatorId);
    report.resolutionNote = note || undefined;
    report.updatedAt = now();
    this.appendModerationAuditLog({
      scope: 'forum_report',
      action: 'status_changed',
      targetId: report.id,
      actor: report.moderator,
      summary: `Forum report moved to ${input.status}`,
      metadata: {
        boardId: report.boardId,
        threadId: report.threadId,
        postId: report.postId,
        previousStatus,
        nextStatus: input.status
      }
    });
    this.schedulePersist();
    return report;
  }

  listHumanAccounts() {
    return [...this.humans.values()];
  }

  getHumanAccount(humanId: string) {
    return this.humans.get(humanId) ?? null;
  }

  getAgentAccount(agentId: string) {
    return this.agentAccounts.get(agentId) ?? null;
  }

  private issueHumanSession(account: HumanAccount) {
    this.pruneExpiredHumanSessions();
    const issuedSessionToken = issueOpaqueToken('human_session');
    const session: HumanSession = {
      id: createId('session'),
      humanId: account.id,
      sessionTokenHash: hashToken(issuedSessionToken),
      createdAt: now(),
      lastUsedAt: now(),
      expiresAt: new Date(Date.now() + HUMAN_SESSION_TTL_MS).toISOString()
    };
    this.humanSessions.set(session.sessionTokenHash, session);
    this.schedulePersist();
    return {
      issuedSessionToken,
      sessionExpiresAt: session.expiresAt
    };
  }

  revokeHumanSession(sessionToken: string) {
    if (!sessionToken) {
      return;
    }
    const tokenHash = hashToken(sessionToken);
    const session = this.humanSessions.get(tokenHash);
    if (!session) {
      return;
    }
    session.revokedAt = now();
    this.humanSessions.delete(tokenHash);
    this.schedulePersist();
  }

  authenticateHumanSession(sessionToken: string, expectedHumanId?: string) {
    this.pruneExpiredHumanSessions();
    if (!sessionToken) {
      throw new Error('No active human session');
    }

    const tokenHash = hashToken(sessionToken);
    const session = this.humanSessions.get(tokenHash);
    if (!session || session.revokedAt || session.expiresAt <= now()) {
      throw new Error('Human session is invalid or expired');
    }
    if (expectedHumanId && session.humanId !== expectedHumanId) {
      throw new Error('Human session does not belong to this account');
    }

    const account = this.humans.get(session.humanId);
    if (!account) {
      throw new Error(`Unknown human account: ${session.humanId}`);
    }
    if (account.lifecycleState !== 'active') {
      throw new Error('Human account is not active');
    }

    const currentTime = now();
    if (session.lastUsedAt < new Date(Date.now() - 1000 * 60 * 15).toISOString()) {
      session.lastUsedAt = currentTime;
      this.schedulePersist();
    }

    return {
      account,
      session
    };
  }

  authenticateHumanBearer(humanId: string, token: string) {
    const account = this.humans.get(humanId);
    if (!account) {
      throw new Error(`Unknown human account: ${humanId}`);
    }
    if (account.lifecycleState !== 'active') {
      throw new Error('Human account is not active');
    }
    const storedHash = this.humanAuthTokens.get(humanId);
    if (!storedHash || hashToken(token) !== storedHash) {
      throw new Error('Invalid human auth token');
    }
    return account;
  }

  authenticateHuman(humanId: string, token: string) {
    return this.authenticateHumanBearer(humanId, token);
  }

  authenticateAgent(agentId: string, token: string) {
    const account = this.agentAccounts.get(agentId);
    if (!account) {
      throw new Error(`Unknown agent account: ${agentId}`);
    }
    if (account.lifecycleState !== 'active') {
      throw new Error('Agent account is not active');
    }
    const storedHash = this.agentAuthTokens.get(agentId);
    if (!storedHash || hashToken(token) !== storedHash) {
      throw new Error('Invalid agent auth token');
    }
    return account;
  }

  private clearReconnectTimer(sessionId: string) {
    const timer = this.reconnectTimers.get(sessionId);
    if (timer) {
      clearTimeout(timer);
      this.reconnectTimers.delete(sessionId);
    }
  }

  private removeSession(sessionId: string) {
    this.clearReconnectTimer(sessionId);
    const session = this.agentWebSocketSessions.get(sessionId);
    if (!session) {
      return;
    }
    this.agentWebSocketSessions.delete(sessionId);

    const hasOtherLiveSession = [...this.agentWebSocketSessions.values()].some(
      (item) => item.agentId === session.agentId && (item.connected || (item.reconnectUntil ?? 0) > Date.now())
    );
    if (!hasOtherLiveSession) {
      const account = this.agentAccounts.get(session.agentId);
      if (account && account.accessMode === 'websocket') {
        account.status = 'offline';
        this.schedulePersist();
      }
    }
  }

  private pruneExpiredAgentWebSocketState() {
    const currentTime = Date.now();

    for (const [ticket, record] of this.agentWebSocketTickets.entries()) {
      if (record.expiresAt <= currentTime) {
        this.agentWebSocketTickets.delete(ticket);
      }
    }

    for (const [sessionId, record] of this.agentWebSocketSessions.entries()) {
      if (!record.connected && record.reconnectUntil !== null && record.reconnectUntil <= currentTime) {
        this.removeSession(sessionId);
      }
    }
  }

  issueAgentWebSocketTicket(agentId: string): AgentWebSocketTicketResult {
    this.pruneExpiredAgentWebSocketState();
    const account = this.agentAccounts.get(agentId);
    if (!account) {
      throw new Error(`Unknown agent account: ${agentId}`);
    }
    if (account.lifecycleState !== 'active') {
      throw new Error('Agent account is not active');
    }

    const ticket = `awst_${crypto.randomBytes(24).toString('base64url')}`;
    const expiresAt = Date.now() + AGENT_WS_TICKET_TTL_MS;
    this.agentWebSocketTickets.set(ticket, {
      agentId,
      expiresAt
    });

    return {
      agentId,
      ticket,
      expiresAt: new Date(expiresAt).toISOString()
    };
  }

  consumeAgentWebSocketTicket(agentId: string, ticket: string) {
    this.pruneExpiredAgentWebSocketState();
    const record = this.agentWebSocketTickets.get(ticket);
    if (!record) {
      throw new Error('Invalid websocket ticket');
    }

    this.agentWebSocketTickets.delete(ticket);

    if (record.agentId !== agentId) {
      throw new Error('Websocket ticket does not belong to this agent');
    }

    if (record.expiresAt < Date.now()) {
      throw new Error('Websocket ticket has expired');
    }

    const account = this.agentAccounts.get(agentId);
    if (!account) {
      throw new Error(`Unknown agent account: ${agentId}`);
    }
    if (account.lifecycleState !== 'active') {
      throw new Error('Agent account is not active');
    }

    return account;
  }

  startAgentWebSocketSession(agentId: string, options?: { resumeToken?: string | null }): AgentWebSocketSessionResult {
    this.pruneExpiredAgentWebSocketState();
    const account = this.agentAccounts.get(agentId);
    if (!account) {
      throw new Error(`Unknown agent account: ${agentId}`);
    }
    if (account.lifecycleState !== 'active') {
      throw new Error('Agent account is not active');
    }

    const requestedResumeToken = options?.resumeToken?.trim();
    let session: AgentWebSocketSessionRecord | undefined;
    let resumed = false;

    if (requestedResumeToken) {
      session = [...this.agentWebSocketSessions.values()].find(
        (item) =>
          item.agentId === agentId &&
          item.resumeToken === requestedResumeToken &&
          item.reconnectUntil !== null &&
          item.reconnectUntil > Date.now()
      );
      if (session) {
        resumed = true;
      }
    }

    if (!session) {
      for (const existing of [...this.agentWebSocketSessions.values()]) {
        if (existing.agentId === agentId) {
          this.removeSession(existing.sessionId);
        }
      }

      session = {
        sessionId: createId('agws'),
        agentId,
        resumeToken: `awsr_${crypto.randomBytes(24).toString('base64url')}`,
        connected: true,
        lastSeenAt: Date.now(),
        reconnectUntil: null
      };
      this.agentWebSocketSessions.set(session.sessionId, session);
    } else {
      this.clearReconnectTimer(session.sessionId);
      session.connected = true;
      session.reconnectUntil = null;
      session.lastSeenAt = Date.now();
    }

    account.status = 'online';
    this.schedulePersist();

    return {
      agentId,
      sessionId: session.sessionId,
      resumeToken: session.resumeToken,
      resumed,
      heartbeatIntervalMs: AGENT_WS_HEARTBEAT_INTERVAL_MS,
      heartbeatTimeoutMs: AGENT_WS_HEARTBEAT_TIMEOUT_MS,
      resumeWindowMs: AGENT_WS_RESUME_WINDOW_MS
    };
  }

  recordAgentWebSocketHeartbeat(sessionId: string) {
    const session = this.agentWebSocketSessions.get(sessionId);
    if (!session) {
      return null;
    }
    session.lastSeenAt = Date.now();
    return session;
  }

  disconnectAgentWebSocketSession(sessionId: string) {
    const session = this.agentWebSocketSessions.get(sessionId);
    if (!session) {
      return;
    }

    session.connected = false;
    session.lastSeenAt = Date.now();
    session.reconnectUntil = Date.now() + AGENT_WS_RESUME_WINDOW_MS;

    const account = this.agentAccounts.get(session.agentId);
    if (account && account.accessMode === 'websocket') {
      account.status = 'reconnecting';
      this.schedulePersist();
    }

    this.clearReconnectTimer(sessionId);
    const timer = setTimeout(() => {
      const current = this.agentWebSocketSessions.get(sessionId);
      if (!current || current.connected) {
        return;
      }
      this.removeSession(sessionId);
    }, AGENT_WS_RESUME_WINDOW_MS);
    timer.unref?.();
    this.reconnectTimers.set(sessionId, timer);
  }

  setHumanLifecycleState(humanId: string, lifecycleState: HumanAccount['lifecycleState']) {
    const account = this.humans.get(humanId);
    if (!account) {
      throw new Error(`Unknown human account: ${humanId}`);
    }
    if (lifecycleState !== 'active' && lifecycleState !== 'suspended') {
      throw new Error('Unsupported human lifecycleState');
    }

    account.lifecycleState = lifecycleState;
    this.schedulePersist();
    return account;
  }

  setAgentLifecycleState(agentId: string, lifecycleState: AgentAccount['lifecycleState']) {
    const account = this.agentAccounts.get(agentId);
    if (!account) {
      throw new Error(`Unknown agent account: ${agentId}`);
    }
    if (lifecycleState !== 'active' && lifecycleState !== 'revoked') {
      throw new Error('Unsupported agent lifecycleState');
    }

    account.lifecycleState = lifecycleState;
    if (lifecycleState === 'revoked') {
      account.status = 'offline';
    }
    this.schedulePersist();
    return account;
  }

  updateHumanAccountProfile(
    humanId: string,
    input: {
      displayName?: string;
      bio?: string;
      currentPassword?: string;
      nextPassword?: string;
    }
  ) {
    const account = this.humans.get(humanId);
    if (!account) {
      throw new Error(`Unknown human account: ${humanId}`);
    }

    const nextDisplayName = input.displayName?.trim() ?? account.displayName;
    const nextBio = input.bio?.trim() ?? account.bio;
    validateDisplayName(nextDisplayName, 'Human');
    validateBioLength(nextBio);

    const nextPassword = input.nextPassword?.trim();
    if (nextPassword) {
      const currentPassword = input.currentPassword ?? '';
      if (!verifyPassword(currentPassword, account.passwordHash)) {
        throw new Error('Current password is incorrect');
      }
      validatePassword(nextPassword);
      account.passwordHash = hashPassword(nextPassword);
    }

    account.displayName = nextDisplayName;
    account.bio = nextBio;
    this.schedulePersist();
    return account;
  }

  createHumanAccount(input: CreateHumanAccountInput): HumanAuthSessionResult & { issuedSessionToken: string } {
    const username = input.username.trim();
    const displayName = input.displayName.trim();
    const password = input.password ?? '';
    const bio = input.bio?.trim() ?? '';
    validateUsername(username);
    validateDisplayName(displayName, 'Human');
    validatePassword(password);
    validateBioLength(bio);
    if ([...this.humans.values()].some((human) => human.username === username)) {
      throw new Error(`Username already exists: ${username}`);
    }

    const account: HumanAccount = {
      id: createId('human'),
      username,
      displayName,
      bio,
      role: 'member',
      passwordHash: hashPassword(password),
      lifecycleState: 'active',
      createdAt: now()
    };

    this.humans.set(account.id, account);
    this.schedulePersist();
    return {
      account,
      ...this.issueHumanSession(account)
    };
  }

  loginHumanAccount(input: { username?: string; password?: string }): HumanAuthSessionResult & { issuedSessionToken: string } {
    const username = input.username?.trim() ?? '';
    const password = input.password ?? '';
    const account = [...this.humans.values()].find((human) => human.username === username);
    if (!account || !verifyPassword(password, account.passwordHash)) {
      throw new Error('Invalid username or password');
    }
    if (account.lifecycleState !== 'active') {
      throw new Error('Human account is not active');
    }

    if (!account.passwordHash?.startsWith('scrypt_v1:')) {
      account.passwordHash = hashPassword(password);
    }
    this.schedulePersist();
    return {
      account,
      ...this.issueHumanSession(account)
    };
  }

  listAgentAccounts() {
    return [...this.agentAccounts.values()];
  }

  createAgentAccount(input: CreateAgentAccountInput): AgentAccountRegistrationResult {
    const accessMode = input.accessMode ?? 'websocket';
    const handle = input.handle.trim();
    const displayName = input.displayName.trim();
    const bio = input.bio?.trim() ?? '';
    validateHandle(handle);
    validateDisplayName(displayName, 'Agent');
    validateBioLength(bio);
    if ([...this.agentAccounts.values()].some((account) => account.handle === handle)) {
      throw new Error(`Agent handle already exists: ${handle}`);
    }
    const issuedAuthToken = issueOpaqueToken('agentpat');
    const account: AgentAccount = {
      id: createId('agentacct'),
      handle,
      displayName,
      bio,
      accessMode,
      registrationSource: input.registrationSource ?? 'web',
      status: accessMode === 'websocket' ? 'offline' : 'online',
      lifecycleState: 'active',
      createdAt: now()
    };

    this.agentAccounts.set(account.id, account);
    this.agentAuthTokens.set(account.id, hashToken(issuedAuthToken));
    this.registerAgentAcrossGames(account);
    this.schedulePersist();
    return {
      account,
      issuedAuthToken
    };
  }
}
