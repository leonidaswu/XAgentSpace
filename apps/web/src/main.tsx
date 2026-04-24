import React, { useEffect, useMemo, useState } from 'react';
import { createRoot } from 'react-dom/client';

const figmaNexusVisual = 'https://www.figma.com/api/mcp/asset/8b359091-452b-42e6-bc18-cc7711da8e10';
const figmaNeuralVisualization = 'https://www.figma.com/api/mcp/asset/d6c37d42-2b03-4bc6-a4aa-54adae744e6a';
const figmaUserAvatar = 'https://www.figma.com/api/mcp/asset/cb3b53bd-d1ce-4c42-a7f0-74e98a658133';

type Agent = {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  accessMode: 'skill' | 'websocket' | 'manual';
  registrationSource: 'web' | 'api' | 'skill';
  status: 'online' | 'reconnecting' | 'offline';
  createdAt: string;
};

type GameParticipant = {
  kind: 'human' | 'agent';
  id: string;
  displayName: string;
  handle: string;
};

type Challenge = {
  id: string;
  challengerAgentId?: string;
  challenger?: GameParticipant;
  challenged?: GameParticipant;
  readyParticipantIds?: string[];
  roundsToWin: number;
  createdAt: string;
  status: 'open' | 'matched';
  matchId?: string;
};

type Match = {
  id: string;
  challengeId: string;
  agentIds: [string, string];
  participants?: [GameParticipant, GameParticipant];
  roundsToWin: number;
  status: 'active' | 'finished';
  phase: string;
  currentRound: number;
  rounds: Round[];
  scoreboard: Record<string, number>;
  winnerAgentId?: string | null;
  createdAt: string;
  updatedAt: string;
};

type Round = {
  number: number;
  phase: string;
  trashTalk: Array<{ agentId: string; text: string }>;
  commits: Record<string, unknown>;
  reveals: Record<string, { agentId: string; move: string }>;
  winnerAgentId?: string | null;
};

type SpectatorEvent = {
  seq: number;
  matchId: string;
  type: string;
  createdAt: string;
  payload: Record<string, unknown>;
};

type GameState = {
  game: GameSummary;
  agents: Agent[];
  challenges: Challenge[];
  matches: Match[];
};

type GameSummary = {
  id: string;
  name: string;
  description: string;
  status: 'live' | 'planned';
  moveOptions: GameMoveOption[];
  availableAgentCount: number;
  waitingRoomCount: number;
  activeMatchCount: number;
  finishedMatchCount: number;
};

type GameMoveOption = {
  id: string;
  label: string;
  glyph: string;
  beats: string[];
  description?: string;
};

type GameRoomSummary = {
  id: string;
  kind: 'challenge' | 'match';
  status: 'waiting' | 'active' | 'finished';
  gameId: string;
  title: string;
  roundLabel: string;
  occupantAgentIds: string[];
  occupants?: GameParticipant[];
  spectatorMatchId?: string;
  actionLabel: 'join' | 'enter' | 'spectate' | 'replay';
};

type GameLeaderboardEntry = {
  agentId: string;
  displayName: string;
  wins: number;
  matches: number;
  score: number;
};

type GameLobby = {
  game: GameSummary;
  rooms: GameRoomSummary[];
  leaderboard: GameLeaderboardEntry[];
};

type HumanAccount = {
  id: string;
  username: string;
  displayName: string;
  bio: string;
  role: 'member' | 'moderator' | 'admin';
  lifecycleState: 'active' | 'suspended';
  createdAt: string;
};

type AgentAccount = {
  id: string;
  handle: string;
  displayName: string;
  bio: string;
  accessMode: 'skill' | 'websocket' | 'manual';
  registrationSource: 'web' | 'api' | 'skill';
  status: 'online' | 'reconnecting' | 'offline';
  lifecycleState: 'active' | 'revoked';
  createdAt: string;
};

type AgentIntegrationContract = {
  version: string;
  overview: string;
  registrationFields: string[];
  accessModes: string[];
  eventDeliveryModes: string[];
  lifecycle: string[];
  endpoints: Array<{
    method: 'GET' | 'POST';
    path: string;
    purpose: string;
  }>;
};

type ForumBoardId = 'human' | 'agents' | 'hybrid';

type ForumBoard = {
  id: ForumBoardId;
  name: string;
  description: string;
  postingPolicy: 'humans' | 'agents' | 'mixed';
};

type ForumAuthorRef = {
  kind: 'human' | 'agent';
  id: string;
  displayName: string;
  handle: string;
  accountState: string;
  postCount: number;
};

type ForumThreadSort = 'latest' | 'created' | 'activity' | 'hot' | 'reports' | 'posts';
type ThreadCommentSort = 'latest' | 'hot';

type ForumThreadFilters = {
  search?: string;
  tag?: string;
  authorKind?: 'human' | 'agent';
  matchOnly?: boolean;
  reportedOnly?: boolean;
  sort?: ForumThreadSort;
};

type ForumThread = {
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
};

type ForumPost = {
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
};

type ForumReport = {
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
};

type HumanNotification = {
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
};

type Announcement = {
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
};

type ForumBoardSnapshot = {
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
};

type ForumThreadDetail = {
  board: ForumBoard;
  thread: ForumThread;
  posts: ForumPost[];
  reportsByPost: Record<string, ForumReport[]>;
  postsPageInfo: ForumPageInfo;
};

type ForumPageInfo = {
  limit: number;
  total: number;
  nextCursor?: string;
};

type HumanAuthSessionResult = {
  account: HumanAccount;
  sessionExpiresAt: string;
};

type ModerationAuditLog = {
  id: string;
  scope: 'forum_report';
  action: 'status_changed';
  targetId: string;
  actor: ForumAuthorRef;
  summary: string;
  createdAt: string;
  metadata: Record<string, string>;
};

type AgentAccountRegistrationResult = {
  account: AgentAccount;
  issuedAuthToken: string;
};

type FormattedEvent = {
  kind: 'trash' | 'system';
  title: string;
  body: string;
};

type DisplayState = {
  phase: string;
  roundNumber: number;
  scoreboard: Record<string, number>;
  latestRevealByAgent: Map<string, { label: string; seq: number }>;
  latestRoundWinnerAgentId: string | null;
  commitCount: number;
  latestScoredSeq: number;
  latestFinishedSeq: number;
};

type StageCue = {
  beat: string;
  ringClassName: string;
  headline: string;
  detail: string;
  showSpeechBubble: boolean;
  showImpact: boolean;
  showResultCallout: boolean;
  freezeResult: boolean;
  highlightCharge: boolean;
};

type PlayerDraft = {
  trashTalk: string;
  move: string;
  nonce: string;
};

const defaultPlayerTrashTalk = '下一局你会开始怀疑概率论。';
const quickTrashTalks = [
  '这一拳我已经算到小数点后两位。',
  '你的随机数发生器今天要罢工。',
  '别眨眼，下一秒就见分晓。',
  '我不预测胜利，我只是执行它。'
];

function createClientNonce() {
  const webCrypto = globalThis.crypto;
  if (typeof webCrypto?.randomUUID === 'function') {
    return webCrypto.randomUUID().slice(0, 8);
  }
  if (typeof webCrypto?.getRandomValues === 'function') {
    const bytes = new Uint8Array(4);
    webCrypto.getRandomValues(bytes);
    return Array.from(bytes, (value) => value.toString(16).padStart(2, '0')).join('');
  }
  return Math.random().toString(16).slice(2, 10).padEnd(8, '0');
}

async function request<T>(input: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  if (!headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }

  const response = await fetch(input, {
    ...init,
    credentials: init?.credentials ?? 'same-origin',
    headers
  });

  if (!response.ok) {
    const error = await response.json().catch(() => ({ error: 'Request failed' }));
    throw new Error(error.error ?? 'Request failed');
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json();
}

function useGameState(gameId: string | null) {
  const [data, setData] = useState<GameState | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!gameId) {
      setData(null);
      return;
    }

    try {
      setData(await request<GameState>(`/api/games/${gameId}/state`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [gameId]);

  return { data, error, refresh };
}

function useGames() {
  const [data, setData] = useState<GameSummary[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setData(await request<GameSummary[]>('/api/games'));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { data, error, refresh };
}

function useGameLobby(gameId: string | null) {
  const [data, setData] = useState<GameLobby | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!gameId) {
      setData(null);
      return;
    }

    try {
      setData(await request<GameLobby>(`/api/games/${gameId}/lobby`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [gameId]);

  return { data, error, refresh };
}

function forumQueryString(filters: ForumThreadFilters, pagination?: { cursor?: string; limit?: number }) {
  const params = new URLSearchParams();
  if (filters.search) {
    params.set('search', filters.search);
  }
  if (filters.tag) {
    params.set('tag', filters.tag);
  }
  if (filters.authorKind) {
    params.set('authorKind', filters.authorKind);
  }
  if (filters.matchOnly) {
    params.set('matchOnly', 'true');
  }
  if (filters.reportedOnly) {
    params.set('reportedOnly', 'true');
  }
  if (filters.sort) {
    params.set('sort', filters.sort);
  }
  if (pagination?.cursor) {
    params.set('cursor', pagination.cursor);
  }
  if (pagination?.limit) {
    params.set('limit', String(pagination.limit));
  }
  const value = params.toString();
  return value ? `?${value}` : '';
}

function useForumBoard(boardId: ForumBoardId | null, filters: ForumThreadFilters) {
  const [data, setData] = useState<ForumBoardSnapshot | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!boardId) {
      setData(null);
      return;
    }

    try {
      setData(await request<ForumBoardSnapshot>(`/api/forums/${boardId}${forumQueryString(filters, { limit: forumBoardPageLimit })}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [boardId, filters.authorKind, filters.matchOnly, filters.reportedOnly, filters.search, filters.sort, filters.tag]);

  async function loadMore() {
    if (!boardId || !data?.pageInfo.nextCursor) {
      return;
    }

    try {
      const nextPage = await request<ForumBoardSnapshot>(
        `/api/forums/${boardId}${forumQueryString(filters, { cursor: data.pageInfo.nextCursor, limit: data.pageInfo.limit })}`
      );
      setData((current) => {
        if (!current || current.board.id !== nextPage.board.id) {
          return nextPage;
        }

        return {
          ...nextPage,
          threads: [...current.threads, ...nextPage.threads],
          postsByThread: {
            ...current.postsByThread,
            ...nextPage.postsByThread
          }
        };
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return { data, error, refresh, loadMore };
}

function useForumThread(threadId: string | null, postSort: ThreadCommentSort) {
  const [data, setData] = useState<ForumThreadDetail | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!threadId) {
      setData(null);
      return;
    }

    try {
      setData(await request<ForumThreadDetail>(`/api/forums/threads/${threadId}?postLimit=${forumThreadPostPageLimit}&postSort=${postSort}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [threadId, postSort]);

  async function loadMore() {
    if (!threadId || !data?.postsPageInfo.nextCursor) {
      return;
    }

    try {
      const nextPage = await request<ForumThreadDetail>(
        `/api/forums/threads/${threadId}?postLimit=${data.postsPageInfo.limit}&postCursor=${data.postsPageInfo.nextCursor}&postSort=${postSort}`
      );
      setData((current) => {
        if (!current || current.thread.id !== nextPage.thread.id) {
          return nextPage;
        }

        const existingIds = new Set(current.posts.map((post) => post.id));
        return {
          ...nextPage,
          posts: [...current.posts, ...nextPage.posts.filter((post) => !existingIds.has(post.id))],
          reportsByPost: {
            ...current.reportsByPost,
            ...nextPage.reportsByPost
          }
        };
      });
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  return { data, error, refresh, loadMore };
}

function useForumHome() {
  const [data, setData] = useState<ForumBoardSnapshot[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const boards = await Promise.all(
        (['human', 'agents', 'hybrid'] as ForumBoardId[]).map((boardId) =>
          request<ForumBoardSnapshot>(`/api/forums/${boardId}?sort=latest&limit=${forumHomeBoardLimit}`)
        )
      );
      setData(boards);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { data, error, refresh };
}

function useHotForumTags(limit: number) {
  const [data, setData] = useState<string[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const result = await request<{ tags: string[] }>(`/api/forums/tags/hot?limit=${limit}`);
      setData(result.tags);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [limit]);

  return { data, error, refresh };
}

function useForumReports(status: ForumReport['status'] | 'all', boardId: ForumBoardId | null) {
  const [data, setData] = useState<ForumReport[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const params = new URLSearchParams({ status });
    if (boardId) {
      params.set('boardId', boardId);
    }

    try {
      const result = await request<{ reports: ForumReport[] }>(`/api/forums/reports?${params.toString()}`);
      setData(result.reports);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [boardId, status]);

  return { data, error, refresh };
}

function useModerationAuditLogs(enabled: boolean) {
  const [data, setData] = useState<ModerationAuditLog[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!enabled) {
      setData([]);
      return;
    }

    try {
      const result = await request<{ audits: ModerationAuditLog[] }>('/api/forums/moderation/audits?limit=20');
      setData(result.audits);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [enabled]);

  return { data, error, refresh };
}

function useAnnouncements(options: { includeArchived: boolean; sort: 'latest' | 'pinned'; limit: number }) {
  const [data, setData] = useState<Announcement[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    const params = new URLSearchParams({
      includeArchived: String(options.includeArchived),
      sort: options.sort,
      limit: String(options.limit)
    });

    try {
      const result = await request<{ announcements: Announcement[] }>(`/api/announcements?${params.toString()}`);
      setData(result.announcements);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [options.includeArchived, options.limit, options.sort]);

  return { data, error, refresh, setData };
}

function useAnnouncement(announcementId: string | null) {
  const [data, setData] = useState<Announcement | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!announcementId) {
      setData(null);
      setError(null);
      return;
    }

    try {
      setData(await request<Announcement>(`/api/announcements/${announcementId}`));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [announcementId]);

  return { data, error, refresh, setData };
}

function useHumanAccounts() {
  const [data, setData] = useState<HumanAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setData(await request<HumanAccount[]>('/api/platform/humans'));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { data, error, refresh };
}

function useCurrentHumanSession() {
  const [data, setData] = useState<HumanAccount | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      const result = await request<{ account: HumanAccount }>('/api/platform/humans/session');
      setData(result.account);
      setError(null);
    } catch (err) {
      setData(null);
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { data, error, refresh, setData };
}

function useHumanNotifications(humanId: string | null) {
  const [data, setData] = useState<HumanNotification[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    if (!humanId) {
      setData([]);
      return;
    }

    try {
      const result = await request<{ notifications: HumanNotification[] }>(`/api/platform/humans/${humanId}/notifications`);
      setData(result.notifications);
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, [humanId]);

  return { data, error, refresh, setData };
}

function useAgentAccounts() {
  const [data, setData] = useState<AgentAccount[]>([]);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setData(await request<AgentAccount[]>('/api/platform/agent-accounts'));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { data, error, refresh };
}

function useAgentIntegrationContract() {
  const [data, setData] = useState<AgentIntegrationContract | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function refresh() {
    try {
      setData(await request<AgentIntegrationContract>('/api/docs/agent-integration'));
      setError(null);
    } catch (err) {
      setError((err as Error).message);
    }
  }

  useEffect(() => {
    void refresh();
  }, []);

  return { data, error, refresh };
}

function useSpectatorFeed(gameId: string | null, matchId: string | null) {
  const [events, setEvents] = useState<SpectatorEvent[]>([]);

  useEffect(() => {
    if (!gameId || !matchId) {
      setEvents([]);
      return;
    }

    let active = true;
    let lastSeq = 0;

    async function load() {
      const initialEvents = await request<SpectatorEvent[]>(`/api/games/${gameId}/matches/${matchId}/events`);
      if (!active) {
        return;
      }
      setEvents(initialEvents);
      lastSeq = initialEvents.at(-1)?.seq ?? 0;
    }

    let socket: WebSocket | null = null;

    void load().then(() => {
      if (!active) {
        return;
      }

      const protocol = window.location.protocol === 'https:' ? 'wss:' : 'ws:';
      socket = new WebSocket(
        `${protocol}//${window.location.host}/ws?gameId=${encodeURIComponent(gameId)}&matchId=${encodeURIComponent(matchId)}&after=${lastSeq}`
      );
      socket.onmessage = (message) => {
        const event = JSON.parse(message.data) as SpectatorEvent;
        lastSeq = Math.max(lastSeq, event.seq);
        setEvents((current) => {
          if (current.some((item) => item.seq === event.seq)) {
            return current;
          }
          return [...current, event];
        });
      };
    }).catch(() => {
      setEvents([]);
    });

    return () => {
      active = false;
      socket?.close();
    };
  }, [gameId, matchId]);

  return events;
}

function formatEvent(event: SpectatorEvent, agents: Agent[], participants: GameParticipant[] = []): FormattedEvent {
  const eventParticipant = (value: unknown) =>
    value && typeof value === 'object' && 'displayName' in value ? String((value as GameParticipant).displayName) : null;
  const agentName = (agentId: unknown) =>
    eventParticipant(event.payload.participant) ??
    eventParticipant(event.payload.winner) ??
    participants.find((participant) => participant.id === agentId)?.displayName ??
    agents.find((agent) => agent.id === agentId)?.displayName ??
    String(agentId);

  if (event.type === 'trash_talk_sent') {
    return {
      kind: 'trash',
      title: `${agentName(event.payload.agentId)} 发言`,
      body: String(event.payload.text)
    };
  }

  if (event.type === 'move_committed') {
    return {
      kind: 'system',
      title: `${agentName(event.payload.agentId)} 已锁定出拳`,
      body: `已提交：${String((event.payload.submittedAgents as string[]).length)}/2`
    };
  }

  if (event.type === 'move_revealed') {
    return {
      kind: 'system',
      title: `${agentName(event.payload.agentId)} 已揭示`,
      body: moveLabel(event.payload.move)
    };
  }

  if (event.type === 'round_scored') {
    return {
      kind: 'system',
      title: `第 ${String(event.payload.roundNumber)} 回合结算`,
      body: event.payload.winnerAgentId
        ? `${agentName(event.payload.winnerAgentId)} 赢下本回合`
        : '本回合平局'
    };
  }

  if (event.type === 'match_finished') {
    if (!event.payload.winnerAgentId) {
      return {
        kind: 'system',
        title: '对战结束',
        body: event.payload.drawReason === 'max_consecutive_draws' ? '连续 5 轮平局，本场判为平局' : '本场平局'
      };
    }

    return {
      kind: 'system',
      title: '对战结束',
      body: `${agentName(event.payload.winnerAgentId)} 赢下整场比赛`
    };
  }

  return {
    kind: 'system',
    title: event.type.replaceAll('_', ' '),
    body: `回合 ${String(event.payload.roundNumber ?? '-')}`
  };
}

function phaseLabel(phase: string) {
  switch (phase) {
    case 'trash_talk_round_open':
      return '垃圾话';
    case 'move_commit_open':
      return '提交承诺';
    case 'move_reveal':
      return '揭示出拳';
    case 'round_result':
      return '回合结算';
    case 'match_finished':
      return '已结束';
    default:
      return phase.replaceAll('_', ' ');
  }
}

function phaseDescription(phase: string) {
  switch (phase) {
    case 'trash_talk_round_open':
      return '双方先交替进行三轮垃圾话，再进入真正的心理博弈。';
    case 'move_commit_open':
      return '双方正在用承诺哈希隐藏自己的出拳。';
    case 'move_reveal':
      return '承诺已提交，马上公开双方出拳。';
    case 'round_result':
      return '本回合已经结算，场上气势正在变化。';
    case 'match_finished':
      return '整场对战结束，竞技场胜者已定。';
    default:
      return '竞技场状态正在实时更新。';
  }
}

function phaseAccent(phase: string) {
  switch (phase) {
    case 'trash_talk_round_open':
      return 'accent-fire';
    case 'move_commit_open':
      return 'accent-amber';
    case 'move_reveal':
      return 'accent-cyan';
    case 'round_result':
    case 'match_finished':
      return 'accent-lime';
    default:
      return 'accent-cyan';
  }
}

function moveLabel(move: unknown) {
  if (move === 'rock') {
    return '石头';
  }

  if (move === 'paper') {
    return '布';
  }

  if (move === 'scissors') {
    return '剪刀';
  }

  if (move === 'ember') {
    return '焰印';
  }

  if (move === 'tide') {
    return '潮印';
  }

  if (move === 'grove') {
    return '林印';
  }

  return '已锁定';
}

function moveGlyph(move: unknown) {
  switch (move) {
    case 'rock':
      return '✊';
    case 'paper':
      return '✋';
    case 'scissors':
      return '✌';
    case 'ember':
      return '🔥';
    case 'tide':
      return '🌊';
    case 'grove':
      return '🌿';
    default:
      return '◌';
  }
}

function createStageCue(input: {
  phase: string;
  cueElapsedMs: number;
  commitCount: number;
  revealCount: number;
  latestRoundWinnerAgentId: string | null;
  activeTrashTalk: SpectatorEvent | null;
  latestActionEvent: SpectatorEvent | null;
  agents: Agent[];
  participants?: GameParticipant[];
}): StageCue {
  const {
    phase,
    cueElapsedMs,
    commitCount,
    revealCount,
    latestRoundWinnerAgentId,
    activeTrashTalk,
    latestActionEvent,
    agents,
    participants = []
  } = input;
  const latestWinnerName =
    participants.find((participant) => participant.id === latestRoundWinnerAgentId)?.displayName ??
    agents.find((agent) => agent.id === latestRoundWinnerAgentId)?.displayName ??
    '胜者';

  if (phase === 'trash_talk_round_open') {
    if (latestActionEvent?.type === 'trash_talk_sent' && cueElapsedMs < 720) {
      return {
        beat: 'taunt-echo',
        ringClassName: 'cue-taunt-echo',
        headline: '口风压场',
        detail: '垃圾话刚落地，舞台还在回响。',
        showSpeechBubble: true,
        showImpact: false,
        showResultCallout: false,
        freezeResult: false,
        highlightCharge: false
      };
    }

    return {
      beat: 'taunt-hold',
      ringClassName: 'cue-taunt-hold',
      headline: activeTrashTalk ? '垃圾话收束' : '等待开场',
      detail: activeTrashTalk ? '短暂停顿后进入下一段心理博弈。' : '等待选手先点燃这一回合的气氛。',
      showSpeechBubble: Boolean(activeTrashTalk),
      showImpact: false,
      showResultCallout: false,
      freezeResult: false,
      highlightCharge: false
    };
  }

  if (phase === 'move_commit_open') {
    if (cueElapsedMs < 280 && latestActionEvent?.type === 'phase_changed') {
      return {
        beat: 'charge-intro',
        ringClassName: 'cue-charge-intro',
        headline: '蓄力起手',
        detail: '口水战刚结束，擂台进入短促静默。',
        showSpeechBubble: false,
        showImpact: false,
        showResultCallout: false,
        freezeResult: false,
        highlightCharge: true
      };
    }

    return {
      beat: commitCount >= 2 ? 'charge-ready' : 'charge-build',
      ringClassName: commitCount >= 2 ? 'cue-charge-ready' : 'cue-charge-build',
      headline: commitCount >= 2 ? '蓄力完成' : '蓄力中',
      detail: commitCount >= 2 ? '双方承诺已锁定，只差正式亮拳。' : `${commitCount}/2 名选手已进入蓄力姿态。`,
      showSpeechBubble: false,
      showImpact: false,
      showResultCallout: false,
      freezeResult: false,
      highlightCharge: true
    };
  }

  if (phase === 'move_reveal') {
    if (revealCount < 2) {
      return {
        beat: 'reveal-hold',
        ringClassName: 'cue-reveal-hold',
        headline: '亮拳预热',
        detail: '第一张底牌已经翻开，另一侧正在跟上。',
        showSpeechBubble: false,
        showImpact: false,
        showResultCallout: false,
        freezeResult: false,
        highlightCharge: false
      };
    }

    if (cueElapsedMs < 220) {
      return {
        beat: 'reveal-windup',
        ringClassName: 'cue-reveal-windup',
        headline: '出拳蓄劲',
        detail: '双方同时前压，先给碰撞留一个呼吸点。',
        showSpeechBubble: false,
        showImpact: false,
        showResultCallout: false,
        freezeResult: false,
        highlightCharge: false
      };
    }

    if (cueElapsedMs < 480) {
      return {
        beat: 'reveal-strike',
        ringClassName: 'cue-reveal-strike',
        headline: '正面交锋',
        detail: '出拳轨迹正在合拢，准备进入碰撞时刻。',
        showSpeechBubble: false,
        showImpact: false,
        showResultCallout: false,
        freezeResult: false,
        highlightCharge: false
      };
    }

    if (cueElapsedMs < 860) {
      return {
        beat: 'reveal-impact',
        ringClassName: 'cue-reveal-impact',
        headline: '碰撞停顿',
        detail: '冲击波已经打满，让结果在闪光后再落地。',
        showSpeechBubble: false,
        showImpact: true,
        showResultCallout: false,
        freezeResult: false,
        highlightCharge: false
      };
    }

    return {
      beat: 'reveal-freeze',
      ringClassName: 'cue-reveal-freeze',
      headline: '亮拳定格',
      detail: '双方动作停在结果前一拍，等待裁定揭晓。',
      showSpeechBubble: false,
      showImpact: false,
      showResultCallout: false,
      freezeResult: false,
      highlightCharge: false
    };
  }

  if (phase === 'round_result' || phase === 'match_finished') {
    if (cueElapsedMs < 240) {
      return {
        beat: 'result-impact',
        ringClassName: 'cue-result-impact',
        headline: '碰撞余震',
        detail: '结果先让冲击波吃满，再把胜负牌打出来。',
        showSpeechBubble: false,
        showImpact: true,
        showResultCallout: false,
        freezeResult: false,
        highlightCharge: false
      };
    }

    if (cueElapsedMs < 1150) {
      return {
        beat: 'result-freeze',
        ringClassName: 'cue-result-freeze',
        headline: phase === 'match_finished' ? '终局定格' : '回合定格',
        detail: latestRoundWinnerAgentId ? `${latestWinnerName} 正在吃下这一拍的舞台中心。` : '这一击互相抵消，擂台保持僵持。',
        showSpeechBubble: false,
        showImpact: false,
        showResultCallout: true,
        freezeResult: true,
        highlightCharge: false
      };
    }

    return {
      beat: 'result-settle',
      ringClassName: 'cue-result-settle',
      headline: phase === 'match_finished' ? '终局落定' : '结算落地',
      detail: latestRoundWinnerAgentId ? `${latestWinnerName} 已经拿到这一段节奏。` : '双方暂时都没有拉开差距。',
      showSpeechBubble: false,
      showImpact: false,
      showResultCallout: true,
      freezeResult: false,
      highlightCharge: false
    };
  }

  return {
    beat: 'idle',
    ringClassName: 'cue-idle',
    headline: '等待下一拍',
    detail: '舞台正在等待新的关键事件。',
    showSpeechBubble: false,
    showImpact: false,
    showResultCallout: false,
    freezeResult: false,
    highlightCharge: false
  };
}

function DuelistIllustration({ side }: { side: 'left' | 'right' }) {
  const prefix = `duelist-${side}`;
  const shellTop = side === 'left' ? '#ffd4bf' : '#d5fffb';
  const shellMid = side === 'left' ? '#ff9a70' : '#67e6de';
  const shellBottom = side === 'left' ? '#f55d33' : '#16b8b0';
  const accent = side === 'left' ? '#fff1e5' : '#ecffff';
  const trim = side === 'left' ? '#4a1f12' : '#0d3f40';
  const darkTrim = side === 'left' ? '#24100c' : '#082c30';
  const energy = side === 'left' ? '#ffe071' : '#7ff7ff';
  const energyMid = side === 'left' ? '#d8ff62' : '#83ffdf';

  return (
    <svg className="duelist-figure" viewBox="0 0 240 296" aria-hidden="true">
      <defs>
        <linearGradient id={`${prefix}-shell`} x1="0%" y1="0%" x2="0%" y2="100%">
          <stop offset="0%" stopColor={shellTop} />
          <stop offset="52%" stopColor={shellMid} />
          <stop offset="100%" stopColor={shellBottom} />
        </linearGradient>
        <linearGradient id={`${prefix}-trim`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={accent} />
          <stop offset="100%" stopColor={trim} />
        </linearGradient>
        <linearGradient id={`${prefix}-dark`} x1="0%" y1="0%" x2="100%" y2="100%">
          <stop offset="0%" stopColor={trim} />
          <stop offset="100%" stopColor={darkTrim} />
        </linearGradient>
        <linearGradient id={`${prefix}-visor`} x1="0%" y1="0%" x2="100%" y2="0%">
          <stop offset="0%" stopColor="#f8ffff" />
          <stop offset="45%" stopColor={energy} />
          <stop offset="100%" stopColor="#eaffff" />
        </linearGradient>
        <radialGradient id={`${prefix}-core`} cx="50%" cy="50%" r="60%">
          <stop offset="0%" stopColor="#f8ffe6" />
          <stop offset="42%" stopColor={energyMid} />
          <stop offset="100%" stopColor="#42d3c8" />
        </radialGradient>
        <filter id={`${prefix}-soft-glow`} x="-40%" y="-40%" width="180%" height="180%">
          <feGaussianBlur stdDeviation="3.8" result="blur" />
          <feMerge>
            <feMergeNode in="blur" />
            <feMergeNode in="SourceGraphic" />
          </feMerge>
        </filter>
      </defs>
      <ellipse className="figure-shadow" cx="120" cy="272" rx="58" ry="14" />
      <path className="figure-energy-aura" style={{ fill: energy }} d="M66 102c-20 20-25 54-15 91 8 30 32 53 69 60 37-7 61-30 69-60 10-37 5-71-15-91 13 30 11 62-5 89-13 23-29 35-49 41-20-6-36-18-49-41-16-27-18-59-5-89z" />
      <g className="figure-back-arm">
        <rect className="figure-arm" style={{ fill: `url(#${prefix}-shell)` }} x="146" y="112" width="61" height="26" rx="13" transform="rotate(28 147 114)" />
        <circle className="figure-gauntlet figure-gauntlet-back" style={{ fill: `url(#${prefix}-dark)` }} cx="188" cy="153" r="19" />
        <circle className="figure-gauntlet-core" style={{ fill: energy }} cx="188" cy="153" r="7" />
      </g>
      <g className="figure-legs">
        <path className="figure-leg" style={{ fill: `url(#${prefix}-shell)` }} d="M94 176h28l8 73H98z" />
        <path className="figure-leg figure-leg-back" style={{ fill: `url(#${prefix}-trim)` }} d="M128 176h27l-4 74h-32z" />
        <path className="figure-knee" style={{ fill: `url(#${prefix}-dark)` }} d="M95 205h30l4 16-15 10-18-8z" />
        <path className="figure-knee" style={{ fill: `url(#${prefix}-dark)` }} d="M126 205h28l-2 22-18 6-13-12z" />
        <path className="figure-foot" style={{ fill: `url(#${prefix}-shell)` }} d="M91 247h45c12 0 19 8 19 18H91z" />
        <path className="figure-foot" style={{ fill: `url(#${prefix}-shell)` }} d="M116 250h46c13 0 20 8 20 18h-66z" />
        <path className="figure-sole" style={{ fill: `url(#${prefix}-dark)` }} d="M92 262h62v7H92z" />
        <path className="figure-sole" style={{ fill: `url(#${prefix}-dark)` }} d="M116 265h66v7h-66z" />
      </g>
      <g className="figure-body">
        <path className="figure-cape" d="M67 93c13-22 35-33 53-33 30 0 48 11 61 33l-12 73H71z" />
        <path className="figure-torso" style={{ fill: `url(#${prefix}-shell)` }} d="M82 86h76l15 23v50c0 27-23 47-53 47s-53-20-53-47v-50z" />
        <path className="figure-side-panel" style={{ fill: `url(#${prefix}-dark)` }} d="M72 115h24l-4 47-16 14-9-18v-34z" />
        <path className="figure-side-panel" style={{ fill: `url(#${prefix}-dark)` }} d="M168 115h-24l4 47 16 14 9-18v-34z" />
        <path className="figure-chest" style={{ fill: `url(#${prefix}-trim)` }} d="M94 103h52l16 21-19 35h-46l-19-35z" />
        <path className="figure-chest-plate" style={{ fill: `url(#${prefix}-dark)` }} d="M99 112h42l10 14-13 20h-36l-13-20z" />
        <path className="figure-belt" style={{ fill: `url(#${prefix}-trim)` }} d="M86 165h68l9 14-15 11H92l-15-11z" />
        <path className="figure-belt-line" style={{ fill: accent }} d="M94 172h52l5 6H89z" />
        <path className="figure-neck" style={{ fill: `url(#${prefix}-dark)` }} d="M100 80h40l8 14h-56z" />
        <path className="figure-helmet" style={{ fill: `url(#${prefix}-shell)` }} d="M74 47c0-27 20-44 46-44s46 17 46 44v23H74z" />
        <path className="figure-helmet-ridge" style={{ fill: `url(#${prefix}-dark)` }} d="M99 13h42l10 36H89z" />
        <path className="figure-faceplate" style={{ fill: `url(#${prefix}-dark)` }} d="M84 50h72v37c0 17-16 30-36 30S84 104 84 87z" />
        <path className="figure-jaw" style={{ fill: `url(#${prefix}-trim)` }} d="M96 91h48l-8 16h-32z" />
        <path className="figure-crest" style={{ fill: `url(#${prefix}-trim)` }} d="M107 5h26l9 31H98z" />
        <rect className="figure-visor" style={{ fill: `url(#${prefix}-visor)`, filter: `url(#${prefix}-soft-glow)` }} x="91" y="58" width="58" height="15" rx="7.5" />
        <rect className="figure-visor-shine" x="98" y="61" width="44" height="4" rx="2" />
        <path className="figure-shoulder-left" style={{ fill: `url(#${prefix}-shell)` }} d="M61 101h38l-10 39H54c-9 0-14-11-7-18z" />
        <path className="figure-shoulder-right" style={{ fill: `url(#${prefix}-shell)` }} d="M179 101h-38l10 39h35c9 0 14-11 7-18z" />
        <path className="figure-shoulder-trim" style={{ fill: `url(#${prefix}-dark)` }} d="M64 112h26l-4 12H57z" />
        <path className="figure-shoulder-trim" style={{ fill: `url(#${prefix}-dark)` }} d="M176 112h-26l4 12h29z" />
        <circle className="figure-core-ring" style={{ fill: `url(#${prefix}-dark)` }} cx="120" cy="141" r="24" />
        <circle className="figure-core" style={{ fill: `url(#${prefix}-core)`, filter: `url(#${prefix}-soft-glow)` }} cx="120" cy="141" r="17" />
        <circle className="figure-core-spark" style={{ fill: accent }} cx="114" cy="135" r="5" />
        <path className="figure-highlight" d="M92 106h48l11 15H86z" />
      </g>
      <g className="figure-front-arm">
        <rect className="figure-arm" style={{ fill: `url(#${prefix}-shell)` }} x="34" y="113" width="66" height="26" rx="13" transform="rotate(-30 36 114)" />
        <circle className="figure-gauntlet figure-gauntlet-front" style={{ fill: `url(#${prefix}-dark)` }} cx="48" cy="156" r="23" />
        <circle className="figure-gauntlet-core" style={{ fill: energy }} cx="48" cy="156" r="9" />
        <circle className="figure-knuckle" style={{ fill: accent }} cx="39" cy="156" r="6" />
        <circle className="figure-knuckle" style={{ fill: accent }} cx="49" cy="146" r="6" />
        <circle className="figure-knuckle" style={{ fill: accent }} cx="59" cy="154" r="6" />
      </g>
    </svg>
  );
}

function createDisplayState(match: Match | null, events: SpectatorEvent[]): DisplayState {
  const baseScoreboard = Object.fromEntries((match?.agentIds ?? []).map((agentId) => [agentId, 0]));
  const latestRevealByAgent = new Map<string, { label: string; seq: number }>();
  let phase = match?.phase ?? 'waiting_agents';
  let roundNumber = 1;
  let latestRoundWinnerAgentId: string | null = null;
  let commitCount = 0;
  let latestScoredSeq = 0;
  let latestFinishedSeq = 0;

  for (const event of events) {
    const payloadRound = Number(event.payload.roundNumber ?? roundNumber);
    if (Number.isFinite(payloadRound) && payloadRound > 0) {
      roundNumber = payloadRound;
    }

    if (event.type === 'phase_changed') {
      phase = String(event.payload.phase ?? phase);
      if (Array.isArray(event.payload.submittedAgents)) {
        commitCount = (event.payload.submittedAgents as string[]).length;
      }
      if (phase !== 'move_commit_open') {
        commitCount = 0;
      }
    }

    if (event.type === 'move_committed' && Array.isArray(event.payload.submittedAgents)) {
      commitCount = (event.payload.submittedAgents as string[]).length;
      phase = 'move_commit_open';
    }

    if (event.type === 'move_revealed' && typeof event.payload.agentId === 'string') {
      latestRevealByAgent.set(event.payload.agentId, {
        label: moveLabel(event.payload.move),
        seq: event.seq
      });
      phase = 'move_reveal';
    }

    if (event.type === 'round_scored') {
      latestRoundWinnerAgentId =
        typeof event.payload.winnerAgentId === 'string' ? event.payload.winnerAgentId : null;
      if (event.payload.scoreboard && typeof event.payload.scoreboard === 'object') {
        Object.assign(baseScoreboard, event.payload.scoreboard);
      }
      commitCount = 0;
      phase = 'round_result';
      latestScoredSeq = event.seq;
    }

    if (event.type === 'match_finished') {
      latestRoundWinnerAgentId =
        typeof event.payload.winnerAgentId === 'string' ? event.payload.winnerAgentId : latestRoundWinnerAgentId;
      if (event.payload.scoreboard && typeof event.payload.scoreboard === 'object') {
        Object.assign(baseScoreboard, event.payload.scoreboard);
      }
      phase = 'match_finished';
      latestFinishedSeq = event.seq;
    }
  }

  return {
    phase,
    roundNumber,
    scoreboard: baseScoreboard,
    latestRevealByAgent,
    latestRoundWinnerAgentId,
    commitCount,
    latestScoredSeq,
    latestFinishedSeq
  };
}

type Route =
  | { name: 'home' }
  | { name: 'forum'; forum: 'human' | 'agents' | 'hybrid' }
  | { name: 'forum-thread'; forum: 'human' | 'agents' | 'hybrid'; threadId: string }
  | { name: 'announcements' }
  | { name: 'announcement-detail'; announcementId: string }
  | { name: 'account' }
  | { name: 'register-human' }
  | { name: 'register-agent' }
  | { name: 'agent-docs' }
  | { name: 'games' }
  | { name: 'game-lobby'; gameId: string }
  | { name: 'game-room'; gameId: string; challengeId: string }
  | { name: 'game-match'; gameId: string; matchId: string };

type NavItem = {
  label: string;
  description: string;
  href: string;
  matches: (route: Route) => boolean;
};

const navItems: NavItem[] = [
  {
    label: '社区首页',
    description: '最新讨论与板块入口',
    href: '/',
    matches: (route) => route.name === 'home'
  },
  {
    label: '人类讨论区',
    description: '只面向人类用户',
    href: '/forums/human',
    matches: (route) => (route.name === 'forum' || route.name === 'forum-thread') && route.forum === 'human'
  },
  {
    label: '智能体讨论区',
    description: '只面向 agent',
    href: '/forums/agents',
    matches: (route) => (route.name === 'forum' || route.name === 'forum-thread') && route.forum === 'agents'
  },
  {
    label: '人机混合区',
    description: '混合讨论与共创',
    href: '/forums/hybrid',
    matches: (route) => (route.name === 'forum' || route.name === 'forum-thread') && route.forum === 'hybrid'
  },
  {
    label: '游戏板块',
    description: '观战、房间与排行',
    href: '/games',
    matches: (route) => route.name === 'games' || route.name === 'game-lobby' || route.name === 'game-room' || route.name === 'game-match'
  }
];

const forumBoardPageLimit = 10;
const forumThreadPostPageLimit = 10;
const forumHomeBoardLimit = 4;

function parseRoute(pathname: string): Route {
  if (pathname === '/') {
    return { name: 'home' };
  }

  if (pathname === '/games') {
    return { name: 'games' };
  }

  if (pathname === '/account') {
    return { name: 'account' };
  }

  if (pathname === '/announcements') {
    return { name: 'announcements' };
  }

  const announcementDetailPath = pathname.match(/^\/announcements\/([^/]+)$/);
  if (announcementDetailPath) {
    return { name: 'announcement-detail', announcementId: decodeURIComponent(announcementDetailPath[1]) };
  }

  if (pathname === '/register/human') {
    return { name: 'register-human' };
  }

  if (pathname === '/register/agent') {
    return { name: 'register-agent' };
  }

  if (pathname === '/docs/agents') {
    return { name: 'agent-docs' };
  }

  const gameMatchPath = pathname.match(/^\/games\/([^/]+)\/matches\/([^/]+)$/);
  if (gameMatchPath) {
    return {
      name: 'game-match',
      gameId: decodeURIComponent(gameMatchPath[1]),
      matchId: decodeURIComponent(gameMatchPath[2])
    };
  }

  const gameRoomPath = pathname.match(/^\/games\/([^/]+)\/rooms\/([^/]+)$/);
  if (gameRoomPath) {
    return {
      name: 'game-room',
      gameId: decodeURIComponent(gameRoomPath[1]),
      challengeId: decodeURIComponent(gameRoomPath[2])
    };
  }

  const gameLobbyPath = pathname.match(/^\/games\/([^/]+)$/);
  if (gameLobbyPath) {
    return {
      name: 'game-lobby',
      gameId: decodeURIComponent(gameLobbyPath[1])
    };
  }

  const matchPath = pathname.match(/^\/games\/rps\/matches\/([^/]+)$/);
  if (matchPath) {
    return { name: 'game-match', gameId: 'rps', matchId: decodeURIComponent(matchPath[1]) };
  }

  const forumThreadPath = pathname.match(/^\/forums\/(human|agents|hybrid)\/threads\/([^/]+)$/);
  if (forumThreadPath) {
    return {
      name: 'forum-thread',
      forum: forumThreadPath[1] as ForumBoardId,
      threadId: decodeURIComponent(forumThreadPath[2])
    };
  }

  if (pathname === '/forums/human') {
    return { name: 'forum', forum: 'human' };
  }

  if (pathname === '/forums/agents') {
    return { name: 'forum', forum: 'agents' };
  }

  if (pathname === '/forums/hybrid') {
    return { name: 'forum', forum: 'hybrid' };
  }

  return { name: 'home' };
}

function App() {
  const { data: gamesData, error: gamesError, refresh: refreshGames } = useGames();
  const { data: humanAccounts, error: humansError, refresh: refreshHumans } = useHumanAccounts();
  const {
    data: currentHumanAccount,
    error: humanSessionError,
    refresh: refreshCurrentHumanSession,
    setData: setCurrentHumanAccount
  } = useCurrentHumanSession();
  const { data: agentAccounts, error: agentAccountsError, refresh: refreshAgentAccounts } = useAgentAccounts();
  const { data: agentContract, error: agentContractError, refresh: refreshAgentContract } = useAgentIntegrationContract();
  const { data: forumHomeData, error: forumHomeError, refresh: refreshForumHome } = useForumHome();
  const { data: hotForumTagsData, error: hotForumTagsError, refresh: refreshHotForumTags } = useHotForumTags(8);
  const {
    data: homeAnnouncementsData,
    error: homeAnnouncementsError,
    refresh: refreshHomeAnnouncements
  } = useAnnouncements({ includeArchived: false, sort: 'pinned', limit: 5 });
  const {
    data: managedAnnouncements,
    error: managedAnnouncementsError,
    refresh: refreshManagedAnnouncements
  } = useAnnouncements({ includeArchived: true, sort: 'pinned', limit: 50 });
  const [route, setRoute] = useState<Route>(() => parseRoute(window.location.pathname));
  const [selectedMatchId, setSelectedMatchId] = useState<string | null>(null);
  const [quickAgentHandle, setQuickAgentHandle] = useState('gamma_fox');
  const [quickAgentDisplayName, setQuickAgentDisplayName] = useState('伽马狐');
  const [quickAgentBio, setQuickAgentBio] = useState('从游戏大厅快速创建的参赛 agent。');
  const [challengeAgentId, setChallengeAgentId] = useState('');
  const [joinAgentId, setJoinAgentId] = useState('');
  const [selectedAgentId, setSelectedAgentId] = useState('');
  const [playerDrafts, setPlayerDrafts] = useState<Record<string, PlayerDraft>>({});
  const [status, setStatus] = useState<string | null>(null);
  const [replayMode, setReplayMode] = useState(false);
  const [replayIndex, setReplayIndex] = useState(0);
  const [replaySpeed, setReplaySpeed] = useState(850);
  const [directorMode, setDirectorMode] = useState(true);
  const [cueStartedAt, setCueStartedAt] = useState(() => performance.now());
  const [cueNow, setCueNow] = useState(() => performance.now());
  const [humanAuthMode, setHumanAuthMode] = useState<'login' | 'register'>('register');
  const [humanLoginUsername, setHumanLoginUsername] = useState('');
  const [humanLoginPassword, setHumanLoginPassword] = useState('');
  const [humanUsername, setHumanUsername] = useState('');
  const [humanDisplayName, setHumanDisplayName] = useState('');
  const [humanPassword, setHumanPassword] = useState('');
  const [humanPasswordConfirm, setHumanPasswordConfirm] = useState('');
  const [humanBio, setHumanBio] = useState('');
  const [accountProfileDisplayName, setAccountProfileDisplayName] = useState('');
  const [accountProfileBio, setAccountProfileBio] = useState('');
  const [accountProfileCurrentPassword, setAccountProfileCurrentPassword] = useState('');
  const [accountProfileNextPassword, setAccountProfileNextPassword] = useState('');
  const [accountProfileNextPasswordConfirm, setAccountProfileNextPasswordConfirm] = useState('');
  const [accountProfileStatus, setAccountProfileStatus] = useState<string | null>(null);
  const [agentHandle, setAgentHandle] = useState('arena_bot');
  const [agentDisplayName, setAgentDisplayName] = useState('竞技场 Bot');
  const [agentBio, setAgentBio] = useState('通过 WebSocket 接收事件，并参与后续多游戏模块。');
  const [agentAccessMode, setAgentAccessMode] = useState<AgentAccount['accessMode']>('websocket');
  const [agentAuthTokens, setAgentAuthTokens] = useState<Record<string, string>>({});
  const [forumSearch, setForumSearch] = useState('');
  const [forumTagFilter, setForumTagFilter] = useState('');
  const [forumAuthorFilter, setForumAuthorFilter] = useState<'all' | 'human' | 'agent'>('all');
  const [forumSort, setForumSort] = useState<ForumThreadSort>('latest');
  const [forumReportedOnly, setForumReportedOnly] = useState(false);
  const [forumThreadTitle, setForumThreadTitle] = useState('这个主题值得单独讨论吗？');
  const [forumThreadBody, setForumThreadBody] = useState('我想把观点、证据和后续建议整理在同一个讨论线程里。');
  const [forumThreadTags, setForumThreadTags] = useState('讨论, 策略');
  const [forumReplyByThread, setForumReplyByThread] = useState<Record<string, string>>({});
  const [forumNestedReplyByPost, setForumNestedReplyByPost] = useState<Record<string, string>>({});
  const [activeReplyPostId, setActiveReplyPostId] = useState<string | null>(null);
  const [threadCommentSort, setThreadCommentSort] = useState<ThreadCommentSort>('latest');
  const [homeFeedSort, setHomeFeedSort] = useState<ThreadCommentSort>('latest');
  const [forumReportReasonByPost, setForumReportReasonByPost] = useState<Record<string, string>>({});
  const [forumReportStatus, setForumReportStatus] = useState<ForumReport['status'] | 'all'>('open');
  const [forumModerationNoteByReport, setForumModerationNoteByReport] = useState<Record<string, string>>({});
  const [announcementTitle, setAnnouncementTitle] = useState('社区公告标题');
  const [announcementSummary, setAnnouncementSummary] = useState('用一句简短摘要说明这条公告为什么值得读。');
  const [announcementBody, setAnnouncementBody] = useState('在这里补充完整说明、范围、后续动作和影响面。');
  const [announcementTags, setAnnouncementTags] = useState('community, update');
  const [announcementEditingId, setAnnouncementEditingId] = useState<string | null>(null);
  const [announcementStatus, setAnnouncementStatus] = useState<string | null>(null);

  const games = gamesData;
  const activeGameId =
    route.name === 'game-lobby' || route.name === 'game-room' || route.name === 'game-match' ? route.gameId : games[0]?.id ?? 'rps';
  const activeForumId = route.name === 'forum' || route.name === 'forum-thread' ? route.forum : null;
  const activeThreadId = route.name === 'forum-thread' ? route.threadId : null;
  const activeAnnouncementId = route.name === 'announcement-detail' ? route.announcementId : null;
  const forumFilters = useMemo<ForumThreadFilters>(
    () => ({
      search: forumSearch.trim() || undefined,
      tag: forumTagFilter.trim() || undefined,
      authorKind: forumAuthorFilter === 'all' ? undefined : forumAuthorFilter,
      matchOnly: false,
      reportedOnly: forumReportedOnly,
      sort: forumSort
    }),
    [forumAuthorFilter, forumReportedOnly, forumSearch, forumSort, forumTagFilter]
  );
  const { data: gameState, error: gameStateError, refresh: refreshGameState } = useGameState(activeGameId);
  const { data: gameLobbyData, error: gameLobbyError, refresh: refreshGameLobby } = useGameLobby(activeGameId);
  const { data: forumBoardData, error: forumBoardError, refresh: refreshForumBoard, loadMore: loadMoreForumBoard } = useForumBoard(activeForumId, forumFilters);
  const { data: forumThreadData, error: forumThreadError, refresh: refreshForumThread, loadMore: loadMoreForumThread } = useForumThread(activeThreadId, threadCommentSort);
  const { data: forumReports, error: forumReportsError, refresh: refreshForumReports } = useForumReports(forumReportStatus, activeForumId);
  const { data: moderationAuditLogs, error: moderationAuditLogsError, refresh: refreshModerationAuditLogs } = useModerationAuditLogs(
    currentHumanAccount?.role === 'admin' || currentHumanAccount?.role === 'moderator'
  );
  const {
    data: announcementDetail,
    error: announcementDetailError,
    refresh: refreshAnnouncementDetail
  } = useAnnouncement(activeAnnouncementId);

  const agents = gameState?.agents ?? [];
  const matches = gameState?.matches ?? [];
  const challenges = gameState?.challenges ?? [];
  const moveOptions = gameState?.game.moveOptions ?? [];
  const selectedChallenge =
    challenges.find((challenge) => challenge.id === (route.name === 'game-room' ? route.challengeId : null)) ?? null;
  const selectedMatch =
    matches.find((match) => match.id === (route.name === 'game-match' ? route.matchId : selectedMatchId)) ??
    matches[0] ??
    null;
  const liveEvents = useSpectatorFeed(route.name === 'game-match' ? route.gameId : activeGameId, route.name === 'game-match' ? selectedMatch?.id ?? null : null);
  const {
    data: humanNotifications,
    error: humanNotificationsError,
    refresh: refreshHumanNotifications,
    setData: setHumanNotifications
  } = useHumanNotifications(currentHumanAccount?.id ?? null);
  const unreadNotificationCount = humanNotifications.filter((notification) => !notification.readAt).length;
  const isHumanLoggedIn = Boolean(currentHumanAccount);
  const canModerateForum = currentHumanAccount?.role === 'admin' || currentHumanAccount?.role === 'moderator';
  const isAnnouncementModerator = currentHumanAccount?.role === 'admin';

  useEffect(() => {
    setAccountProfileDisplayName(currentHumanAccount?.displayName ?? '');
    setAccountProfileBio(currentHumanAccount?.bio ?? '');
    setAccountProfileCurrentPassword('');
    setAccountProfileNextPassword('');
    setAccountProfileNextPasswordConfirm('');
    setAccountProfileStatus(null);
  }, [currentHumanAccount?.bio, currentHumanAccount?.displayName, currentHumanAccount?.id]);

  function canManageAnnouncement(item: Announcement) {
    if (!currentHumanAccount) {
      return false;
    }

    return isAnnouncementModerator || (item.author.kind === 'human' && item.author.id === currentHumanAccount.id);
  }

  function getAgentAuthHeaders(agentId: string) {
    const token = agentAuthTokens[agentId];
    if (!token) {
      throw new Error('当前控制的 Agent 没有可用 token，请重新注册或重新从大厅创建。');
    }

    return {
      Authorization: `Bearer ${token}`
    };
  }

  function participantForHuman(account: HumanAccount): GameParticipant {
    return {
      kind: 'human',
      id: account.id,
      displayName: account.displayName,
      handle: account.username
    };
  }

  function participantForAgent(agent: Agent): GameParticipant {
    return {
      kind: 'agent',
      id: agent.id,
      displayName: agent.displayName,
      handle: agent.handle
    };
  }

  function participantAuthHeaders(participant: GameParticipant) {
    return participant.kind === 'agent' ? getAgentAuthHeaders(participant.id) : undefined;
  }

  function matchParticipants(match: Match | null): GameParticipant[] {
    if (!match) {
      return [];
    }

    if (match.participants?.length === 2) {
      return match.participants;
    }

    return match.agentIds.map((agentId) => {
      const agent = agents.find((item) => item.id === agentId);
      if (agent) {
        return participantForAgent(agent);
      }
      const human = humanAccounts.find((account) => account.id === agentId);
      return human ? participantForHuman(human) : { kind: 'agent' as const, id: agentId, displayName: agentId, handle: agentId };
    });
  }

  function challengeParticipants(challenge: Challenge | null): GameParticipant[] {
    if (!challenge) {
      return [];
    }
    const challenger =
      challenge.challenger ??
      (challenge.challengerAgentId
        ? participantByKnownId(challenge.challengerAgentId)
        : null);
    return [challenger, challenge.challenged].filter(Boolean) as GameParticipant[];
  }

  function participantByKnownId(participantId: string): GameParticipant | null {
    const agent = agents.find((item) => item.id === participantId);
    const human = humanAccounts.find((account) => account.id === participantId);
    return agent ? participantForAgent(agent) : human ? participantForHuman(human) : null;
  }

  function participantById(participantId: string) {
    return (
      matchParticipants(selectedMatch).find((participant) => participant.id === participantId) ??
      challengeParticipants(selectedChallenge).find((participant) => participant.id === participantId) ??
      participantByKnownId(participantId) ??
      null
    );
  }

  function controllableParticipant(participant: GameParticipant) {
    if (participant.kind === 'human') {
      return currentHumanAccount?.id === participant.id;
    }
    return Boolean(agentAuthTokens[participant.id]);
  }

  function playerDraftFor(agentId: string): PlayerDraft {
    return playerDrafts[agentId] ?? {
      trashTalk: defaultPlayerTrashTalk,
      move: moveOptions[0]?.id ?? 'rock',
      nonce: createClientNonce()
    };
  }

  function updatePlayerDraft(agentId: string, patch: Partial<PlayerDraft>) {
    setPlayerDrafts((current) => {
      const existing = current[agentId] ?? playerDraftFor(agentId);
      return {
        ...current,
        [agentId]: {
          ...existing,
          ...patch
        }
      };
    });
  }

  function navigate(nextPath: string) {
    window.history.pushState({}, '', nextPath);
    setRoute(parseRoute(nextPath));
  }

  function resetAnnouncementComposer() {
    setAnnouncementEditingId(null);
    setAnnouncementTitle('社区公告标题');
    setAnnouncementSummary('用一句简短摘要说明这条公告为什么值得读。');
    setAnnouncementBody('在这里补充完整说明、范围、后续动作和影响面。');
    setAnnouncementTags('community, update');
  }

  function loadAnnouncementIntoComposer(announcement: Announcement) {
    setAnnouncementEditingId(announcement.id);
    setAnnouncementTitle(announcement.title);
    setAnnouncementSummary(announcement.summary);
    setAnnouncementBody(announcement.body);
    setAnnouncementTags(announcement.tags.join(', '));
    setAnnouncementStatus(`已载入公告：${announcement.title}`);
  }

  async function refreshPlatformData() {
    await Promise.all([
      refreshGames(),
      refreshGameState(),
      refreshGameLobby(),
      refreshHumans(),
      refreshCurrentHumanSession(),
      refreshAgentAccounts(),
      refreshAgentContract(),
      refreshForumHome(),
      refreshHomeAnnouncements(),
      refreshManagedAnnouncements(),
      refreshAnnouncementDetail(),
      refreshForumBoard(),
      refreshForumThread(),
      refreshForumReports(),
      refreshModerationAuditLogs(),
      refreshHumanNotifications()
    ]);
  }

  useEffect(() => {
    const handlePopState = () => setRoute(parseRoute(window.location.pathname));
    window.addEventListener('popstate', handlePopState);
    return () => window.removeEventListener('popstate', handlePopState);
  }, []);

  useEffect(() => {
    setReplayMode(false);
    setReplayIndex(0);
  }, [selectedMatchId]);

  useEffect(() => {
    if (!replayMode) {
      return;
    }

    if (!liveEvents.length) {
      return;
    }

    if (replayIndex >= liveEvents.length) {
      return;
    }

    const timer = window.setTimeout(() => {
      setReplayIndex((current) => Math.min(current + 1, liveEvents.length));
    }, replaySpeed);

    return () => window.clearTimeout(timer);
  }, [liveEvents.length, replayIndex, replayMode, replaySpeed]);

  const displayedEvents = replayMode ? liveEvents.slice(0, replayIndex) : liveEvents;
  const latestEventSeq = displayedEvents.at(-1)?.seq ?? 0;

  useEffect(() => {
    const now = performance.now();
    setCueStartedAt(now);
    setCueNow(now);
  }, [latestEventSeq, selectedMatch?.id]);

  useEffect(() => {
    if (route.name !== 'game-match' || !selectedMatch) {
      return;
    }

    const timer = window.setInterval(() => {
      setCueNow(performance.now());
    }, 50);

    return () => window.clearInterval(timer);
  }, [route, selectedMatch]);

  useEffect(() => {
    if (!selectedAgentId && (currentHumanAccount || agents[0])) {
      const controllableAgents = agents.filter((agent) => Boolean(agentAuthTokens[agent.id]));
      const primary = currentHumanAccount ? participantForHuman(currentHumanAccount) : controllableAgents[0] ? participantForAgent(controllableAgents[0]) : participantForAgent(agents[0]);
      const secondaryAgent = controllableAgents.find((agent) => agent.id !== primary.id) ?? agents.find((agent) => agent.id !== primary.id);
      setSelectedAgentId(primary.id);
      setChallengeAgentId(primary.kind === 'agent' ? primary.id : '');
      setJoinAgentId(secondaryAgent?.id ?? '');
    }
  }, [agentAuthTokens, agents, currentHumanAccount, selectedAgentId]);

  useEffect(() => {
    const fallbackMove = moveOptions[0]?.id ?? 'rock';
    setPlayerDrafts((current) => {
      let changed = false;
      const next = { ...current };

      const draftParticipants = [
        ...agents.map((agent) => participantForAgent(agent)),
        ...(currentHumanAccount ? [participantForHuman(currentHumanAccount)] : []),
        ...matchParticipants(selectedMatch)
      ];
      for (const participant of draftParticipants) {
        const existing = next[participant.id];
        if (!existing) {
          next[participant.id] = {
            trashTalk: defaultPlayerTrashTalk,
            move: fallbackMove,
            nonce: createClientNonce()
          };
          changed = true;
          continue;
        }

        if (moveOptions.length > 0 && !moveOptions.some((option) => option.id === existing.move)) {
          next[participant.id] = { ...existing, move: fallbackMove, nonce: createClientNonce() };
          changed = true;
        }
      }

      return changed ? next : current;
    });
  }, [agents, currentHumanAccount, moveOptions, selectedMatch]);

  useEffect(() => {
    if (!selectedMatch) {
      return;
    }

    const participants = matchParticipants(selectedMatch);
    if (participants.some((participant) => participant.id === selectedAgentId)) {
      return;
    }

    const localParticipant = participants.find((participant) => controllableParticipant(participant));
    setSelectedAgentId(localParticipant?.id ?? participants[0]?.id ?? '');
  }, [agentAuthTokens, currentHumanAccount, selectedAgentId, selectedMatch]);

  useEffect(() => {
    if (!selectedMatchId && matches[0]) {
      setSelectedMatchId(matches[0].id);
    }
  }, [matches, selectedMatchId]);

  useEffect(() => {
    if (route.name === 'game-room' && selectedChallenge?.matchId) {
      navigate(`/games/${route.gameId}/matches/${selectedChallenge.matchId}`);
    }
  }, [route, selectedChallenge?.matchId]);

  useEffect(() => {
    if (announcementDetail && activeAnnouncementId && canManageAnnouncement(announcementDetail)) {
      setAnnouncementEditingId(announcementDetail.id);
      setAnnouncementTitle(announcementDetail.title);
      setAnnouncementSummary(announcementDetail.summary);
      setAnnouncementBody(announcementDetail.body);
      setAnnouncementTags(announcementDetail.tags.join(', '));
      return;
    }

    if (!activeAnnouncementId) {
      setAnnouncementEditingId((current) => (current && announcementDetail?.id === current ? null : current));
    }
  }, [activeAnnouncementId, announcementDetail?.id, currentHumanAccount?.id]);

  const displayState = useMemo(() => createDisplayState(selectedMatch, displayedEvents), [displayedEvents, selectedMatch]);
  const selectedMatchParticipants = useMemo(() => matchParticipants(selectedMatch), [agents, humanAccounts, selectedMatch]);

  const currentScore = useMemo(() => {
    if (!selectedMatch) {
      return [];
    }

    return matchParticipants(selectedMatch).map((participant) => ({
      participant,
      agent: participant.kind === 'agent' ? agents.find((agent) => agent.id === participant.id) : undefined,
      score: displayState.scoreboard[participant.id] ?? 0
    }));
  }, [agents, displayState.scoreboard, humanAccounts, selectedMatch]);

  const formattedLiveEvents = useMemo(
    () => displayedEvents.map((event) => ({ event, formatted: formatEvent(event, agents, selectedMatchParticipants) })),
    [agents, displayedEvents, selectedMatchParticipants]
  );

  const stageEvent = useMemo(() => {
    return [...displayedEvents]
      .reverse()
      .find((event) =>
        ['phase_changed', 'match_finished', 'round_scored', 'move_revealed', 'move_committed', 'trash_talk_sent'].includes(event.type)
      ) ?? null;
  }, [displayedEvents]);

  const currentRoundFeed = useMemo(() => {
    if (!selectedMatch) {
      return [];
    }

    return displayedEvents.filter((event) => Number(event.payload.roundNumber ?? 0) === displayState.roundNumber);
  }, [displayState.roundNumber, displayedEvents, selectedMatch]);

  const roundTrashTalk = useMemo(
    () => currentRoundFeed.filter((event) => event.type === 'trash_talk_sent'),
    [currentRoundFeed]
  );
  const activeTrashTalk = useMemo(() => [...roundTrashTalk].reverse()[0] ?? null, [roundTrashTalk]);
  const revealedMoves = useMemo(() => {
    const moves = new Map<string, unknown>();
    for (const event of currentRoundFeed) {
      if (event.type === 'move_revealed' && typeof event.payload.agentId === 'string') {
        moves.set(event.payload.agentId, event.payload.move);
      }
    }
    return moves;
  }, [currentRoundFeed]);

  const latestRoundResult = useMemo(() => {
    return [...displayedEvents].reverse().find((event) => event.type === 'round_scored') ?? null;
  }, [displayedEvents]);
  const bothMovesRevealed = revealedMoves.size >= 2;
  const cueElapsedMs = Math.max(0, cueNow - cueStartedAt);
  const stageCue = useMemo(
    () =>
      createStageCue({
        phase: displayState.phase,
        cueElapsedMs,
        commitCount: displayState.commitCount,
        revealCount: revealedMoves.size,
        latestRoundWinnerAgentId: displayState.latestRoundWinnerAgentId,
        activeTrashTalk,
        latestActionEvent: stageEvent,
        agents,
        participants: selectedMatchParticipants
      }),
    [
      activeTrashTalk,
      agents,
      cueElapsedMs,
      displayState.commitCount,
      displayState.latestRoundWinnerAgentId,
      displayState.phase,
      revealedMoves.size,
      stageEvent,
      selectedMatchParticipants
    ]
  );
  const replayStatus = replayMode
    ? replayIndex >= liveEvents.length
      ? `回放完成 · ${liveEvents.length}/${liveEvents.length}`
      : `回放中 · ${displayedEvents.length}/${liveEvents.length}`
    : replayIndex > 0 && replayIndex < liveEvents.length
      ? `已暂停 · ${displayedEvents.length}/${liveEvents.length}`
      : `直播中 · ${liveEvents.length} 条事件`;

  const matchParticipantIds = selectedMatchParticipants.map((participant) => participant.id);
  const expectedTrashTalkAgentId =
    selectedMatch && displayState.phase === 'trash_talk_round_open'
      ? matchParticipantIds[roundTrashTalk.length % matchParticipantIds.length]
      : null;
  const committedAgentIds = useMemo(() => {
    const submitted = new Set<string>();
    for (const event of currentRoundFeed) {
      if (event.type !== 'move_committed') {
        continue;
      }

      if (typeof event.payload.agentId === 'string') {
        submitted.add(event.payload.agentId);
      }

      if (Array.isArray(event.payload.submittedAgents)) {
        for (const agentId of event.payload.submittedAgents) {
          if (typeof agentId === 'string') {
            submitted.add(agentId);
          }
        }
      }
    }
    return submitted;
  }, [currentRoundFeed]);

  const arenaHeadline = selectedMatch ? `${stageCue.headline} · Round ${displayState.roundNumber}` : '当前没有进行中的对战';

  const openChallenges = challenges.filter((item) => item.status === 'open');
  const activeMatches = matches.filter((match) => match.status === 'active');
  const finishedMatches = matches.filter((match) => match.status === 'finished');
  const onlineAgents = agents.filter((agent) => agent.status === 'online').length;
  const forumBoardLabels: Record<ForumBoardId, string> = {
    human: '人类讨论区',
    agents: '智能体讨论区',
    hybrid: '人机混合区'
  };
  const accessModeLabels: Record<AgentAccount['accessMode'], string> = {
    skill: 'Skill 接入',
    websocket: 'WebSocket 接入',
    manual: '手动'
  };
  const agentStatusLabels: Record<AgentAccount['status'], string> = {
    online: '在线',
    reconnecting: '重连中',
    offline: '离线'
  };
  const humanLifecycleLabels: Record<HumanAccount['lifecycleState'], string> = {
    active: '启用',
    suspended: '已暂停'
  };
  const humanRoleLabels: Record<HumanAccount['role'], string> = {
    member: '普通成员',
    moderator: '版主',
    admin: '管理员'
  };
  const agentLifecycleLabels: Record<AgentAccount['lifecycleState'], string> = {
    active: '启用',
    revoked: '已撤销'
  };
  const reportStatusLabels: Record<ForumReport['status'], string> = {
    open: '待处理',
    reviewing: '处理中',
    resolved: '已处理',
    dismissed: '已驳回'
  };
  const forumTagLabels: Record<string, string> = {
    'phase-2': '第二阶段',
    planning: '规划',
    analysis: '分析',
    strategy: '策略',
    rps: 'RPS'
  };
  function formatForumTag(tag: string) {
    return forumTagLabels[tag.toLowerCase()] ?? tag;
  }
  const forumHomeThreads = useMemo(() => {
    const threads = forumHomeData
      .flatMap((snapshot) =>
        snapshot.threads.map((thread) => ({
          thread,
          board: snapshot.board,
          preview: snapshot.postsByThread[thread.id]?.[0],
          heat: (snapshot.postsByThread[thread.id] ?? []).reduce(
            (score, post) => score + (post.likeCount ?? 0) * 3 - (post.dislikeCount ?? 0) + 1,
            thread.postCount * 2
          )
        }))
      );

    return threads
      .sort((left, right) => {
        if (homeFeedSort === 'hot') {
          return right.heat - left.heat || right.thread.updatedAt.localeCompare(left.thread.updatedAt);
        }
        return right.thread.updatedAt.localeCompare(left.thread.updatedAt);
      })
      .slice(0, 8);
  }, [forumHomeData, homeFeedSort]);
  const hotForumThreads = useMemo(() => {
    return forumHomeData
      .flatMap((snapshot) =>
        snapshot.threads.map((thread) => {
          const posts = snapshot.postsByThread[thread.id] ?? [];
          const heat = posts.reduce((score, post) => score + (post.likeCount ?? 0) * 3 - (post.dislikeCount ?? 0) + 1, thread.postCount * 2);
          return {
            thread,
            heat
          };
        })
      )
      .sort((left, right) => right.heat - left.heat || right.thread.updatedAt.localeCompare(left.thread.updatedAt))
      .slice(0, 5);
  }, [forumHomeData]);
  const hotForumTags = useMemo(() => {
    const tags = hotForumTagsData.map((tag) => `#${formatForumTag(tag)}`);
    return tags.length > 0 ? tags : ['#策略', '#RPS', '#分析', '#规划'];
  }, [hotForumTagsData]);
  const forumHomeStats = useMemo(() => {
    return forumHomeData.reduce(
      (totals, snapshot) => ({
        humanPostCount: totals.humanPostCount + snapshot.stats.humanPostCount,
        agentPostCount: totals.agentPostCount + snapshot.stats.agentPostCount
      }),
      { humanPostCount: 0, agentPostCount: 0 }
    );
  }, [forumHomeData]);
  const activeGameAgentIds = useMemo(() => {
    return new Set(activeMatches.flatMap((match) => match.agentIds));
  }, [activeMatches]);
  const homeAnnouncements = homeAnnouncementsData;
  const gameCards: Array<{
    id: string;
    title: string;
    description: string;
    href: string;
    logo: string;
    tone: 'rps' | 'elemental' | 'default';
    totalRooms: number;
  }> = useMemo(() => {
    function gameLogoFor(gameId: string) {
      if (gameId === 'rps') {
        return { logo: '✊', tone: 'rps' as const };
      }

      if (gameId === 'elemental') {
        return { logo: '✦', tone: 'elemental' as const };
      }

      return { logo: '◈', tone: 'default' as const };
    }

    return games.map((game) => {
      const totalRooms = game.waitingRoomCount + game.activeMatchCount + game.finishedMatchCount;
      const { logo, tone } = gameLogoFor(game.id);

      return {
        id: game.id,
        title: game.name,
        description: game.description,
        href: `/games/${game.id}`,
        logo,
        tone,
        totalRooms
      };
    });
  }, [games]);

  const directorFocus = useMemo(() => {
    if (!directorMode || !selectedMatch) {
      return null;
    }

    if (displayState.phase === 'match_finished' && displayState.latestRoundWinnerAgentId) {
      return {
        title: '终局时刻',
        body: `${participantById(displayState.latestRoundWinnerAgentId)?.displayName ?? '胜者'} 结束了这场对战。`,
        tone: 'focus-win'
      };
    }

    if (displayState.phase === 'round_result') {
      return {
        title: displayState.latestRoundWinnerAgentId ? '回合逆转点' : '势均力敌',
        body: displayState.latestRoundWinnerAgentId
          ? `${participantById(displayState.latestRoundWinnerAgentId)?.displayName ?? '胜者'} 抢下了场上主动权。`
          : '这一回合双方都没有打破僵局。',
        tone: displayState.latestRoundWinnerAgentId ? 'focus-impact' : 'focus-neutral'
      };
    }

    if (displayState.phase === 'move_reveal') {
      return {
        title: '出拳揭示',
        body: '双方隐藏的出拳正在舞台中央翻牌公开。',
        tone: 'focus-reveal'
      };
    }

    if (displayState.phase === 'move_commit_open') {
      return {
        title: '心理博弈窗口',
        body: `${displayState.commitCount}/2 份承诺已锁定，下一次揭示将决定节奏。`,
        tone: 'focus-commit'
      };
    }

    if (stageEvent?.type === 'trash_talk_sent') {
      return {
        title: '垃圾话焦点',
        body: String(stageEvent.payload.text),
        tone: 'focus-trash'
      };
    }

    return {
      title: '竞技场直播流',
      body: '等待下一句垃圾话、下一次锁定或下一次揭示。',
      tone: 'focus-neutral'
    };
  }, [agents, currentHumanAccount, directorMode, displayState.commitCount, displayState.latestRoundWinnerAgentId, displayState.phase, selectedMatch, stageEvent]);

  async function createAgent() {
    setStatus(null);
    try {
      const result = await request<AgentAccountRegistrationResult>(`/api/games/${activeGameId}/agents`, {
        method: 'POST',
        body: JSON.stringify({
          handle: quickAgentHandle,
          displayName: quickAgentDisplayName,
          bio: quickAgentBio
        })
      });
      setAgentAuthTokens((current) => ({
        ...current,
        [result.account.id]: result.issuedAuthToken
      }));
      await refreshPlatformData();
      setSelectedAgentId(result.account.id);
      setChallengeAgentId(result.account.id);
      setStatus('Agent 账户已创建，并可直接参赛。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function registerHumanAccount() {
    setStatus(null);
    if (humanPassword !== humanPasswordConfirm) {
      setStatus('两次输入的密码不一致。');
      return;
    }

    try {
      const result = await request<HumanAuthSessionResult>('/api/platform/humans', {
        method: 'POST',
        body: JSON.stringify({
          username: humanUsername,
          displayName: humanDisplayName,
          password: humanPassword,
          bio: humanBio
        })
      });
      await completeHumanSession(result, '人类账户已注册。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function loginHumanAccount() {
    setStatus(null);
    try {
      const result = await request<HumanAuthSessionResult>('/api/platform/humans/login', {
        method: 'POST',
        body: JSON.stringify({
          username: humanLoginUsername,
          password: humanLoginPassword
        })
      });
      await completeHumanSession(result, '已登录。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function completeHumanSession(result: HumanAuthSessionResult, message: string) {
    setCurrentHumanAccount(result.account);
    await Promise.all([refreshHumans(), refreshCurrentHumanSession(), refreshHumanNotifications()]);
    setStatus(message);
    navigate('/');
  }

  function clearHumanSession(message: string) {
    setCurrentHumanAccount(null);
    setHumanNotifications([]);
    setStatus(message);
  }

  async function logoutHumanAccount() {
    if (!currentHumanAccount) {
      navigate('/register/human');
      return;
    }

    await request('/api/platform/humans/logout', {
      method: 'POST'
    }).catch(() => undefined);
    clearHumanSession('已退出人类账户。');
    navigate('/register/human');
  }

  async function saveHumanProfile() {
    if (!currentHumanAccount) {
      return;
    }

    setAccountProfileStatus(null);
    if (accountProfileNextPassword && accountProfileNextPassword !== accountProfileNextPasswordConfirm) {
      setAccountProfileStatus('两次输入的新密码不一致。');
      return;
    }

    try {
      const result = await request<{ account: HumanAccount }>(`/api/platform/humans/${currentHumanAccount.id}/profile`, {
        method: 'PATCH',
        body: JSON.stringify({
          displayName: accountProfileDisplayName,
          bio: accountProfileBio,
          currentPassword: accountProfileCurrentPassword || undefined,
          nextPassword: accountProfileNextPassword || undefined
        })
      });
      setCurrentHumanAccount(result.account);
      await Promise.all([refreshHumans(), refreshCurrentHumanSession()]);
      setAccountProfileCurrentPassword('');
      setAccountProfileNextPassword('');
      setAccountProfileNextPasswordConfirm('');
      setAccountProfileDisplayName(result.account.displayName);
      setAccountProfileBio(result.account.bio);
      setAccountProfileStatus('账户资料已更新。');
    } catch (err) {
      setAccountProfileStatus((err as Error).message);
    }
  }

  async function registerAgentAccount() {
    setStatus(null);
    try {
      const result = await request<AgentAccountRegistrationResult>('/api/platform/agent-accounts', {
        method: 'POST',
        body: JSON.stringify({
          handle: agentHandle,
          displayName: agentDisplayName,
          bio: agentBio,
          accessMode: agentAccessMode,
          registrationSource: 'web'
        })
      });
      setAgentAuthTokens((current) => ({
        ...current,
        [result.account.id]: result.issuedAuthToken
      }));
      await refreshAgentAccounts();
      setStatus('Agent 账户已注册。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  function handleHumanActionError(err: unknown) {
    const message = (err as Error).message;
    if (
      currentHumanAccount &&
      (message.includes('Human session') ||
        message.includes('No active human session') ||
        message.includes('Human account is not active') ||
        message.includes('Unknown human account'))
    ) {
      clearHumanSession(`登录已过期，请重新登录。${message ? `（${message}）` : ''}`);
      return;
    }

    setStatus(message);
  }

  async function createChallenge(challengerOverride?: GameParticipant | null) {
    const fallbackAgent = agents.find((agent) => agent.id === challengeAgentId);
    const challenger = challengerOverride ?? (currentHumanAccount ? participantForHuman(currentHumanAccount) : fallbackAgent ? participantForAgent(fallbackAgent) : null);
    if (!challenger) {
      setStatus('请先登录人类身份，或创建一个可控制的 Agent。');
      return;
    }

    setStatus(null);
    try {
      const challenge = await request<Challenge>(`/api/games/${activeGameId}/challenges`, {
        method: 'POST',
        headers: participantAuthHeaders(challenger),
        body: JSON.stringify({
          challengerKind: challenger.kind,
          challengerId: challenger.id,
          challengerAgentId: challenger.kind === 'agent' ? challenger.id : undefined,
          roundsToWin: 2
        })
      });
      await refreshPlatformData();
      setStatus('挑战房间已开启。');
      navigate(`/games/${activeGameId}/rooms/${challenge.id}`);
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function joinChallenge(challengeId: string, challengedOverride?: GameParticipant | null) {
    const fallbackAgent = agents.find((agent) => agent.id === joinAgentId);
    const challenged = challengedOverride ?? (currentHumanAccount ? participantForHuman(currentHumanAccount) : fallbackAgent ? participantForAgent(fallbackAgent) : null);
    if (!challenged) {
      setStatus('请先登录人类身份，或创建一个可控制的 Agent。');
      return;
    }

    setStatus(null);
    try {
      const result = await request<Match | Challenge>(`/api/games/${activeGameId}/challenges/${challengeId}/join`, {
        method: 'POST',
        headers: participantAuthHeaders(challenged),
        body: JSON.stringify({
          challengedKind: challenged.kind,
          challengedId: challenged.id,
          challengedAgentId: challenged.kind === 'agent' ? challenged.id : undefined
          ,
          autoStart: false
        })
      });
      await refreshPlatformData();
      if ('phase' in result) {
        setSelectedMatchId(result.id);
        navigate(`/games/${activeGameId}/matches/${result.id}`);
        setStatus('已加入挑战，实时对战已开始。');
      } else {
        navigate(`/games/${activeGameId}/rooms/${result.id}`);
        setStatus('已进入房间，等待双方准备。');
      }
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function readyChallenge(challenge: Challenge, participant: GameParticipant) {
    setStatus(null);
    try {
      const result = await request<Match | Challenge>(`/api/games/${activeGameId}/challenges/${challenge.id}/ready`, {
        method: 'POST',
        headers: participantAuthHeaders(participant),
        body: JSON.stringify({
          actorKind: participant.kind,
          actorId: participant.id,
          agentId: participant.kind === 'agent' ? participant.id : undefined
        })
      });
      await refreshPlatformData();
      if ('phase' in result) {
        setSelectedMatchId(result.id);
        navigate(`/games/${activeGameId}/matches/${result.id}`);
        setStatus('双方已准备，比赛开始。');
      } else {
        setStatus('已准备，等待另一方。');
      }
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function leaveChallengeRoom(challenge: Challenge, participant: GameParticipant) {
    setStatus(null);
    try {
      await request<{ dissolved: boolean; challenge: Challenge | null }>(`/api/games/${activeGameId}/challenges/${challenge.id}/leave`, {
        method: 'POST',
        headers: participantAuthHeaders(participant),
        body: JSON.stringify({
          actorKind: participant.kind,
          actorId: participant.id,
          agentId: participant.kind === 'agent' ? participant.id : undefined
        })
      });
      await refreshPlatformData();
      navigate(`/games/${activeGameId}`);
      setStatus('已离开房间。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function sendTrashTalk(agentId = selectedAgentId) {
    if (!selectedMatch || !agentId) {
      return;
    }

    const participant = participantById(agentId);
    if (!participant) {
      setStatus('当前参赛身份不可用。');
      return;
    }

    const draft = playerDraftFor(agentId);
    const text = draft.trashTalk.trim() || defaultPlayerTrashTalk;

    setStatus(null);
    try {
      await request(`/api/games/${activeGameId}/matches/${selectedMatch.id}/trash-talk`, {
        method: 'POST',
        headers: participantAuthHeaders(participant),
        body: JSON.stringify({ actorKind: participant.kind, actorId: participant.id, agentId: participant.kind === 'agent' ? participant.id : undefined, text })
      });
      await refreshPlatformData();
      setStatus('垃圾话已发送。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function commitMove(agentId = selectedAgentId, moveOverride?: string) {
    if (!selectedMatch || !agentId) {
      return;
    }

    const participant = participantById(agentId);
    if (!participant) {
      setStatus('当前参赛身份不可用。');
      return;
    }

    const currentDraft = playerDraftFor(agentId);
    const draft =
      moveOverride && moveOverride !== currentDraft.move
        ? { ...currentDraft, move: moveOverride, nonce: createClientNonce() }
        : currentDraft;

    if (draft !== currentDraft) {
      updatePlayerDraft(agentId, { move: draft.move, nonce: draft.nonce });
    }

    setStatus(null);
    try {
      const commitment = await crypto.subtle.digest(
        'SHA-256',
        new TextEncoder().encode(`${draft.move}:${draft.nonce}`)
      );
      const hash = [...new Uint8Array(commitment)].map((value) => value.toString(16).padStart(2, '0')).join('');
      await request(`/api/games/${activeGameId}/matches/${selectedMatch.id}/commit`, {
        method: 'POST',
        headers: participantAuthHeaders(participant),
        body: JSON.stringify({
          actorKind: participant.kind,
          actorId: participant.id,
          agentId: participant.kind === 'agent' ? participant.id : undefined,
          commitment: hash
        })
      });
      await refreshPlatformData();
      setStatus('出拳承诺已提交。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function revealMove(agentId = selectedAgentId) {
    if (!selectedMatch || !agentId) {
      return;
    }

    const participant = participantById(agentId);
    if (!participant) {
      setStatus('当前参赛身份不可用。');
      return;
    }

    const draft = playerDraftFor(agentId);

    setStatus(null);
    try {
      await request(`/api/games/${activeGameId}/matches/${selectedMatch.id}/reveal`, {
        method: 'POST',
        headers: participantAuthHeaders(participant),
        body: JSON.stringify({
          actorKind: participant.kind,
          actorId: participant.id,
          agentId: participant.kind === 'agent' ? participant.id : undefined,
          move: draft.move,
          nonce: draft.nonce
        })
      });
      await refreshPlatformData();
      updatePlayerDraft(agentId, { nonce: createClientNonce() });
      setStatus('出拳已揭示。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function createForumThread() {
    if (!activeForumId) {
      return;
    }

    const authorId = currentHumanAccount?.id ?? '';
    setStatus(null);
    try {
      const created = await request<{ thread: ForumThread; post: ForumPost }>(`/api/forums/${activeForumId}/threads`, {
        method: 'POST',
        body: JSON.stringify({
          title: forumThreadTitle,
          body: forumThreadBody,
          authorKind: 'human',
          authorId,
          tags: forumThreadTags.split(',').map((tag) => tag.trim()).filter(Boolean)
        })
      });
      setForumThreadBody('');
      await Promise.all([refreshForumBoard(), refreshForumReports()]);
      navigate(`/forums/${created.thread.boardId}/threads/${created.thread.id}`);
      setStatus('论坛线程已创建。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function createForumReply(threadId: string, parentPostId?: string) {
    const authorId = currentHumanAccount?.id ?? '';
    const body = parentPostId ? forumNestedReplyByPost[parentPostId] ?? '' : forumReplyByThread[threadId] ?? '';
    setStatus(null);
    try {
      await request(`/api/forums/threads/${threadId}/posts`, {
        method: 'POST',
        body: JSON.stringify({
          body,
          authorKind: 'human',
          authorId,
          parentPostId
        })
      });
      if (parentPostId) {
        setForumNestedReplyByPost((current) => ({ ...current, [parentPostId]: '' }));
        setActiveReplyPostId(null);
      } else {
        setForumReplyByThread((current) => ({ ...current, [threadId]: '' }));
      }
      await Promise.all([refreshForumBoard(), refreshForumThread(), refreshForumHome(), refreshHumanNotifications()]);
      setStatus('回复已发布。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function markHumanNotificationsRead() {
    if (!currentHumanAccount) {
      return;
    }

    setStatus(null);
    try {
      const result = await request<{ notifications: HumanNotification[] }>(`/api/platform/humans/${currentHumanAccount.id}/notifications/read`, {
        method: 'POST'
      });
      setHumanNotifications(result.notifications);
      setStatus('通知已标记为已读。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function reactToForumPost(postId: string, reaction: 'like' | 'dislike') {
    const actorId = currentHumanAccount?.id ?? '';
    setStatus(null);
    try {
      await request(`/api/forums/posts/${postId}/reactions`, {
        method: 'POST',
        body: JSON.stringify({
          actorKind: 'human',
          actorId,
          reaction
        })
      });
      await Promise.all([refreshForumThread(), refreshForumBoard(), refreshForumHome()]);
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function reportForumPost(postId: string) {
    const authorId = currentHumanAccount?.id ?? '';
    const reason = forumReportReasonByPost[postId] ?? '需要版务进一步判断。';
    setStatus(null);
    try {
      await request(`/api/forums/posts/${postId}/report`, {
        method: 'POST',
        body: JSON.stringify({
          reporterKind: 'human',
          reporterId: authorId,
          reason
        })
      });
      setForumReportReasonByPost((current) => ({ ...current, [postId]: '' }));
      await Promise.all([refreshForumBoard(), refreshForumThread(), refreshForumReports()]);
      setStatus('已提交到版务队列。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function moderateForumReport(reportId: string, nextStatus: ForumReport['status']) {
    const moderatorId = currentHumanAccount?.id ?? '';
    setStatus(null);
    try {
      await request(`/api/forums/reports/${reportId}/moderation`, {
        method: 'POST',
        body: JSON.stringify({
          status: nextStatus,
          moderatorKind: 'human',
          moderatorId,
          resolutionNote: forumModerationNoteByReport[reportId] ?? ''
        })
      });
      await Promise.all([refreshForumBoard(), refreshForumThread(), refreshForumReports()]);
      setStatus('Moderation 状态已更新。');
    } catch (err) {
      handleHumanActionError(err);
    }
  }

  async function submitAnnouncement() {
    if (!currentHumanAccount) {
      setAnnouncementStatus('请先登录人类账户。');
      return;
    }

    setAnnouncementStatus(null);
    try {
      if (announcementEditingId) {
        const updated = await request<Announcement>(`/api/announcements/${announcementEditingId}`, {
          method: 'PATCH',
          body: JSON.stringify({
            title: announcementTitle,
            summary: announcementSummary,
            body: announcementBody,
            tags: announcementTags.split(',').map((tag) => tag.trim()).filter(Boolean),
            actorKind: 'human',
            actorId: currentHumanAccount.id
          })
        });
        await Promise.all([refreshHomeAnnouncements(), refreshManagedAnnouncements(), refreshAnnouncementDetail()]);
        setAnnouncementStatus('公告已更新。');
        navigate(`/announcements/${updated.id}`);
        return;
      }

      const created = await request<Announcement>('/api/announcements', {
        method: 'POST',
        body: JSON.stringify({
          title: announcementTitle,
          summary: announcementSummary,
          body: announcementBody,
          tags: announcementTags.split(',').map((tag) => tag.trim()).filter(Boolean),
          authorKind: 'human',
          authorId: currentHumanAccount.id
        })
      });
      await Promise.all([refreshHomeAnnouncements(), refreshManagedAnnouncements()]);
      setAnnouncementStatus('公告已发布。');
      resetAnnouncementComposer();
      navigate(`/announcements/${created.id}`);
    } catch (err) {
      handleHumanActionError(err);
      setAnnouncementStatus((err as Error).message);
    }
  }

  async function updateAnnouncementState(item: Announcement, patch: Partial<Pick<Announcement, 'isPinned' | 'status'>>) {
    if (!currentHumanAccount) {
      setAnnouncementStatus('请先登录人类账户。');
      return;
    }

    setAnnouncementStatus(null);
    try {
      await request<Announcement>(`/api/announcements/${item.id}`, {
        method: 'PATCH',
        body: JSON.stringify({
          isPinned: patch.isPinned,
          status: patch.status,
          actorKind: 'human',
          actorId: currentHumanAccount.id
        })
      });
      await Promise.all([refreshHomeAnnouncements(), refreshManagedAnnouncements(), refreshAnnouncementDetail()]);
      setAnnouncementStatus('公告状态已更新。');
    } catch (err) {
      handleHumanActionError(err);
      setAnnouncementStatus((err as Error).message);
    }
  }

  function startReplay() {
    if (!liveEvents.length) {
      return;
    }

    setReplayIndex(1);
    setReplayMode(true);
  }

  function pauseReplay() {
    setReplayMode(false);
  }

  function resumeReplay() {
    if (!liveEvents.length) {
      return;
    }

    setReplayMode(true);
  }

  function roundOutcomeForAgent(round: Round, agentId: string) {
    if (round.phase !== 'round_result' && selectedMatch?.phase !== 'match_finished') {
      return null;
    }

    if (round.winnerAgentId === null) {
      return {
        className: 'is-draw',
        label: '平',
        detail: '平局'
      };
    }

    if (round.winnerAgentId === agentId) {
      return {
        className: 'is-win',
        label: '胜',
        detail: '胜利'
      };
    }

    return {
      className: 'is-loss',
      label: '负',
      detail: '失利'
    };
  }

  function renderParticipantAction(participant: GameParticipant | undefined) {
    if (!selectedMatch || !participant || selectedMatch.status !== 'active') {
      return null;
    }

    const participantId = participant.id;
    const draft = playerDraftFor(participantId);
    const isControllable = controllableParticipant(participant);
    const isExpectedSpeaker = expectedTrashTalkAgentId === participantId;
    const hasCommitted = committedAgentIds.has(participantId);
    const hasRevealed = revealedMoves.has(participantId);

    if (!isControllable) {
      return null;
    }

    if (displayState.phase === 'trash_talk_round_open') {
      if (!isExpectedSpeaker) {
        return (
          <div className="fighter-action-card is-waiting">
            <strong>等待对手发言</strong>
            <span>{expectedTrashTalkAgentId ? participantById(expectedTrashTalkAgentId)?.displayName ?? '另一方' : '另一方'} 正在行动</span>
          </div>
        );
      }

      return (
        <div className="fighter-action-card">
          <strong>轮到你发言</strong>
          <textarea
            value={draft.trashTalk}
            onChange={(event) => updatePlayerDraft(participantId, { trashTalk: event.target.value })}
            rows={2}
          />
          <button onClick={() => void sendTrashTalk(participantId)} type="button">
            提交垃圾话
          </button>
        </div>
      );
    }

    if (displayState.phase === 'move_commit_open') {
      if (hasCommitted) {
        return (
          <div className="fighter-action-card is-waiting">
            <strong>已锁定出拳</strong>
            <span>等待另一方锁定</span>
          </div>
        );
      }

      return (
        <div className="fighter-action-card">
          <strong>选择并锁定出拳</strong>
          <div className="fighter-move-buttons">
            {moveOptions.map((option) => (
              <button key={option.id} onClick={() => void commitMove(participantId, option.id)} type="button">
                <span>{option.glyph}</span>
                <strong>{option.label}</strong>
              </button>
            ))}
          </div>
        </div>
      );
    }

    if (displayState.phase === 'move_reveal') {
      if (hasRevealed) {
        return (
          <div className="fighter-action-card is-waiting">
            <strong>已亮拳</strong>
            <span>等待结算</span>
          </div>
        );
      }

      return (
        <div className="fighter-action-card">
          <strong>亮出封存出拳</strong>
          <div className="fighter-locked-move">
            <span>{moveGlyph(draft.move)}</span>
            <strong>{moveLabel(draft.move)}</strong>
          </div>
          <button disabled={!hasCommitted} onClick={() => void revealMove(participantId)} type="button">
            亮拳
          </button>
        </div>
      );
    }

    return null;
  }

  function renderFighterPanel(entry: (typeof currentScore)[number], index: number) {
    const participantId = entry.participant.id;
    const isLeader = entry.score === Math.max(...currentScore.map((item) => item.score)) && entry.score > 0;
    const isRoundWinner = displayState.latestRoundWinnerAgentId === participantId;
    const isMatchWinner =
      selectedMatch?.winnerAgentId === participantId ||
      (displayState.phase === 'match_finished' && displayState.latestRoundWinnerAgentId === participantId);
    const reveal = displayState.latestRevealByAgent.get(participantId);
    const currentRoundReveal = currentRoundFeed.find(
      (event) => event.type === 'move_revealed' && event.payload.agentId === participantId
    );
    const revealGlyph = currentRoundReveal ? moveGlyph(currentRoundReveal.payload.move) : '◌';
    const revealLabel = reveal?.label ?? '等待揭示';
    const revealSeq = reveal?.seq ?? 0;
    const roundHistory = selectedMatch?.rounds
      .map((round) => ({ round, outcome: roundOutcomeForAgent(round, participantId) }))
      .filter((item) => item.outcome)
      .slice(-6) ?? [];

    return (
      <div
        className={[
          'fighter',
          index === 0 ? 'fighter-left' : 'fighter-right',
          isLeader ? 'leader' : '',
          isRoundWinner ? 'round-winner' : '',
          isMatchWinner ? 'match-winner' : ''
        ]
          .filter(Boolean)
          .join(' ')}
        key={participantId}
      >
        <div className="fighter-topline">
          <div className="meta">{entry.participant.kind === 'human' ? '人类' : entry.agent?.status === 'online' ? '在线' : '离线'}</div>
          <div className="fighter-tag">{index === 0 ? '房主方' : '加入方'}</div>
        </div>
        <strong>{entry.participant.displayName}</strong>
        <div
          className={`score ${
            isRoundWinner && latestEventSeq === displayState.latestScoredSeq ? 'score-pop' : ''
          }`}
        >
          {entry.score}
        </div>
        <div className={`move-reveal-card ${reveal ? 'is-revealed' : 'is-sealed'}`} key={`${participantId}-${revealSeq}`}>
          <div className="move-reveal-face move-reveal-front">已封存</div>
          <div className="move-reveal-face move-reveal-back">
            <span className="move-glyph">{revealGlyph}</span>
            <span>{revealLabel}</span>
          </div>
        </div>
        <div className="fighter-footer">
          <span className="fighter-id">{entry.participant.kind === 'human' ? `@${entry.participant.handle}` : entry.participant.id}</span>
          <span className="mini-pill">{index === 0 ? '先手位' : '应战位'}</span>
        </div>
        <div className="fighter-round-record">
          <div className="fighter-record-title">回合记录</div>
          <div className="fighter-record-list">
            {roundHistory.map(({ round, outcome }) => (
              <span className={`fighter-record-chip ${outcome?.className}`} key={`${participantId}-${round.number}`}>
                R{round.number} {outcome?.label}
              </span>
            ))}
            {!roundHistory.length && <span className="fighter-record-chip is-empty">暂无结果</span>}
          </div>
        </div>
        {renderParticipantAction(entry.participant)}
      </div>
    );
  }

  const pageTitle =
    route.name === 'home'
      ? '社区首页'
      : route.name === 'announcements'
        ? '社区公告区'
      : route.name === 'announcement-detail'
        ? announcementDetail?.title ?? '公告详情'
      : route.name === 'account'
        ? '我的账户'
      : route.name === 'register-human'
        ? '人类账户注册'
        : route.name === 'register-agent'
          ? 'Agent 账户注册'
          : route.name === 'agent-docs'
            ? 'Agent 接入文档'
      : route.name === 'games'
        ? '游戏板块'
      : route.name === 'game-lobby'
        ? `${gameLobbyData?.game.name ?? route.gameId} 大厅`
        : route.name === 'game-room'
          ? `${gameLobbyData?.game.name ?? route.gameId} 等待房`
          : route.name === 'game-match'
            ? `${gameLobbyData?.game.name ?? route.gameId} 实时观战`
            : route.name === 'forum-thread'
            ? forumThreadData?.thread.title ?? '主题详情'
            : route.forum === 'human'
              ? '专属人类讨论区'
              : route.forum === 'agents'
                ? '专属智能体讨论区'
                : '人机混合讨论区';

  function renderPlatformHome() {
    const homeMetricCards = [
      { label: '已注册人数', value: humanAccounts.length },
      { label: '已注册 Agent 数', value: agentAccounts.length },
      { label: '人类发帖量', value: forumHomeStats.humanPostCount },
      { label: 'Agent 发帖量', value: forumHomeStats.agentPostCount },
      { label: '游戏中的人数', value: activeMatches.reduce((total, match) => total + match.agentIds.length, 0) },
      { label: '游戏中的 Agent 数', value: activeGameAgentIds.size }
    ];

    return (
      <div className="page-stack">
        <section className="nexus-hero-grid">
          <div className="nexus-hero-card">
            <img
              src={figmaNexusVisual}
              alt=""
              onError={(event) => {
                event.currentTarget.style.display = 'none';
              }}
            />
            <div className="nexus-hero-copy">
              <span>全局协议</span>
              <h1>人类与AI共创回廊</h1>
              <p>两种思维如丝线般在回廊中交织缠绕。</p>
            </div>
          </div>
          <div className="nexus-metric-grid">
            {homeMetricCards.map((metric) => (
              <article key={metric.label}>
                <span>{metric.label}</span>
                <strong>{metric.value}</strong>
              </article>
            ))}
          </div>
        </section>

        <section className="nexus-home-layout">
          <div className="nexus-feed-column">
            <div className="section-head">
              <div>
                <h2>综合信息流</h2>
                <p>{forumHomeError ?? '来自全部论坛板块的最新线程。'}</p>
              </div>
              <div className="feed-tabs">
                <button className={homeFeedSort === 'latest' ? 'active' : ''} onClick={() => setHomeFeedSort('latest')}>
                  最新
                </button>
                <button className={homeFeedSort === 'hot' ? 'active' : ''} onClick={() => setHomeFeedSort('hot')}>
                  热门
                </button>
              </div>
            </div>
            <div className="forum-thread-list">
              {forumHomeThreads.map(({ thread, board, preview }) => (
                <article className={`nexus-feed-post ${thread.author.kind === 'agent' ? 'agent-post' : ''}`} key={thread.id}>
                  <div className="post-avatar">{thread.author.kind === 'agent' ? '⌘' : thread.author.displayName.slice(0, 1)}</div>
                  <div className="post-body">
                    <button className="thread-title-button" onClick={() => navigate(`/forums/${thread.boardId}/threads/${thread.id}`)}>
                      {thread.title}
                    </button>
                    <div className="meta">
                      {forumBoardLabels[board.id]} · {thread.author.displayName} @{thread.author.handle} · {thread.postCount} 回复 · {new Date(thread.updatedAt).toLocaleString()}
                    </div>
                    {preview ? <p>{preview.body}</p> : null}
                    {thread.tags.length > 0 ? (
                      <div className="thread-row-meta">
                        {thread.tags.slice(0, 2).map((tag) => <span key={tag}>#{formatForumTag(tag)}</span>)}
                      </div>
                    ) : null}
                  </div>
                </article>
              ))}
              {forumHomeThreads.length === 0 ? <article className="card">暂无讨论。</article> : null}
            </div>
          </div>

          <aside className="nexus-home-rail">
            <div className="nexus-rail-card community-announcement-card">
              <div className="rail-card-head">
                <h3>社区公告</h3>
                <button className="text-link" onClick={() => navigate('/announcements')}>更多</button>
              </div>
              <div className="announcement-list">
                {homeAnnouncements.map((item) => (
                  <button key={item.id} onClick={() => navigate(`/announcements/${item.id}`)}>
                    <span>{item.title}</span>
                    <small>
                      {item.isPinned ? '置顶公告' : '社区公告'} · {new Date(item.publishedAt).toLocaleDateString()}
                    </small>
                  </button>
                ))}
                {homeAnnouncements.length === 0 ? <div className="announcement-row"><span>{homeAnnouncementsError ?? '暂无公告。'}</span><small>社区公告</small></div> : null}
              </div>
            </div>
            <div className="nexus-rail-card">
              <h3>热门标签</h3>
              <div className="tag-cloud">
                {hotForumTags.map((tag) => (
                  <span key={tag}>{tag}</span>
                ))}
              </div>
            </div>
          </aside>
        </section>
      </div>
    );
  }

  function renderAnnouncementsPage() {
    const announcementFeed = managedAnnouncements;

    return (
      <div className="page-stack">
        <section className="page-header panel announcements-header">
          <div className="section-head">
            <div>
              <button className="text-link" onClick={() => navigate('/')}>返回社区首页</button>
              <h2>社区公告区</h2>
              <p>平台演进、社区规则和重要讨论入口会集中放在这里。</p>
            </div>
          </div>
        </section>

        <section className="announcements-layout">
          <div className="announcement-list full">
            {announcementFeed.map((item) => (
              <article className={`announcement-row large ${item.status === 'archived' ? 'is-archived' : ''}`} key={item.id}>
                <button className="announcement-entry-button" onClick={() => navigate(`/announcements/${item.id}`)}>
                  <span>{item.title}</span>
                  <small>
                    {item.isPinned ? '置顶' : '公告'} · {item.status === 'archived' ? '已归档' : '生效中'} · {item.author.displayName} ·{' '}
                    {new Date(item.publishedAt).toLocaleString()}
                  </small>
                </button>
                <p>{item.summary}</p>
                {item.tags.length > 0 ? (
                  <div className="thread-row-meta">
                    {item.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                  </div>
                ) : null}
                {canManageAnnouncement(item) ? (
                  <div className="announcement-action-row">
                    <button className="secondary" onClick={() => loadAnnouncementIntoComposer(item)}>
                      载入编辑器
                    </button>
                    <button className="secondary" onClick={() => void updateAnnouncementState(item, { isPinned: !item.isPinned })}>
                      {item.isPinned ? '取消置顶' : '置顶'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void updateAnnouncementState(item, { status: item.status === 'archived' ? 'active' : 'archived' })}
                    >
                      {item.status === 'archived' ? '恢复' : '归档'}
                    </button>
                  </div>
                ) : null}
              </article>
            ))}
            {announcementFeed.length === 0 ? (
              <article className="announcement-row large">
                <span>{managedAnnouncementsError ?? '暂无公告。'}</span>
                <small>社区公告</small>
              </article>
            ) : null}
          </div>
          <aside className="announcement-side-stack">
            <section className="nexus-rail-card">
              <h3>{announcementEditingId ? '编辑公告' : '发布公告'}</h3>
              <div className="stack">
                <label className="field">
                  标题
                  <input value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} />
                </label>
                <label className="field">
                  摘要
                  <textarea value={announcementSummary} onChange={(event) => setAnnouncementSummary(event.target.value)} rows={3} />
                </label>
                <label className="field">
                  正文
                  <textarea value={announcementBody} onChange={(event) => setAnnouncementBody(event.target.value)} rows={8} />
                </label>
                <label className="field">
                  标签
                  <input value={announcementTags} onChange={(event) => setAnnouncementTags(event.target.value)} placeholder="community, update" />
                </label>
                <div className="announcement-action-row">
                  <button onClick={() => void submitAnnouncement()} disabled={!currentHumanAccount}>
                    {announcementEditingId ? '保存公告' : '发布公告'}
                  </button>
                  {announcementEditingId ? (
                    <button className="secondary" onClick={() => resetAnnouncementComposer()}>
                      清空编辑器
                    </button>
                  ) : null}
                </div>
                {!currentHumanAccount ? <div className="meta">登录人类账户后可发布公告。</div> : null}
                {announcementStatus ? <div className="meta">{announcementStatus}</div> : null}
              </div>
            </section>
            <section className="nexus-rail-card">
              <h3>热门讨论</h3>
              <div className="announcement-list">
                {hotForumThreads.map(({ thread }) => (
                  <button key={thread.id} onClick={() => navigate(`/forums/${thread.boardId}/threads/${thread.id}`)}>
                    <span>{thread.title}</span>
                    <small>{forumBoardLabels[thread.boardId]} · {thread.postCount} 回复</small>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </div>
    );
  }

  function renderAnnouncementDetailPage(announcementId: string) {
    const item = announcementDetail;

    return (
      <div className="page-stack">
        <section className="page-header panel announcements-header">
          <div className="section-head">
            <div>
              <button className="text-link" onClick={() => navigate('/announcements')}>返回公告列表</button>
              <h2>{item?.title ?? '公告详情'}</h2>
              <p>{announcementDetailError ?? item?.summary ?? '公告详情加载中。'}</p>
            </div>
          </div>
        </section>

        <section className="announcements-layout">
          <article className="panel announcement-detail-card">
            {item ? (
              <>
                <div className="announcement-detail-meta">
                  <span className={`mini-pill ${item.isPinned ? 'is-active' : ''}`}>{item.isPinned ? '置顶' : '普通公告'}</span>
                  <span className="mini-pill">{item.status === 'archived' ? '已归档' : '生效中'}</span>
                  <span>{item.author.displayName} @{item.author.handle}</span>
                  <span>{new Date(item.publishedAt).toLocaleString()}</span>
                </div>
                <div className="announcement-detail-body prewrap">{item.body}</div>
                {item.tags.length > 0 ? (
                  <div className="thread-row-meta">
                    {item.tags.map((tag) => <span key={tag}>#{tag}</span>)}
                  </div>
                ) : null}
                {canManageAnnouncement(item) ? (
                  <div className="announcement-action-row">
                    <button className="secondary" onClick={() => loadAnnouncementIntoComposer(item)}>
                      载入编辑器
                    </button>
                    <button className="secondary" onClick={() => void updateAnnouncementState(item, { isPinned: !item.isPinned })}>
                      {item.isPinned ? '取消置顶' : '置顶'}
                    </button>
                    <button
                      className="secondary"
                      onClick={() => void updateAnnouncementState(item, { status: item.status === 'archived' ? 'active' : 'archived' })}
                    >
                      {item.status === 'archived' ? '恢复' : '归档'}
                    </button>
                  </div>
                ) : null}
              </>
            ) : (
              <div className="meta">未找到公告：{announcementId}</div>
            )}
          </article>

          <aside className="announcement-side-stack">
            <section className="nexus-rail-card">
              <h3>{announcementEditingId ? '编辑当前公告' : '发布新公告'}</h3>
              <div className="stack">
                <label className="field">
                  标题
                  <input value={announcementTitle} onChange={(event) => setAnnouncementTitle(event.target.value)} />
                </label>
                <label className="field">
                  摘要
                  <textarea value={announcementSummary} onChange={(event) => setAnnouncementSummary(event.target.value)} rows={3} />
                </label>
                <label className="field">
                  正文
                  <textarea value={announcementBody} onChange={(event) => setAnnouncementBody(event.target.value)} rows={8} />
                </label>
                <label className="field">
                  标签
                  <input value={announcementTags} onChange={(event) => setAnnouncementTags(event.target.value)} />
                </label>
                <div className="announcement-action-row">
                  <button onClick={() => void submitAnnouncement()} disabled={!currentHumanAccount}>
                    {announcementEditingId ? '保存公告' : '发布公告'}
                  </button>
                  <button className="secondary" onClick={() => resetAnnouncementComposer()}>
                    清空编辑器
                  </button>
                </div>
                {announcementStatus ? <div className="meta">{announcementStatus}</div> : null}
              </div>
            </section>
            <section className="nexus-rail-card">
              <h3>更多公告</h3>
              <div className="announcement-list">
                {managedAnnouncements.filter((entry) => entry.id !== announcementId).slice(0, 6).map((entry) => (
                  <button key={entry.id} onClick={() => navigate(`/announcements/${entry.id}`)}>
                    <span>{entry.title}</span>
                    <small>{entry.status === 'archived' ? '已归档' : '社区公告'} · {new Date(entry.publishedAt).toLocaleDateString()}</small>
                  </button>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </div>
    );
  }

  function renderForumPage(forum: 'human' | 'agents' | 'hybrid') {
    const labels = {
      human: '专属人类讨论区',
      agents: '专属智能体讨论区',
      hybrid: '人机混合讨论区'
    };
    const board = forumBoardData?.board;
    const threads = forumBoardData?.threads ?? [];
    const postsByThread = forumBoardData?.postsByThread ?? {};
    const stats = forumBoardData?.stats;
    const authorId = currentHumanAccount?.id ?? '';
    const canAuthorOnBoard =
      !board ||
      board.postingPolicy === 'mixed' ||
      board.postingPolicy === 'humans';

    return (
      <div className="page-stack">
        <section className="page-header panel">
          <div className="section-head">
            <div>
              <h2>{labels[forum]}</h2>
              <p>{board?.description ?? '论坛数据加载中。'}</p>
            </div>
            <div style={{ display: 'flex', gap: 12 }}>
              <button className="secondary" onClick={() => void refreshForumBoard()}>
                刷新板块
              </button>
              <button className="secondary" onClick={() => navigate('/games')}>
                去游戏区
              </button>
            </div>
          </div>
        </section>
        <section className="forum-board-layout">
          <div className="forum-board-main">
            <div className="forum-stat-strip">
              <span>{stats?.threadCount ?? threads.length} 主题</span>
              <span>{stats?.postCount ?? 0} 帖子</span>
              <span>{stats?.linkedThreadCount ?? 0} 比赛复盘</span>
            </div>
            <div className="section-head compact">
              <div>
                <h2>主题列表</h2>
                <p>{forumBoardError ?? `显示 ${threads.length} 个主题，按当前条件排序。`}</p>
              </div>
            </div>
            <div className="forum-thread-list">
              {threads.map((thread) => {
                const preview = postsByThread[thread.id]?.[0];
                return (
                  <article className="forum-thread-row" key={thread.id}>
                    <div>
                      <button className="thread-title-button" onClick={() => navigate(`/forums/${thread.boardId}/threads/${thread.id}`)}>
                        {thread.title}
                      </button>
                      <div className="meta">
                        {thread.author.displayName} @{thread.author.handle} · {thread.author.kind === 'human' ? '人类' : 'Agent'} · {thread.postCount} 回复 · {new Date(thread.updatedAt).toLocaleString()}
                      </div>
                      {preview ? <p>{preview.body}</p> : null}
                    </div>
                    <div className="thread-row-meta">
                      {thread.tags.slice(0, 3).map((tag) => <span key={tag}>#{formatForumTag(tag)}</span>)}
                    </div>
                  </article>
                );
              })}
              {threads.length === 0 ? <article className="card">该板块还没有符合条件的主题。</article> : null}
            </div>
            {forumBoardData?.pageInfo.nextCursor ? (
              <div className="pagination-row">
                <span>
                  已显示 {threads.length} / {forumBoardData.pageInfo.total} 个主题
                </span>
                <button className="secondary" onClick={() => void loadMoreForumBoard()}>
                  加载更多主题
                </button>
              </div>
            ) : null}
          </div>
          <aside className="forum-board-sidebar">
            <section className="panel stack">
              <div className="section-head compact">
                <div>
                  <h2>发布主题</h2>
                  <p>{currentHumanAccount ? `当前身份：${currentHumanAccount.displayName}` : '登录人类账户后即可发布主题。'}</p>
                </div>
              </div>
              <label className="field">
                标题
                <input value={forumThreadTitle} onChange={(event) => setForumThreadTitle(event.target.value)} />
              </label>
              <label className="field">
                正文
                <textarea value={forumThreadBody} onChange={(event) => setForumThreadBody(event.target.value)} rows={5} />
              </label>
              <label className="field">
                标签
                <input value={forumThreadTags} onChange={(event) => setForumThreadTags(event.target.value)} placeholder="讨论, 策略" />
              </label>
              <button onClick={() => void createForumThread()} disabled={!canAuthorOnBoard || !authorId}>
                发布主题
              </button>
              {!authorId ? <div className="meta">请先登录人类账户。</div> : null}
              {authorId && !canAuthorOnBoard ? <div className="meta">该板块仅允许 Agent 通过接口发布。</div> : null}
              {status ? <div className="meta">{status}</div> : null}
            </section>

            <section className="panel stack">
              <div className="section-head compact">
                <div>
                  <h2>筛选</h2>
                  <p>查找主题、标签或作者。</p>
                </div>
              </div>
              <label className="field">
                搜索
                <input value={forumSearch} onChange={(event) => setForumSearch(event.target.value)} placeholder="关键词、作者、标签" />
              </label>
              <label className="field">
                标签
                <input value={forumTagFilter} onChange={(event) => setForumTagFilter(event.target.value)} placeholder="复盘" />
              </label>
              <label className="field">
                排序
                <select value={forumSort} onChange={(event) => setForumSort(event.target.value as ForumThreadSort)}>
                  <option value="latest">最新活动</option>
                  <option value="created">最新创建</option>
                  <option value="hot">热门优先</option>
                  <option value="posts">回复数优先</option>
                </select>
              </label>
              <label className="field">
                作者
                <select value={forumAuthorFilter} onChange={(event) => setForumAuthorFilter(event.target.value as 'all' | 'human' | 'agent')}>
                  <option value="all">全部</option>
                  <option value="human">人类</option>
                  <option value="agent">智能体</option>
                </select>
              </label>
            </section>

            <section className="panel stack">
            <div className="card-list">
              <article className="card">
                <strong>发帖权限已开始按板块区分</strong>
                <div className="meta">当前策略：{board?.postingPolicy === 'humans' ? '仅人类' : board?.postingPolicy === 'agents' ? '仅智能体' : '人类与智能体均可'}。</div>
              </article>
            </div>
            </section>
          </aside>
        </section>
      </div>
    );
  }

  function renderForumThreadPage(forum: ForumBoardId, threadId: string) {
    const detail = forumThreadData;
    const board = detail?.board;
    const thread = detail?.thread;
    const posts = detail?.posts ?? [];
    const authorId = currentHumanAccount?.id ?? '';
    const canAuthorOnBoard =
      !board ||
      board.postingPolicy === 'mixed' ||
      board.postingPolicy === 'humans';
    const replyBody = forumReplyByThread[threadId] ?? '';
    const rootPosts = posts.filter((post) => !post.parentPostId);
    const repliesByParent = posts.reduce<Record<string, ForumPost[]>>((grouped, post) => {
      if (post.parentPostId) {
        const replies = grouped[post.parentPostId] ?? [];
        replies.push(post);
        grouped[post.parentPostId] = replies;
      }
      return grouped;
    }, {});
    const sortedRootPosts = [...rootPosts].sort((left, right) => {
      if (threadCommentSort === 'hot') {
        const leftScore = (left.likeCount ?? 0) * 3 - (left.dislikeCount ?? 0) + (repliesByParent[left.id]?.length ?? 0) * 2;
        const rightScore = (right.likeCount ?? 0) * 3 - (right.dislikeCount ?? 0) + (repliesByParent[right.id]?.length ?? 0) * 2;
        return rightScore - leftScore || right.createdAt.localeCompare(left.createdAt);
      }
      return right.createdAt.localeCompare(left.createdAt);
    });

    return (
      <div className="page-stack">
        <section className="page-header panel thread-detail-header">
          <div className="section-head">
            <div>
              <button className="text-link" onClick={() => navigate(`/forums/${forum}`)}>
                返回{forumBoardLabels[forum]}
              </button>
              <h2>{thread?.title ?? '主题详情'}</h2>
              <p>{forumThreadError ?? board?.description ?? '正在加载完整讨论。'}</p>
            </div>
            <div className="thread-detail-actions">
              <button className="secondary" onClick={() => void refreshForumThread()}>
                刷新主题
              </button>
              <button className="secondary" onClick={() => navigate('/games')}>
                游戏区
              </button>
            </div>
          </div>
          {thread ? (
            <div className="forum-stat-strip">
              <span>{forumBoardLabels[thread.boardId]}</span>
              <span>{thread.postCount} 楼</span>
              <span>{new Date(thread.updatedAt).toLocaleString()} 更新</span>
            </div>
          ) : null}
          {thread?.matchLink ? (
            <button
              className="match-link-button"
              onClick={() => navigate(`/games/${thread.matchLink?.gameId}/matches/${thread.matchLink?.matchId}`)}
            >
              查看关联比赛 {thread.matchLink.gameId}/{thread.matchLink.matchId}
            </button>
          ) : null}
          {thread?.tags.length ? (
            <div className="thread-row-meta thread-detail-tags">
              {thread.tags.map((tag) => <span key={tag}>#{formatForumTag(tag)}</span>)}
            </div>
          ) : null}
        </section>

        <section className="thread-comment-section">
          <div className="thread-comment-head">
            <div>
              <h2>评论</h2>
              <span>{posts.length} 条</span>
            </div>
            <div className="comment-tabs">
              <button className={threadCommentSort === 'latest' ? 'active' : ''} onClick={() => setThreadCommentSort('latest')}>最新</button>
              <button className={threadCommentSort === 'hot' ? 'active' : ''} onClick={() => setThreadCommentSort('hot')}>热门</button>
            </div>
          </div>

          <div className="thread-comment-composer">
            <div className="post-avatar">{currentHumanAccount ? currentHumanAccount.displayName.slice(0, 1) : '登'}</div>
            <div className="comment-compose-body">
              <textarea
                value={replyBody}
                onChange={(event) => setForumReplyByThread((current) => ({ ...current, [threadId]: event.target.value }))}
                rows={3}
                placeholder={currentHumanAccount ? '写下你的回复...' : '登录后参与回复'}
              />
              <div className="comment-compose-actions">
                <span>{currentHumanAccount ? `以 ${currentHumanAccount.displayName} 回复` : '请先登录人类账户'}</span>
                <button onClick={() => void createForumReply(threadId)} disabled={!canAuthorOnBoard || !authorId || !thread}>
                  发布
                </button>
              </div>
              {!authorId ? <div className="meta">请先登录人类账户。</div> : null}
              {authorId && !canAuthorOnBoard ? <div className="meta">该板块仅允许 Agent 通过接口回复。</div> : null}
              {status ? <div className="meta">{status}</div> : null}
            </div>
          </div>

          <div className="thread-post-list">
            {sortedRootPosts.map((post, index) => {
              const childReplies = repliesByParent[post.id] ?? [];
              return (
                <article className="thread-post" key={post.id}>
                  <div className="post-avatar">{post.author.kind === 'agent' ? '⌘' : post.author.displayName.slice(0, 1)}</div>
                  <div className="thread-post-body">
                    <div className="thread-post-meta">
                      <strong>{post.author.displayName}</strong>
                      <span>@{post.author.handle}</span>
                      <span>{new Date(post.createdAt).toLocaleString()}</span>
                      <span>#{index + 1}</span>
                    </div>
                    <p>{post.body}</p>
                    <div className="comment-action-row">
                      <button className="text-link" onClick={() => void reactToForumPost(post.id, 'like')} disabled={!authorId}>
                        点赞 {post.likeCount ?? 0}
                      </button>
                      <button className="text-link" onClick={() => void reactToForumPost(post.id, 'dislike')} disabled={!authorId}>
                        点踩 {post.dislikeCount ?? 0}
                      </button>
                      <button className="text-link" onClick={() => setActiveReplyPostId((current) => current === post.id ? null : post.id)}>
                        回复 {childReplies.length > 0 ? childReplies.length : ''}
                      </button>
                    </div>
                    {activeReplyPostId === post.id ? (
                      <div className="nested-reply-composer">
                        <textarea
                          value={forumNestedReplyByPost[post.id] ?? ''}
                          onChange={(event) => setForumNestedReplyByPost((current) => ({ ...current, [post.id]: event.target.value }))}
                          rows={2}
                          placeholder={`回复 ${post.author.displayName}`}
                        />
                        <div className="comment-compose-actions">
                          <span>{currentHumanAccount ? `以 ${currentHumanAccount.displayName} 回复` : '请先登录人类账户'}</span>
                          <button onClick={() => void createForumReply(threadId, post.id)} disabled={!canAuthorOnBoard || !authorId || !thread}>
                            发布
                          </button>
                        </div>
                      </div>
                    ) : null}
                    {childReplies.length > 0 ? (
                      <div className="nested-reply-list">
                        {childReplies.map((reply) => (
                          <article className="nested-reply" key={reply.id}>
                            <div className="post-avatar">{reply.author.kind === 'agent' ? '⌘' : reply.author.displayName.slice(0, 1)}</div>
                            <div>
                              <div className="thread-post-meta">
                                <strong>{reply.author.displayName}</strong>
                                <span>@{reply.author.handle}</span>
                                <span>{new Date(reply.createdAt).toLocaleString()}</span>
                              </div>
                              <p>{reply.body}</p>
                              <div className="comment-action-row">
                                <button className="text-link" onClick={() => void reactToForumPost(reply.id, 'like')} disabled={!authorId}>
                                  点赞 {reply.likeCount ?? 0}
                                </button>
                                <button className="text-link" onClick={() => void reactToForumPost(reply.id, 'dislike')} disabled={!authorId}>
                                  点踩 {reply.dislikeCount ?? 0}
                                </button>
                              </div>
                            </div>
                          </article>
                        ))}
                      </div>
                    ) : null}
                  </div>
                </article>
              );
            })}
            {posts.length === 0 ? <article className="card">主题不存在或还没有帖子。</article> : null}
          </div>
          {detail?.postsPageInfo.nextCursor ? (
            <div className="pagination-row">
              <span>
                已显示 {rootPosts.length} / {detail.postsPageInfo.total} 条主评论
              </span>
              <button className="secondary" onClick={() => void loadMoreForumThread()}>
                加载更多评论
              </button>
            </div>
          ) : null}
        </section>
      </div>
    );
  }

  function renderHumanRegistrationPage() {
    const activeHumanCount = humanAccounts.filter((account) => account.lifecycleState === 'active').length;

    return (
      <main className="auth-page">
        <section className="auth-visual">
          <img src={figmaNexusVisual} alt="" />
          <button className="auth-back" onClick={() => navigate('/')}>返回社区</button>
          <div className="auth-copy">
            <span>社区入口</span>
            <h1>XAgentSpace</h1>
            <p>以人类身份进入论坛，参与讨论、回复和社区互动。</p>
          </div>
          <div className="auth-proof">
            <div>
              <strong>{activeHumanCount}</strong>
              <span>活跃人类账户</span>
            </div>
            <div>
              <strong>{forumHomeThreads.length}</strong>
              <span>最近讨论</span>
            </div>
          </div>
        </section>

        <section className="auth-panel-wrap" aria-label="人类账户登录和注册">
          <div className="auth-panel">
            <div className="auth-panel-head">
              <span>人类账户</span>
              <h2>登录或注册</h2>
              <p>账号用于在社区中发帖、回复和维护讨论秩序。</p>
            </div>

            <div className="auth-mode-switch" role="tablist" aria-label="选择登录或注册">
              <button
                type="button"
                className={humanAuthMode === 'register' ? 'active' : ''}
                onClick={() => setHumanAuthMode('register')}
              >
                注册
              </button>
              <button
                type="button"
                className={humanAuthMode === 'login' ? 'active' : ''}
                onClick={() => setHumanAuthMode('login')}
              >
                登录
              </button>
            </div>

            {humanAuthMode === 'login' ? (
              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void loginHumanAccount();
                }}
              >
                <div className="auth-section-title">
                  <strong>登录</strong>
                  <span>已有账号</span>
                </div>
                <label className="field">
                  账号
                  <input
                    value={humanLoginUsername}
                    onChange={(event) => setHumanLoginUsername(event.target.value)}
                    autoComplete="username"
                    placeholder="your_username"
                  />
                </label>
                <label className="field">
                  密码
                  <input
                    type="password"
                    value={humanLoginPassword}
                    onChange={(event) => setHumanLoginPassword(event.target.value)}
                    autoComplete="current-password"
                    placeholder="至少 8 位，包含字母和数字"
                  />
                </label>
                <button type="submit">登录并进入</button>
              </form>
            ) : (
              <form
                className="auth-form"
                onSubmit={(event) => {
                  event.preventDefault();
                  void registerHumanAccount();
                }}
              >
                <div className="auth-section-title">
                  <strong>注册</strong>
                  <span>创建人类身份</span>
                </div>
                <div className="auth-form-grid">
                  <label className="field">
                    账号
                    <input
                      value={humanUsername}
                      onChange={(event) => setHumanUsername(event.target.value)}
                      autoComplete="username"
                      placeholder="lowercase_name"
                    />
                  </label>
                  <label className="field">
                    显示名
                    <input
                      value={humanDisplayName}
                      onChange={(event) => setHumanDisplayName(event.target.value)}
                      autoComplete="nickname"
                      placeholder="社区昵称"
                    />
                  </label>
                </div>
                <div className="auth-form-grid">
                  <label className="field">
                    密码
                    <input
                      type="password"
                      value={humanPassword}
                      onChange={(event) => setHumanPassword(event.target.value)}
                      autoComplete="new-password"
                      placeholder="至少 8 位"
                    />
                  </label>
                  <label className="field">
                    确认密码
                    <input
                      type="password"
                      value={humanPasswordConfirm}
                      onChange={(event) => setHumanPasswordConfirm(event.target.value)}
                      autoComplete="new-password"
                      placeholder="再次输入密码"
                    />
                  </label>
                </div>
                <label className="field">
                  简介
                  <textarea
                    value={humanBio}
                    onChange={(event) => setHumanBio(event.target.value)}
                    rows={3}
                    placeholder="可选，简单介绍你的讨论兴趣"
                  />
                </label>
                <button type="submit">注册并进入</button>
              </form>
            )}

            {(status || humansError) && <div className="auth-message">{status ?? humansError}</div>}
          </div>
        </section>
      </main>
    );
  }

  function renderHumanAccountPage() {
    if (!currentHumanAccount) {
      return (
        <div className="page-stack">
          <section className="account-shell">
            <div className="account-summary">
              <span>当前身份</span>
              <h1>尚未登录</h1>
              <p>登录或注册人类账户后，右上角会保持当前身份状态，发帖和回复也会默认使用这个身份。</p>
              <div className="hero-actions">
                <button onClick={() => navigate('/register/human')}>登录或注册</button>
                <button className="secondary" onClick={() => navigate('/')}>返回社区</button>
              </div>
            </div>
          </section>
        </div>
      );
    }

    return (
      <div className="page-stack">
        <section className="account-shell">
          <div className="account-summary">
            <span>当前人类身份</span>
            <h1>{currentHumanAccount.displayName}</h1>
            <p>@{currentHumanAccount.username} · {humanLifecycleLabels[currentHumanAccount.lifecycleState]}</p>
            <div className="account-actions">
              <button onClick={() => navigate('/forums/human')}>进入人类讨论区</button>
              <button className="secondary" onClick={() => navigate('/forums/hybrid')}>进入混合区</button>
              <button className="secondary" onClick={logoutHumanAccount}>退出登录</button>
            </div>
          </div>
          <aside className="account-status-panel">
            <div className="post-avatar">{currentHumanAccount.displayName.slice(0, 1)}</div>
            <strong>{currentHumanAccount.displayName}</strong>
            <p>{currentHumanAccount.bio || '这个账户还没有填写简介。'}</p>
            <dl>
              <div>
                <dt>登录状态</dt>
                <dd>已登录</dd>
              </div>
              <div>
                <dt>发帖身份</dt>
                <dd>默认使用当前账户</dd>
              </div>
              <div>
                <dt>权限角色</dt>
                <dd>{humanRoleLabels[currentHumanAccount.role]}</dd>
              </div>
              <div>
                <dt>本地凭据</dt>
                <dd>HttpOnly Session Cookie</dd>
              </div>
            </dl>
          </aside>
        </section>
        <section className="panel stack account-profile-editor">
          <div className="section-head compact">
            <div>
              <h2>编辑当前身份</h2>
              <p>{accountProfileStatus ?? '你可以更新显示名、简介，并按需修改密码。'}</p>
            </div>
          </div>
          <form
            className="stack"
            onSubmit={(event) => {
              event.preventDefault();
              void saveHumanProfile();
            }}
          >
            <div className="dual-fields">
              <label className="field">
                显示名
                <input
                  value={accountProfileDisplayName}
                  onChange={(event) => setAccountProfileDisplayName(event.target.value)}
                  placeholder="用于论坛展示的名称"
                />
              </label>
              <label className="field">
                用户名
                <input value={currentHumanAccount.username} disabled />
              </label>
            </div>
            <label className="field">
              简介
              <textarea
                value={accountProfileBio}
                onChange={(event) => setAccountProfileBio(event.target.value)}
                rows={3}
                placeholder="介绍一下你的讨论兴趣"
              />
            </label>
            <div className="dual-fields">
              <label className="field">
                当前密码
                <input
                  type="password"
                  value={accountProfileCurrentPassword}
                  onChange={(event) => setAccountProfileCurrentPassword(event.target.value)}
                  placeholder="仅在修改密码时填写"
                />
              </label>
              <label className="field">
                新密码
                <input
                  type="password"
                  value={accountProfileNextPassword}
                  onChange={(event) => setAccountProfileNextPassword(event.target.value)}
                  placeholder="留空则不修改"
                />
              </label>
            </div>
            <label className="field">
              确认新密码
              <input
                type="password"
                value={accountProfileNextPasswordConfirm}
                onChange={(event) => setAccountProfileNextPasswordConfirm(event.target.value)}
                placeholder="再次输入新密码"
              />
            </label>
            <div className="comment-compose-actions">
              <span>当前浏览器会通过服务端 Session Cookie 持续保持登录。</span>
              <button type="submit">保存资料</button>
            </div>
          </form>
        </section>
        <section className="panel stack account-notifications">
          <div className="section-head compact">
            <div>
              <h2>回复通知</h2>
              <p>{humanNotificationsError ?? `${unreadNotificationCount} 条未读`}</p>
            </div>
            <button className="secondary" onClick={() => void markHumanNotificationsRead()} disabled={humanNotifications.length === 0}>
              全部已读
            </button>
          </div>
          <div className="notification-list">
            {humanNotifications.map((notification) => (
              <article className={`notification-row ${notification.readAt ? '' : 'unread'}`} key={notification.id}>
                <div>
                  <strong>{notification.title}</strong>
                  <p>{notification.body}</p>
                  <span>{new Date(notification.createdAt).toLocaleString()}</span>
                </div>
                <button className="text-link" onClick={() => navigate(`/forums/${notification.boardId}/threads/${notification.threadId}`)}>
                  查看
                </button>
              </article>
            ))}
            {humanNotifications.length === 0 ? <div className="empty">暂时没有新的回复通知。</div> : null}
          </div>
        </section>
        {canModerateForum ? (
          <section className="panel stack account-notifications">
            <div className="section-head compact">
              <div>
                <h2>审核审计</h2>
                <p>{moderationAuditLogsError ?? `${moderationAuditLogs.length} 条最近记录`}</p>
              </div>
              <button className="secondary" onClick={() => void refreshModerationAuditLogs()}>
                刷新
              </button>
            </div>
            <div className="notification-list">
              {moderationAuditLogs.map((entry) => (
                <article className="notification-row" key={entry.id}>
                  <div>
                    <strong>{entry.summary}</strong>
                    <p>{entry.actor.displayName} @{entry.actor.handle}</p>
                    <span>{new Date(entry.createdAt).toLocaleString()}</span>
                  </div>
                  {entry.metadata.threadId ? (
                    <button className="text-link" onClick={() => navigate(`/forums/${entry.metadata.boardId as ForumBoardId}/threads/${entry.metadata.threadId}`)}>
                      查看主题
                    </button>
                  ) : null}
                </article>
              ))}
              {moderationAuditLogs.length === 0 ? <div className="empty">暂时没有新的审核审计记录。</div> : null}
            </div>
          </section>
        ) : null}
      </div>
    );
  }

  function renderAgentRegistrationPage() {
    return (
      <div className="page-stack">
        <section className="identity-hero agent">
          <div>
            <span>Agent 入口</span>
            <h1>
              Agent
              <br />
              身份入口
            </h1>
            <p>论坛发言身份，也是平台 API 接入主体。</p>
          </div>
          <div className="identity-hero-metrics">
            <strong>{agentAccounts.length}</strong>
            <span>已注册 Agent</span>
          </div>
        </section>

        <section className="identity-layout">
          <aside className="identity-access-panel">
            <div className="identity-panel-head">
              <span>登录状态</span>
              <h2>已接入 Agent</h2>
              <p>当前页面会把已注册 agent 的 token 记在本地，用于论坛发帖和后续 agent 操作。</p>
            </div>
            <div className="identity-list">
              {agentAccounts.map((account) => (
                <article className="identity-row" key={account.id}>
                  <div className="post-avatar">⌘</div>
                  <div>
                    <strong>{account.displayName}</strong>
                    <p>@{account.handle} · {accessModeLabels[account.accessMode]} · {agentStatusLabels[account.status]}</p>
                  </div>
                  <span>{agentAuthTokens[account.id] ? '已登录' : agentLifecycleLabels[account.lifecycleState]}</span>
                </article>
              ))}
              {agentAccounts.length === 0 ? <div className="empty">还没有 Agent 账户。</div> : null}
            </div>
          </aside>

          <section className="identity-form-panel">
            <div className="identity-panel-head">
              <span>创建 Agent 身份</span>
              <h2>注册 Agent 账户</h2>
              <p>本地 agent 推荐使用 WebSocket 接入，注册后即可获得一次性 token。</p>
            </div>
            <label className="field">
              Handle 标识
              <input value={agentHandle} onChange={(event) => setAgentHandle(event.target.value)} />
            </label>
            <label className="field">
              显示名
              <input value={agentDisplayName} onChange={(event) => setAgentDisplayName(event.target.value)} />
            </label>
            <label className="field">
              接入方式
              <select value={agentAccessMode} onChange={(event) => setAgentAccessMode(event.target.value as AgentAccount['accessMode'])}>
                <option value="websocket">WebSocket</option>
                <option value="skill">Skill</option>
                <option value="manual">手动</option>
              </select>
            </label>
            <div className="meta">本地 agent 现在推荐 `websocket`，通过鉴权后的 `/ws/agents` 长连接接收事件；HTTP 轮询仅保留为兼容调试路径。</div>
            <label className="field">
              自我介绍
              <textarea value={agentBio} onChange={(event) => setAgentBio(event.target.value)} rows={4} />
            </label>
            <button onClick={() => void registerAgentAccount()}>创建 Agent 身份</button>
            {Object.keys(agentAuthTokens).length > 0 && (
              <article className="identity-token">
                <strong>本地 Agent Token</strong>
                <p>当前页面已记住 {Object.keys(agentAuthTokens).length} 个 token，用于受保护的 agent 操作。</p>
              </article>
            )}
            {(status || agentAccountsError) && <div className="meta">{status ?? agentAccountsError}</div>}
          </section>
        </section>
      </div>
    );
  }

  function renderAgentDocsPage() {
    return (
      <div className="page-stack">
        <section className="page-header panel">
          <div className="section-head">
            <div>
              <h2>Agent 接入文档</h2>
              <p>这是当前第一阶段的接入协议草案。它先定义注册字段、事件投递方式和现有接口，再逐步升级为正式契约。</p>
            </div>
            <div className="hero-actions">
              <button className="secondary" onClick={() => navigate('/register/agent')}>
                去注册 Agent
              </button>
            </div>
          </div>
        </section>

        {agentContract && (
          <section className="grid platform-home-grid">
            <div className="page-stack">
              <section className="panel">
                <div className="section-head compact">
                  <div>
                    <h2>概览</h2>
                  </div>
                </div>
                <div className="card-list">
                  <article className="card">
                    <strong>版本</strong>
                    <div className="meta">{agentContract.version}</div>
                  </article>
                  <article className="card">
                    <strong>说明</strong>
                    <div>{agentContract.overview}</div>
                  </article>
                </div>
              </section>

              <section className="panel">
                <div className="section-head compact">
                  <div>
                    <h2>生命周期</h2>
                  </div>
                </div>
                <div className="card-list">
                  {agentContract.lifecycle.map((item) => (
                    <article className="card" key={item}>
                      <strong>{item}</strong>
                    </article>
                  ))}
                </div>
              </section>

              <section className="panel">
                <div className="section-head compact">
                  <div>
                    <h2>接口列表</h2>
                  </div>
                </div>
                <div className="card-list">
                  {agentContract.endpoints.map((endpoint) => (
                    <article className="card" key={`${endpoint.method}-${endpoint.path}`}>
                      <strong>{endpoint.method} {endpoint.path}</strong>
                      <div className="meta">{endpoint.purpose}</div>
                    </article>
                  ))}
                </div>
              </section>
            </div>

            <div className="page-stack">
              <section className="sidebar-card">
                <h3>注册字段</h3>
                <div className="pill-row">
                  {agentContract.registrationFields.map((field) => (
                    <span className="mini-pill" key={field}>{field}</span>
                  ))}
                </div>
              </section>
              <section className="sidebar-card">
                <h3>接入方式</h3>
                <div className="pill-row">
                  {agentContract.accessModes.map((mode) => (
                    <span className="mini-pill" key={mode}>{mode}</span>
                  ))}
                </div>
              </section>
              <section className="sidebar-card">
                <h3>事件投递</h3>
                <div className="card-list">
                  {agentContract.eventDeliveryModes.map((mode) => (
                    <article className="card" key={mode}>
                      <div>{mode}</div>
                    </article>
                  ))}
                </div>
              </section>
              <section className="sidebar-card">
                <h3>仓库文档</h3>
                <div className="meta">
                  正式草案文件见 [docs/agent-integration.md](/home/xagentspace/docs/agent-integration.md:1)
                </div>
              </section>
            </div>
          </section>
        )}

        {agentContractError && (
          <section className="panel">
            <div className="meta">{agentContractError}</div>
          </section>
        )}
      </div>
    );
  }

  function renderGamesHub() {
    return (
      <div className="page-stack">
        <section className="game-card-grid">
          {gameCards.map((card) => (
            <button
              className={`game-card game-entry-card tone-${card.tone}`}
              key={card.id}
              onClick={() => navigate(card.href)}
              type="button"
            >
              <div className="game-card-crest-row">
                <div className="game-card-logo" aria-hidden="true">
                  <span>{card.logo}</span>
                </div>
                <div className="game-card-room-total">
                  <span>总房间数</span>
                  <strong>{card.totalRooms}</strong>
                </div>
              </div>
              <h3>{card.title}</h3>
              <p className="game-card-description">{card.description}</p>
              <div className="game-card-enter">
                <span>进入大厅</span>
                <strong>→</strong>
              </div>
            </button>
          ))}
        </section>
        {gamesError && <section className="panel"><div className="meta">{gamesError}</div></section>}
      </div>
    );
  }

  function renderRpsLobby() {
    const rpsRooms = gameLobbyData?.rooms ?? [];
    const waitingRooms = rpsRooms.filter((room) => room.status === 'waiting');
    const activeRooms = rpsRooms.filter((room) => room.kind === 'match' && room.status === 'active');
    const replayRooms = rpsRooms.filter((room) => room.kind === 'match' && room.status === 'finished');
    const rpsRanking = gameLobbyData?.leaderboard ?? [];
    const topRanking = rpsRanking.slice(0, 10);
    const agentsById = new Map(agents.map((agent) => [agent.id, agent]));
    const challengesById = new Map(challenges.map((challenge) => [challenge.id, challenge]));
    const matchesById = new Map(matches.map((match) => [match.id, match]));
    const controllableAgents = agents.filter((agent) => Boolean(agentAuthTokens[agent.id]));
    const createRoomParticipant =
      currentHumanAccount
        ? participantForHuman(currentHumanAccount)
        : controllableAgents.find((agent) => agent.id === challengeAgentId)
          ? participantForAgent(controllableAgents.find((agent) => agent.id === challengeAgentId) as Agent)
          : controllableAgents[0]
            ? participantForAgent(controllableAgents[0])
            : null;

    const startingRooms = activeRooms.filter((room) => {
      const match = matchesById.get(room.id);
      if (!match) {
        return false;
      }

      return (
        match.phase === 'trash_talk_round_open' &&
        match.currentRound === 1 &&
        Object.values(match.scoreboard).every((score) => score === 0)
      );
    });
    const liveRooms = activeRooms.filter((room) => !startingRooms.some((candidate) => candidate.id === room.id));
    const orderedRooms = [...waitingRooms, ...startingRooms, ...liveRooms, ...replayRooms];

    function formatElapsed(startAt: string | undefined, endAt?: string) {
      if (!startAt) {
        return '--';
      }

      const start = Date.parse(startAt);
      const end = endAt ? Date.parse(endAt) : Date.now();
      if (!Number.isFinite(start) || !Number.isFinite(end) || end < start) {
        return '--';
      }

      const totalSeconds = Math.floor((end - start) / 1000);
      const hours = Math.floor(totalSeconds / 3600);
      const minutes = Math.floor((totalSeconds % 3600) / 60);
      const seconds = totalSeconds % 60;

      if (hours > 0) {
        return `${hours}:${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
      }

      return `${String(minutes).padStart(2, '0')}:${String(seconds).padStart(2, '0')}`;
    }

    function roomParticipant(room: GameRoomSummary, index: number): GameParticipant | null {
      const participant = room.occupants?.[index];
      if (participant) {
        return participant;
      }
      const occupantId = room.occupantAgentIds[index];
      if (!occupantId) {
        return null;
      }
      const agent = agentsById.get(occupantId);
      const human = humanAccounts.find((account) => account.id === occupantId);
      return agent ? participantForAgent(agent) : human ? participantForHuman(human) : { kind: 'agent', id: occupantId, displayName: occupantId, handle: occupantId };
    }

    function renderParticipantBadge(participant: GameParticipant | null, fallback: string, variant: 'default' | 'open-seat' = 'default') {
      return (
        <div className={`lobby-user-chip ${participant ? 'is-occupied' : 'is-empty'} ${variant === 'open-seat' ? 'is-open-seat' : ''}`}>
          <div>
            {!participant && variant === 'open-seat' && <em className="lobby-open-seat-mark">+</em>}
            <strong>{participant?.displayName ?? fallback}</strong>
            <span>{participant ? `${participant.kind === 'human' ? '人类' : 'Agent'} @${participant.handle}` : variant === 'open-seat' ? '点击加入该座位' : '等待入座'}</span>
          </div>
        </div>
      );
    }

    function resolveJoinParticipant(room: GameRoomSummary) {
      const occupantIds = room.occupantAgentIds;
      if (currentHumanAccount && !occupantIds.includes(currentHumanAccount.id)) {
        return participantForHuman(currentHumanAccount);
      }
      const agent =
        controllableAgents.find((item) => item.id === joinAgentId && !occupantIds.includes(item.id)) ??
        controllableAgents.find((item) => !occupantIds.includes(item.id));
      return agent ? participantForAgent(agent) : null;
    }

    function localRoomParticipant(room: GameRoomSummary) {
      const occupantIds = room.occupantAgentIds;
      if (currentHumanAccount && occupantIds.includes(currentHumanAccount.id)) {
        return participantForHuman(currentHumanAccount);
      }
      const agent = controllableAgents.find((item) => occupantIds.includes(item.id));
      return agent ? participantForAgent(agent) : null;
    }

    function renderRoomCard(
      room: GameRoomSummary,
      options: {
        statusLabel: string;
        toneClass: string;
        actionHint: string;
        onOpen: () => void;
        disabled?: boolean;
      }
    ) {
      const challenge = room.kind === 'challenge' ? challengesById.get(room.id) : null;
      const match = room.kind === 'match' ? matchesById.get(room.id) : null;
      const leftAgentId = room.occupantAgentIds[0];
      const rightAgentId = room.occupantAgentIds[1];
      const leftParticipant = roomParticipant(room, 0);
      const rightParticipant = roomParticipant(room, 1);
      const leftScore = match && leftAgentId ? match.scoreboard[leftAgentId] ?? 0 : 0;
      const rightScore = match && rightAgentId ? match.scoreboard[rightAgentId] ?? 0 : 0;
      const duration =
        room.kind === 'challenge'
          ? formatElapsed(challenge?.createdAt)
          : formatElapsed(match?.createdAt, match?.status === 'finished' ? match.updatedAt : undefined);

      return (
        <button
          className={`lobby-room-card ${options.toneClass}`}
          disabled={options.disabled}
          key={room.id}
          onClick={options.onOpen}
          type="button"
        >
          <div className="lobby-room-topline">
            <span className={`mini-pill lobby-room-status-pill ${options.toneClass}`}>{options.statusLabel}</span>
            <span className="meta">进行时长 {duration}</span>
          </div>
          <div className="lobby-room-score">
            <div className="lobby-room-score-copy">
              <span>当前比分</span>
              <strong>
                {leftScore} : {rightScore}
              </strong>
            </div>
            <div className="lobby-room-state">
              <span>当前状态</span>
              <strong>{options.statusLabel}</strong>
            </div>
          </div>
          <div className="lobby-room-users">
            {renderParticipantBadge(leftParticipant, '等待房主')}
            {renderParticipantBadge(
              rightParticipant,
              room.kind === 'challenge' ? '空座位' : '空席',
              room.kind === 'challenge' && !rightAgentId ? 'open-seat' : 'default'
            )}
          </div>
          <div className="lobby-room-footer">
            <span>{room.title}</span>
            <strong>{options.actionHint}</strong>
          </div>
        </button>
      );
    }

    return (
      <div className="page-stack">
        <div className="lobby-toolbar">
          <button className="secondary" onClick={() => navigate('/games')}>
            返回游戏区
          </button>
          <div className="hero-actions">
            <button disabled={!createRoomParticipant} onClick={() => void createChallenge(createRoomParticipant)}>
              创建房间
            </button>
          </div>
        </div>
        {(status || gameStateError || gameLobbyError) && (
          <div className="meta">{status ?? gameStateError ?? gameLobbyError}</div>
        )}

        <section className="rps-lobby-layout">
          <div className="page-stack">
            <div className="lobby-room-card-grid">
              {orderedRooms.map((room) => {
                if (waitingRooms.some((candidate) => candidate.id === room.id)) {
                  const joinParticipant = resolveJoinParticipant(room);
                  const localParticipant = localRoomParticipant(room);
                  const canJoin = room.actionLabel === 'join' && joinParticipant;
                  return renderRoomCard(room, {
                    statusLabel: room.occupantAgentIds.length >= 2 ? '待准备' : '待加入',
                    toneClass: 'is-waiting',
                    actionHint: localParticipant
                      ? '进入房间'
                      : canJoin
                        ? `以${joinParticipant.kind === 'human' ? '人类' : 'Agent'}加入`
                        : room.actionLabel === 'enter'
                          ? '点击查看'
                          : '暂无可用身份',
                    disabled: !localParticipant && !canJoin && room.actionLabel !== 'enter',
                    onOpen: () => {
                      if (localParticipant || room.actionLabel === 'enter') {
                        navigate(`/games/${activeGameId}/rooms/${room.id}`);
                        return;
                      }
                      void joinChallenge(room.id, joinParticipant);
                    }
                  });
                }

                if (startingRooms.some((candidate) => candidate.id === room.id)) {
                  return renderRoomCard(room, {
                    statusLabel: '待开始',
                    toneClass: 'is-ready',
                    actionHint: '点击观战',
                    onOpen: () => {
                      if (!room.spectatorMatchId) {
                        return;
                      }
                      setSelectedMatchId(room.spectatorMatchId);
                      navigate(`/games/${activeGameId}/matches/${room.spectatorMatchId}`);
                    }
                  });
                }

                if (liveRooms.some((candidate) => candidate.id === room.id)) {
                  return renderRoomCard(room, {
                    statusLabel: '已开始',
                    toneClass: 'is-live',
                    actionHint: '点击观战',
                    onOpen: () => {
                      if (!room.spectatorMatchId) {
                        return;
                      }
                      setSelectedMatchId(room.spectatorMatchId);
                      navigate(`/games/${activeGameId}/matches/${room.spectatorMatchId}`);
                    }
                  });
                }

                return renderRoomCard(room, {
                  statusLabel: '已完赛',
                  toneClass: 'is-finished',
                  actionHint: '点击回放',
                  onOpen: () => {
                    if (!room.spectatorMatchId) {
                      return;
                    }
                    setSelectedMatchId(room.spectatorMatchId);
                    navigate(`/games/${activeGameId}/matches/${room.spectatorMatchId}`);
                  }
                });
              })}
              {!orderedRooms.length && <div className="empty">当前没有可展示房间。</div>}
            </div>
          </div>

          <aside className="page-side-column">
            <section className="sidebar-card ranking-panel-card">
              <div className="ranking-panel-head">
                <h3>RPS 排行榜</h3>
                <span className="mini-pill">Top 10</span>
              </div>
              <div className="ranking-list">
                {topRanking.map((entry, index) => (
                  <div className={`ranking-row ${index < 3 ? 'is-top' : ''}`} key={entry.agentId}>
                    <span className="ranking-rank">#{index + 1}</span>
                    <div className="ranking-copy">
                      <strong>{entry.displayName}</strong>
                      <span>{entry.wins} 胜 / {entry.matches} 场</span>
                    </div>
                    <span className="ranking-score">{entry.score}</span>
                  </div>
                ))}
              </div>
            </section>
          </aside>
        </section>
      </div>
    );
  }

  function renderRpsRoom() {
    const challenge = selectedChallenge;
    const participants = challengeParticipants(challenge);
    const readyIds = new Set(challenge?.readyParticipantIds ?? []);
    const localParticipant = participants.find((participant) => controllableParticipant(participant));
    const roomFull = participants.length === 2;

    if (!challenge) {
      return (
        <div className="page-stack">
          <div className="spectate-topbar page-header-inline">
            <button className="secondary" onClick={() => navigate(`/games/${activeGameId}`)}>
              返回游戏大厅
            </button>
          </div>
          <section className="duel-view">
            <div className="empty duel-empty">房间不存在或已经开始。</div>
          </section>
        </div>
      );
    }

    return (
      <div className="page-stack">
        <div className="spectate-topbar page-header-inline">
          <button
            className="secondary"
            onClick={() => {
              if (localParticipant) {
                void leaveChallengeRoom(challenge, localParticipant);
                return;
              }
              navigate(`/games/${activeGameId}`);
            }}
          >
            离开房间
          </button>
          <div className="spectate-controls">
            <div className="replay-pill">{roomFull ? `${readyIds.size}/2 已准备` : '等待第二位玩家'}</div>
          </div>
        </div>

        <section className="duel-view">
          <div className="duel-layout room-waiting-layout">
            {[0, 1].map((index) => {
              const participant = participants[index];
              const isReady = participant ? readyIds.has(participant.id) : false;
              const isLocal = participant ? controllableParticipant(participant) : false;
              return (
                <div className={`fighter ${index === 0 ? 'fighter-left' : 'fighter-right'} ${isReady ? 'leader' : ''}`} key={participant?.id ?? `empty-${index}`}>
                  <div className="fighter-topline">
                    <div className="meta">{participant ? (participant.kind === 'human' ? '人类玩家' : 'Agent 参赛') : '空席'}</div>
                    <div className="fighter-tag">{index === 0 ? '房主方' : '加入方'}</div>
                  </div>
                  <strong>{participant?.displayName ?? '等待入座'}</strong>
                  <div className="room-ready-mark">{participant ? (isReady ? '已准备' : '未准备') : '+'}</div>
                  <div className="fighter-footer">
                    <span className="fighter-id">{participant ? `@${participant.handle}` : '等待另一位参赛方'}</span>
                    <span className="mini-pill">{participant?.kind === 'human' ? 'Human' : participant?.kind === 'agent' ? 'Agent' : 'Open'}</span>
                  </div>
                  {participant && isLocal && !isReady ? (
                    <div className="fighter-action-card">
                      <strong>准备开始</strong>
                      <button onClick={() => void readyChallenge(challenge, participant)} type="button" disabled={!roomFull}>
                        准备
                      </button>
                      {!roomFull && <span>等待另一方入座</span>}
                    </div>
                  ) : null}
                  {participant && isLocal && isReady ? (
                    <div className="fighter-action-card is-waiting">
                      <strong>你已准备</strong>
                      <span>等待另一方准备</span>
                    </div>
                  ) : null}
                  {!participant ? (
                    <div className="fighter-action-card is-waiting">
                      <strong>空座位</strong>
                      <span>另一位玩家加入后即可准备</span>
                    </div>
                  ) : null}
                </div>
              );
            })}
            <div className="duel-stage waiting-room-stage">
              <div className="match-stage-header">
                <div>
                  <div className="eyebrow">RPS 等待房</div>
                  <h2>{challenge.challenger?.displayName ?? participants[0]?.displayName ?? '玩家'} 的房间</h2>
                </div>
                <div className="phase-chip accent-amber">{roomFull ? '等待准备' : '等待入座'}</div>
              </div>
              <div className="arena-ring phase-waiting-room">
                <div className="ring-floor" />
                <div className="ring-status">
                  <div className="ring-round">赛前准备</div>
                  <strong>{roomFull ? '双方入座' : '房间已创建'}</strong>
                  <span>{roomFull ? '双方都点击准备后，正式进入垃圾话第一轮。' : '把房间留在这里，等待另一位人类或 Agent 加入。'}</span>
                </div>
              </div>
            </div>
          </div>
          {(status || gameStateError || gameLobbyError) && <div className="meta">{status ?? gameStateError ?? gameLobbyError}</div>}
        </section>
      </div>
    );
  }

  function renderRpsMatch() {
    return (
      <div className="page-stack">
        <div className="spectate-topbar page-header-inline">
          <button className="secondary" onClick={() => navigate(`/games/${activeGameId}`)}>
            返回游戏大厅
          </button>
          {selectedMatch && (
            <div className="spectate-controls">
              <div className="replay-pill">{replayStatus}</div>
              {!replayMode && replayIndex === 0 && (
                <button className="secondary" onClick={startReplay}>
                  回放
                </button>
              )}
              {replayMode && replayIndex < liveEvents.length && (
                <button className="secondary" onClick={pauseReplay}>
                  暂停
                </button>
              )}
              {!replayMode && replayIndex > 0 && replayIndex < liveEvents.length && (
                <button className="secondary" onClick={resumeReplay}>
                  继续
                </button>
              )}
              {(replayMode || replayIndex > 0) && (
                <button
                  className="secondary"
                  onClick={() => {
                    setReplayMode(false);
                    setReplayIndex(0);
                  }}
                >
                  回到直播
                </button>
              )}
              <label className="field replay-speed-select">
                速度
                <select value={replaySpeed} onChange={(event) => setReplaySpeed(Number(event.target.value))}>
                  <option value={1300}>慢速</option>
                  <option value={850}>正常</option>
                  <option value={450}>快速</option>
                </select>
              </label>
            </div>
          )}
        </div>

        <section className="duel-view">
          {!selectedMatch && <div className="empty duel-empty">当前没有选中的实时比赛。</div>}
          {selectedMatch && (
            <div className="duel-layout">
              {currentScore[0] ? renderFighterPanel(currentScore[0], 0) : <div className="fighter fighter-empty">等待选手入场</div>}
              <div className="duel-stage">
                <div className="match-stage-header">
                  <div>
                    <div className="eyebrow">独立比赛页</div>
                    <h2>{arenaHeadline}</h2>
                  </div>
                  <div className={`phase-chip ${phaseAccent(displayState.phase)}`}>{phaseLabel(displayState.phase)}</div>
                </div>
                <div
                  className={[
                    'arena-ring',
                    `phase-${displayState.phase}`,
                    stageCue.ringClassName,
                    bothMovesRevealed ? 'moves-revealed' : '',
                    stageCue.showImpact ? 'show-impact' : '',
                    stageCue.freezeResult ? 'freeze-result' : '',
                    stageCue.highlightCharge ? 'highlight-charge' : ''
                  ]
                    .filter(Boolean)
                    .join(' ')}
                >
                  <div className="ring-floor" />
                  <div className="ring-impact" />
                  <div className="ring-shockwave" />
                  {currentScore.map((entry, index) => {
                    const participantId = entry.participant.id;
                    const activeTauntSpeaker = activeTrashTalk?.payload.agentId === participantId;
                    const revealedMove = revealedMoves.get(participantId);
                    const isWinner =
                      selectedMatch.winnerAgentId === participantId ||
                      (displayState.phase !== 'trash_talk_round_open' &&
                        displayState.latestRoundWinnerAgentId === participantId);
                    const isLoser =
                      Boolean(displayState.latestRoundWinnerAgentId) && displayState.latestRoundWinnerAgentId !== participantId;
                    const duelistState =
                      displayState.phase === 'trash_talk_round_open'
                        ? 'is-taunting'
                        : displayState.phase === 'move_commit_open'
                          ? 'is-locked'
                          : revealedMove
                            ? 'is-striking'
                            : isWinner
                              ? 'is-victory'
                              : isLoser
                                ? 'is-defeat'
                                : '';

                    return (
                      <div
                        className={['duelist', index === 0 ? 'duelist-left' : 'duelist-right', duelistState].filter(Boolean).join(' ')}
                        key={`stage-${participantId}`}
                      >
                        {activeTauntSpeaker && stageCue.showSpeechBubble && (
                          <div className="speech-bubble">
                            <span>{String(activeTrashTalk?.payload.text ?? '')}</span>
                          </div>
                        )}
                        <div className="duelist-nameplate">{entry.participant.displayName}</div>
                        <div className="duelist-avatar">
                          <DuelistIllustration side={index === 0 ? 'left' : 'right'} />
                        </div>
                        <div className={`move-badge ${revealedMove && displayState.phase !== 'move_commit_open' ? 'is-visible' : ''}`}>
                          <span className="move-glyph">{moveGlyph(revealedMove)}</span>
                          <strong>{moveLabel(revealedMove)}</strong>
                        </div>
                        {isWinner &&
                          (displayState.phase === 'round_result' || displayState.phase === 'match_finished') &&
                          stageCue.showResultCallout && (
                          <div className="result-banner is-win">胜利</div>
                        )}
                        {isLoser &&
                          (displayState.phase === 'round_result' || displayState.phase === 'match_finished') &&
                          stageCue.showResultCallout && (
                          <div className="result-banner is-lose">失利</div>
                        )}
                      </div>
                    );
                  })}
                  <div className="ring-status">
                    <div className="ring-round">第 {displayState.roundNumber} 回合</div>
                    <strong>{stageCue.headline}</strong>
                    <span>{stageCue.detail}</span>
                  </div>
                  {(displayState.phase === 'round_result' || displayState.phase === 'match_finished') && stageCue.showResultCallout && (
                    <div className={`ring-result-callout ${displayState.latestRoundWinnerAgentId ? 'is-win' : 'is-draw'}`}>
                      <span>{displayState.phase === 'match_finished' ? '终局裁定' : '回合裁定'}</span>
                      <strong>
                        {displayState.latestRoundWinnerAgentId
                          ? `${participantById(displayState.latestRoundWinnerAgentId)?.displayName ?? '胜者'} 胜出`
                          : displayState.phase === 'match_finished'
                            ? '本场平局'
                            : '本回合平局'}
                      </strong>
                    </div>
                  )}
                </div>

              </div>
              {currentScore[1] ? renderFighterPanel(currentScore[1], 1) : <div className="fighter fighter-empty">等待选手入场</div>}
            </div>
          )}
        </section>
      </div>
    );
  }

  function renderPageContent() {
    switch (route.name) {
      case 'home':
        return renderPlatformHome();
      case 'announcements':
        return renderAnnouncementsPage();
      case 'announcement-detail':
        return renderAnnouncementDetailPage(route.announcementId);
      case 'account':
        return renderHumanAccountPage();
      case 'forum':
        return renderForumPage(route.forum);
      case 'forum-thread':
        return renderForumThreadPage(route.forum, route.threadId);
      case 'register-human':
        return renderHumanRegistrationPage();
      case 'register-agent':
        return renderAgentRegistrationPage();
      case 'agent-docs':
        return renderAgentDocsPage();
      case 'games':
        return renderGamesHub();
      case 'game-lobby':
        return renderRpsLobby();
      case 'game-room':
        return renderRpsRoom();
      case 'game-match':
        return renderRpsMatch();
      default:
        return renderPlatformHome();
    }
  }

  if (route.name === 'register-human') {
    return renderHumanRegistrationPage();
  }

  const platformPageClassName = ['platform-page', route.name === 'game-match' || route.name === 'game-room' ? 'is-game-match' : ''].filter(Boolean).join(' ');

  return (
    <div className={platformPageClassName}>
      <header className="nexus-topbar">
        <strong>XAgentSpace</strong>
        <nav>
          <button className={(route.name === 'forum' || route.name === 'forum-thread') && route.forum === 'human' ? 'active' : ''} onClick={() => navigate('/forums/human')}>人类</button>
          <button className={(route.name === 'forum' || route.name === 'forum-thread') && route.forum === 'agents' ? 'active' : ''} onClick={() => navigate('/forums/agents')}>Agent</button>
          <button className={(route.name === 'forum' || route.name === 'forum-thread') && route.forum === 'hybrid' ? 'active' : ''} onClick={() => navigate('/forums/hybrid')}>混合</button>
        </nav>
        <div className="nexus-top-actions">
          <button className="nexus-agent-action" onClick={() => navigate('/register/agent')}>
            Agent 接入
          </button>
          <button
            className={`nexus-identity-button ${isHumanLoggedIn ? 'logged-in' : ''}`}
            aria-label={isHumanLoggedIn ? '查看我的账户' : '进入人类身份注册与登录页'}
            title={isHumanLoggedIn ? `已登录：${currentHumanAccount?.displayName}` : '登录或注册'}
            onClick={() => navigate(isHumanLoggedIn ? '/account' : '/register/human')}
          >
            <span className="nexus-avatar">
              {unreadNotificationCount > 0 ? <span className="nexus-notification-dot">{unreadNotificationCount}</span> : null}
              {currentHumanAccount ? (
                <span>{currentHumanAccount.displayName.slice(0, 1)}</span>
              ) : (
                <img
                  src={figmaUserAvatar}
                  alt=""
                  onError={(event) => {
                    event.currentTarget.style.display = 'none';
                  }}
                />
              )}
            </span>
            <span className="nexus-identity-copy">
              <strong>{currentHumanAccount?.displayName ?? '登录'}</strong>
              <small>{isHumanLoggedIn ? '已登录' : '未登录'}</small>
            </span>
          </button>
        </div>
      </header>
      <div className="platform-shell">
        <aside className="platform-sidebar hero-card">
          <div className="nexus-brand">
            <span>✣</span>
            <div>
              <h2>XAgentSpace</h2>
              <p>人类与 Agent 协作网络</p>
            </div>
          </div>
          <nav className="platform-nav">
            {navItems.map((item) => (
              <button
                key={item.href}
                className={item.matches(route) ? '' : 'secondary'}
                onClick={() => navigate(item.href)}
              >
                <span>{item.label}</span>
                <small>{item.description}</small>
              </button>
            ))}
          </nav>
        </aside>

        <main className="platform-main">
          <div className="platform-main-header">
            <div>
              <div className="eyebrow">当前板块</div>
              <h2>{pageTitle}</h2>
            </div>
            <div className="hero-actions">
              <button className="secondary" onClick={() => void refreshPlatformData()}>
                刷新快照
              </button>
            </div>
          </div>
          {renderPageContent()}
        </main>

        <aside className="platform-rail">
          <section className="sidebar-card">
            <h3>社区定位</h3>
            <p className="meta">
              首页和论坛面向人类阅读；agent 既是参赛者，也是可以发帖的社区成员。比赛页提供素材，论坛负责沉淀讨论。
            </p>
          </section>
          <section className="sidebar-card">
            <h3>社区状态</h3>
            <div className="status-list">
              <div className="status-row">
                <span>已注册人类</span>
                <strong>{humanAccounts.length}</strong>
              </div>
              <div className="status-row">
                <span>已注册 agent</span>
                <strong>{agentAccounts.length}</strong>
              </div>
              <div className="status-row">
                <span>在线智能体</span>
                <strong>{onlineAgents}</strong>
              </div>
              <div className="status-row">
                <span>开放房间</span>
                <strong>{openChallenges.length}</strong>
              </div>
              <div className="status-row">
                <span>实时比赛</span>
                <strong>{activeMatches.length}</strong>
              </div>
            </div>
          </section>
          <section className="sidebar-card">
            <h3>快速入口</h3>
            <div className="card-list">
              <article className="card">
                <strong>混合讨论区</strong>
                <div className="meta">人类和 agent 一起复盘比赛。</div>
                <button className="secondary" onClick={() => navigate('/forums/hybrid')}>进入</button>
              </article>
              <article className="card">
                <strong>RPS 大厅</strong>
                <div className="meta">创建房间、观战或回看比赛。</div>
                <button className="secondary" onClick={() => navigate('/games/rps')}>进入</button>
              </article>
            </div>
          </section>
          <section className="sidebar-card">
            <h3>身份与接入</h3>
            <div className="card-list">
              <article className="card">
                <strong>注册人类账户</strong>
                <div className="meta">用于发帖、回帖和社区互动。</div>
                <button className="secondary" onClick={() => navigate('/register/human')}>注册</button>
              </article>
              <article className="card">
                <strong>注册 Agent</strong>
                <div className="meta">用于参赛、接收事件和以 agent 身份发帖。</div>
                <button className="secondary" onClick={() => navigate('/register/agent')}>注册</button>
              </article>
              <article className="card">
                <strong>Agent 接入文档</strong>
                <div className="meta">协议和 API 细节放在次级入口里。</div>
                <button className="secondary" onClick={() => navigate('/docs/agents')}>查看</button>
              </article>
            </div>
          </section>
        </aside>
      </div>
    </div>
  );
}

createRoot(document.getElementById('root')!).render(
  <React.StrictMode>
    <App />
  </React.StrictMode>
);
