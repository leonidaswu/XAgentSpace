import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  AgentAccount,
  Announcement,
  AnnouncementListQuery,
  ForumPost,
  ForumPostReaction,
  ForumReport,
  ForumThread,
  ForumThreadDetail,
  ForumThreadFilters,
  ForumBoardId,
  ForumBoardSnapshot,
  HumanAccount,
  HumanNotification,
  HumanSession,
  ModerationAuditLog
} from './types.js';
import type { PersistedGameModuleState } from './game.js';

export const DEFAULT_STATE_FILE = path.resolve(process.cwd(), 'data/platform-state.json');
export const DEFAULT_SQLITE_FILE = path.resolve(process.cwd(), 'data/platform-state.sqlite');

export type PersistedPlatformState = {
  humans: HumanAccount[];
  agentAccounts: AgentAccount[];
  humanAuthTokens: Array<[string, string]>;
  agentAuthTokens: Array<[string, string]>;
  forumThreads: ForumThread[];
  forumPosts: ForumPost[];
  forumPostReactions?: ForumPostReaction[];
  forumReports: ForumReport[];
  humanNotifications?: HumanNotification[];
  humanSessions?: HumanSession[];
  moderationAuditLogs?: ModerationAuditLog[];
  announcements?: Announcement[];
  gameStates: Array<[string, PersistedGameModuleState]>;
};

type ForumBoardQueryResult = Omit<ForumBoardSnapshot, 'board' | 'filters'>;
type ForumThreadQueryResult = Omit<ForumThreadDetail, 'board'>;
export type ForumTagStat = {
  tag: string;
  score: number;
};

export interface PlatformStorage {
  load(): PersistedPlatformState | null;
  save(state: PersistedPlatformState): void;
  queryForumBoard?(
    boardId: ForumBoardId,
    filters: ForumThreadFilters,
    pagination?: { cursor?: string; limit?: number }
  ): ForumBoardQueryResult;
  queryForumThread?(
    threadId: string,
    pagination?: { cursor?: string; limit?: number; sort?: 'latest' | 'hot' }
  ): ForumThreadQueryResult | null;
  searchForumThreads?(filters: ForumThreadFilters & { boardId?: ForumBoardId; limit?: number }): ForumThread[];
  listForumThreadsForMatch?(gameId: string, matchId: string): ForumThread[];
  listForumReports?(filters?: { status?: ForumReport['status'] | 'all'; boardId?: ForumBoardId }): ForumReport[];
  listHumanNotifications?(humanId: string): HumanNotification[];
  listModerationAuditLogs?(query?: { scope?: ModerationAuditLog['scope']; limit?: number }): ModerationAuditLog[];
  listAnnouncements?(query?: AnnouncementListQuery): Announcement[];
  getAnnouncement?(announcementId: string): Announcement | null;
  listForumTagStats?(query?: { limit?: number; boardId?: ForumBoardId }): ForumTagStat[];
}

export function createDefaultPlatformStorage(options?: { stateFilePath?: string; sqliteFilePath?: string }) {
  const storageKind = process.env.XAGENTSPACE_STORAGE?.trim().toLowerCase() ?? 'sqlite';
  if (storageKind === 'sqlite') {
    return new SqlitePlatformStorage(resolveSqliteFilePath(options));
  }

  if (storageKind !== 'json') {
    throw new Error(`Unsupported XAGENTSPACE_STORAGE value: ${storageKind}`);
  }

  return new JsonFilePlatformStorage(options?.stateFilePath);
}

function resolveSqliteFilePath(options?: { stateFilePath?: string; sqliteFilePath?: string }) {
  if (options?.sqliteFilePath) {
    return options.sqliteFilePath;
  }

  if (process.env.XAGENTSPACE_SQLITE_FILE) {
    return process.env.XAGENTSPACE_SQLITE_FILE;
  }

  if (options?.stateFilePath) {
    const parsed = path.parse(options.stateFilePath);
    return path.join(parsed.dir, `${parsed.name}.sqlite`);
  }

  return DEFAULT_SQLITE_FILE;
}

export class JsonFilePlatformStorage implements PlatformStorage {
  constructor(private readonly stateFilePath = process.env.AGENT_ARENA_STATE_FILE ?? DEFAULT_STATE_FILE) {}

  load(): PersistedPlatformState | null {
    if (!fs.existsSync(this.stateFilePath)) {
      return null;
    }

    try {
      const raw = fs.readFileSync(this.stateFilePath, 'utf8');
      return JSON.parse(raw) as PersistedPlatformState;
    } catch {
      return null;
    }
  }

  save(state: PersistedPlatformState) {
    const payload = JSON.stringify(state, null, 2);
    fs.mkdirSync(path.dirname(this.stateFilePath), { recursive: true });
    const tempPath = `${this.stateFilePath}.tmp`;
    fs.writeFileSync(tempPath, payload);
    fs.renameSync(tempPath, this.stateFilePath);
  }
}

type StoredPayloadRow = {
  payload: string;
};

type SqliteCountRow = {
  total: number;
};

type SqliteForumStatsRow = {
  thread_count: number;
  post_count: number;
  report_count: number;
  open_report_count: number;
  linked_thread_count: number;
  human_post_count: number;
  agent_post_count: number;
};

export class SqlitePlatformStorage implements PlatformStorage {
  private readonly database: {
    exec(sql: string): void;
    prepare(sql: string): {
      all(...params: unknown[]): unknown[];
      get(...params: unknown[]): unknown;
      run(...params: unknown[]): unknown;
    };
    close(): void;
  };

  constructor(private readonly databasePath: string) {
    fs.mkdirSync(path.dirname(databasePath), { recursive: true });
    const require = createRequire(path.join(process.cwd(), 'package.json'));
    const { DatabaseSync } = require('node:sqlite') as { DatabaseSync: new (path: string) => SqlitePlatformStorage['database'] };
    this.database = new DatabaseSync(databasePath);
    this.initializeSchema();
  }

  load(): PersistedPlatformState | null {
    const meta = this.database.prepare('SELECT value FROM platform_meta WHERE key = ?').get('initialized') as { value?: string } | undefined;
    if (meta?.value !== 'true') {
      return null;
    }

    return {
      humans: this.loadPayloadTable<HumanAccount>('human_accounts'),
      agentAccounts: this.loadPayloadTable<AgentAccount>('agent_accounts'),
      humanAuthTokens: this.loadTokenTable('human_auth_tokens'),
      agentAuthTokens: this.loadTokenTable('agent_auth_tokens'),
      forumThreads: this.loadPayloadTable<ForumThread>('forum_threads'),
      forumPosts: this.loadPayloadTable<ForumPost>('forum_posts'),
      forumPostReactions: this.loadPayloadTable<ForumPostReaction>('forum_post_reactions'),
      forumReports: this.loadPayloadTable<ForumReport>('forum_reports'),
      humanNotifications: this.loadPayloadTable<HumanNotification>('human_notifications'),
      humanSessions: this.loadPayloadTable<HumanSession>('human_sessions'),
      moderationAuditLogs: this.loadPayloadTable<ModerationAuditLog>('moderation_audit_logs'),
      announcements: this.loadPayloadTable<Announcement>('announcements'),
      gameStates: this.loadGameStates()
    };
  }

  save(state: PersistedPlatformState) {
    this.database.exec('BEGIN IMMEDIATE');
    try {
      this.replacePayloadTable('human_accounts', state.humans);
      this.replacePayloadTable('agent_accounts', state.agentAccounts);
      this.replaceTokenTable('human_auth_tokens', state.humanAuthTokens);
      this.replaceTokenTable('agent_auth_tokens', state.agentAuthTokens);
      this.replacePayloadTable('forum_threads', state.forumThreads);
      this.replacePayloadTable('forum_posts', state.forumPosts);
      this.replacePayloadTable('forum_post_reactions', state.forumPostReactions ?? []);
      this.replacePayloadTable('forum_reports', state.forumReports);
      this.replacePayloadTable('human_notifications', state.humanNotifications ?? []);
      this.replacePayloadTable('human_sessions', state.humanSessions ?? []);
      this.replacePayloadTable('moderation_audit_logs', state.moderationAuditLogs ?? []);
      this.replacePayloadTable('announcements', state.announcements ?? []);
      this.replaceGameStates(state.gameStates);
      this.database.prepare('INSERT OR REPLACE INTO platform_meta (key, value) VALUES (?, ?)').run('initialized', 'true');
      this.database.exec('COMMIT');
    } catch (error) {
      this.database.exec('ROLLBACK');
      throw error;
    }
  }

  close() {
    this.database.close();
  }

  queryForumBoard(
    boardId: ForumBoardId,
    filters: ForumThreadFilters,
    pagination?: { cursor?: string; limit?: number }
  ): ForumBoardQueryResult {
    const start = this.decodePageCursor(pagination?.cursor);
    const { whereSql, params } = this.buildForumThreadFilterClause(filters, boardId);
    const orderBySql = this.buildForumThreadOrderClause(filters.sort);
    const totalRow = this.database
      .prepare(`SELECT COUNT(*) AS total FROM forum_threads ft WHERE ${whereSql}`)
      .get(...params) as SqliteCountRow;
    const limit = this.normalizePageLimit(pagination?.limit, pagination?.limit ? 20 : Math.max(totalRow.total, 1));
    const threadRows = this.database
      .prepare(
        `SELECT ft.payload
         FROM forum_threads ft
         WHERE ${whereSql}
         ORDER BY ${orderBySql}
         LIMIT ? OFFSET ?`
      )
      .all(...params, limit, start) as StoredPayloadRow[];
    const threads = threadRows.map((row) => JSON.parse(row.payload) as ForumThread);
    const postsByThread = this.loadPostsByThread(threads.map((thread) => thread.id));
    const stats = this.database
      .prepare(
        `SELECT
          (SELECT COUNT(*) FROM forum_threads WHERE board_id = ?) AS thread_count,
          (SELECT COUNT(*) FROM forum_posts WHERE board_id = ?) AS post_count,
          (SELECT COUNT(*) FROM forum_reports WHERE board_id = ?) AS report_count,
          (SELECT COUNT(*) FROM forum_reports WHERE board_id = ? AND status IN ('open', 'reviewing')) AS open_report_count,
          (SELECT COUNT(*) FROM forum_threads WHERE board_id = ? AND json_extract(payload, '$.matchLink.gameId') IS NOT NULL) AS linked_thread_count,
          (SELECT COUNT(*) FROM forum_posts WHERE board_id = ? AND json_extract(payload, '$.author.kind') = 'human') AS human_post_count,
          (SELECT COUNT(*) FROM forum_posts WHERE board_id = ? AND json_extract(payload, '$.author.kind') = 'agent') AS agent_post_count`
      )
      .get(boardId, boardId, boardId, boardId, boardId, boardId, boardId) as SqliteForumStatsRow;

    return {
      threads,
      postsByThread,
      pageInfo: {
        limit,
        total: totalRow.total,
        nextCursor: start + threads.length < totalRow.total ? String(start + threads.length) : undefined
      },
      stats: {
        threadCount: stats.thread_count,
        postCount: stats.post_count,
        reportCount: stats.report_count,
        openReportCount: stats.open_report_count,
        linkedThreadCount: stats.linked_thread_count,
        humanPostCount: stats.human_post_count,
        agentPostCount: stats.agent_post_count
      }
    };
  }

  searchForumThreads(filters: ForumThreadFilters & { boardId?: ForumBoardId; limit?: number }): ForumThread[] {
    const limit = this.normalizePageLimit(filters.limit, 50);
    const { whereSql, params } = this.buildForumThreadFilterClause(filters, filters.boardId);
    const rows = this.database
      .prepare(
        `SELECT ft.payload
         FROM forum_threads ft
         WHERE ${whereSql}
         ORDER BY ${this.buildForumThreadOrderClause(filters.sort)}
         LIMIT ?`
      )
      .all(...params, limit) as StoredPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as ForumThread);
  }

  queryForumThread(
    threadId: string,
    pagination?: { cursor?: string; limit?: number; sort?: 'latest' | 'hot' }
  ): ForumThreadQueryResult | null {
    const threadRow = this.database.prepare('SELECT payload FROM forum_threads WHERE id = ?').get(threadId) as StoredPayloadRow | undefined;
    if (!threadRow) {
      return null;
    }

    const thread = JSON.parse(threadRow.payload) as ForumThread;
    const start = this.decodePageCursor(pagination?.cursor);
    const totalRow = this.database
      .prepare('SELECT COUNT(*) AS total FROM forum_posts WHERE thread_id = ? AND parent_post_id IS NULL')
      .get(threadId) as SqliteCountRow;
    const limit = this.normalizePageLimit(pagination?.limit, pagination?.limit ? 20 : Math.max(totalRow.total, 1));
    const rootRows = this.database
      .prepare(
        `SELECT fp.payload
         FROM forum_posts fp
         LEFT JOIN (
           SELECT parent_post_id, COUNT(*) AS reply_count
           FROM forum_posts
           WHERE thread_id = ? AND parent_post_id IS NOT NULL
           GROUP BY parent_post_id
         ) replies ON replies.parent_post_id = fp.id
         WHERE fp.thread_id = ? AND fp.parent_post_id IS NULL
         ORDER BY ${this.buildForumPostOrderClause(pagination?.sort)}
         LIMIT ? OFFSET ?`
      )
      .all(threadId, threadId, limit, start) as StoredPayloadRow[];
    const rootPosts = rootRows.map((row) => JSON.parse(row.payload) as ForumPost);
    const repliesByParent = this.loadRepliesByParent(rootPosts.map((post) => post.id));
    const orderedPosts = rootPosts.flatMap((post) => [post, ...(repliesByParent[post.id] ?? [])]);
    const reportsByPost = this.loadReportsByPost(orderedPosts.map((post) => post.id));

    return {
      thread,
      posts: orderedPosts,
      reportsByPost,
      postsPageInfo: {
        limit,
        total: totalRow.total,
        nextCursor: start + rootPosts.length < totalRow.total ? String(start + rootPosts.length) : undefined
      }
    };
  }

  listForumThreadsForMatch(gameId: string, matchId: string): ForumThread[] {
    const rows = this.database
      .prepare(
        `SELECT payload
         FROM forum_threads
         WHERE json_extract(payload, '$.matchLink.gameId') = ?
           AND json_extract(payload, '$.matchLink.matchId') = ?
         ORDER BY updated_at DESC`
      )
      .all(gameId, matchId) as StoredPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as ForumThread);
  }

  listForumReports(filters?: { status?: ForumReport['status'] | 'all'; boardId?: ForumBoardId }): ForumReport[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (filters?.boardId) {
      conditions.push('board_id = ?');
      params.push(filters.boardId);
    }
    if (filters?.status && filters.status !== 'all') {
      conditions.push('status = ?');
      params.push(filters.status);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const rows = this.database
      .prepare(`SELECT payload FROM forum_reports ${whereSql} ORDER BY json_extract(payload, '$.updatedAt') DESC, created_at DESC`)
      .all(...params) as StoredPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as ForumReport);
  }

  listHumanNotifications(humanId: string): HumanNotification[] {
    const rows = this.database
      .prepare('SELECT payload FROM human_notifications WHERE human_id = ? ORDER BY created_at DESC')
      .all(humanId) as StoredPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as HumanNotification);
  }

  listModerationAuditLogs(query?: { scope?: ModerationAuditLog['scope']; limit?: number }): ModerationAuditLog[] {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (query?.scope) {
      conditions.push('scope = ?');
      params.push(query.scope);
    }
    const whereSql = conditions.length > 0 ? `WHERE ${conditions.join(' AND ')}` : '';
    const limit = this.normalizePageLimit(query?.limit, 50);
    const rows = this.database
      .prepare(`SELECT payload FROM moderation_audit_logs ${whereSql} ORDER BY created_at DESC LIMIT ?`)
      .all(...params, limit) as StoredPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as ModerationAuditLog);
  }

  listAnnouncements(query?: AnnouncementListQuery): Announcement[] {
    const includeArchived = Boolean(query?.includeArchived);
    const limit = this.normalizePageLimit(query?.limit, includeArchived ? 50 : 5);
    const whereSql = includeArchived ? '' : 'WHERE status != ?';
    const params: unknown[] = includeArchived ? [] : ['archived'];
    const orderBySql =
      query?.sort === 'latest'
        ? 'published_at DESC'
        : 'is_pinned DESC, published_at DESC';
    const rows = this.database
      .prepare(`SELECT payload FROM announcements ${whereSql} ORDER BY ${orderBySql} LIMIT ?`)
      .all(...params, limit) as StoredPayloadRow[];
    return rows.map((row) => JSON.parse(row.payload) as Announcement);
  }

  getAnnouncement(announcementId: string): Announcement | null {
    const row = this.database.prepare('SELECT payload FROM announcements WHERE id = ?').get(announcementId) as StoredPayloadRow | undefined;
    return row ? (JSON.parse(row.payload) as Announcement) : null;
  }

  listForumTagStats(query?: { limit?: number; boardId?: ForumBoardId }): ForumTagStat[] {
    const limit = this.normalizePageLimit(query?.limit, 8);
    const whereSql = query?.boardId ? 'WHERE ft.board_id = ?' : '';
    const params: unknown[] = query?.boardId ? [query.boardId] : [];
    const rows = this.database
      .prepare(
        `SELECT
           tags.value AS tag,
           SUM(CASE
             WHEN CAST(COALESCE(json_extract(ft.payload, '$.postCount'), 0) AS INTEGER) > 0
             THEN CAST(json_extract(ft.payload, '$.postCount') AS INTEGER)
             ELSE 1
           END) AS score
         FROM forum_threads ft
         JOIN json_each(ft.payload, '$.tags') AS tags
         ${whereSql}
         GROUP BY lower(CAST(tags.value AS TEXT))
         ORDER BY score DESC, lower(CAST(tags.value AS TEXT)) ASC
         LIMIT ?`
      )
      .all(...params, limit) as Array<{ tag: string; score: number }>;
    return rows.map((row) => ({ tag: row.tag, score: row.score }));
  }

  private initializeSchema() {
    this.database.exec(`
      PRAGMA foreign_keys = ON;
      PRAGMA journal_mode = WAL;

      CREATE TABLE IF NOT EXISTS platform_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS human_accounts (
        id TEXT PRIMARY KEY,
        username TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agent_accounts (
        id TEXT PRIMARY KEY,
        handle TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS human_auth_tokens (
        human_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS agent_auth_tokens (
        agent_id TEXT PRIMARY KEY,
        token_hash TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS forum_threads (
        id TEXT PRIMARY KEY,
        board_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS forum_posts (
        id TEXT PRIMARY KEY,
        thread_id TEXT NOT NULL,
        parent_post_id TEXT,
        board_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS forum_post_reactions (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        actor_kind TEXT NOT NULL,
        actor_id TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL,
        UNIQUE(post_id, actor_kind, actor_id)
      ) STRICT;

      CREATE TABLE IF NOT EXISTS forum_reports (
        id TEXT PRIMARY KEY,
        post_id TEXT NOT NULL,
        board_id TEXT NOT NULL,
        status TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS human_notifications (
        id TEXT PRIMARY KEY,
        human_id TEXT NOT NULL,
        read_at TEXT,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS human_sessions (
        id TEXT PRIMARY KEY,
        human_id TEXT NOT NULL,
        expires_at TEXT NOT NULL,
        revoked_at TEXT,
        last_used_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS moderation_audit_logs (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        target_id TEXT NOT NULL,
        created_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS announcements (
        id TEXT PRIMARY KEY,
        status TEXT NOT NULL,
        is_pinned INTEGER NOT NULL,
        published_at TEXT NOT NULL,
        updated_at TEXT NOT NULL,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE TABLE IF NOT EXISTS game_states (
        game_id TEXT PRIMARY KEY,
        payload TEXT NOT NULL
      ) STRICT;

      CREATE INDEX IF NOT EXISTS forum_threads_board_updated_idx ON forum_threads(board_id, updated_at);
      CREATE INDEX IF NOT EXISTS forum_threads_board_created_idx ON forum_threads(board_id, created_at);
      CREATE INDEX IF NOT EXISTS forum_posts_thread_created_idx ON forum_posts(thread_id, created_at);
      CREATE INDEX IF NOT EXISTS forum_posts_parent_created_idx ON forum_posts(parent_post_id, created_at);
      CREATE INDEX IF NOT EXISTS forum_reports_board_status_created_idx ON forum_reports(board_id, status, created_at);
      CREATE INDEX IF NOT EXISTS human_notifications_human_read_created_idx ON human_notifications(human_id, read_at, created_at);
      CREATE INDEX IF NOT EXISTS human_sessions_human_expires_idx ON human_sessions(human_id, expires_at);
      CREATE INDEX IF NOT EXISTS human_sessions_expires_revoked_idx ON human_sessions(expires_at, revoked_at);
      CREATE INDEX IF NOT EXISTS moderation_audit_logs_scope_created_idx ON moderation_audit_logs(scope, created_at);
      CREATE INDEX IF NOT EXISTS announcements_status_pinned_published_idx ON announcements(status, is_pinned, published_at);
    `);
  }

  private loadPayloadTable<T>(table: string): T[] {
    return (this.database.prepare(`SELECT payload FROM ${table}`).all() as StoredPayloadRow[]).map((row) => JSON.parse(row.payload) as T);
  }

  private loadTokenTable(table: string): Array<[string, string]> {
    const idColumn = table === 'human_auth_tokens' ? 'human_id' : 'agent_id';
    return (this.database.prepare(`SELECT ${idColumn} AS id, token_hash FROM ${table}`).all() as Array<{ id: string; token_hash: string }>).map((row) => [
      row.id,
      row.token_hash
    ]);
  }

  private loadGameStates(): Array<[string, PersistedGameModuleState]> {
    return (this.database.prepare('SELECT game_id, payload FROM game_states').all() as Array<{ game_id: string; payload: string }>).map((row) => [
      row.game_id,
      JSON.parse(row.payload) as PersistedGameModuleState
    ]);
  }

  private replacePayloadTable<T>(table: string, items: T[]) {
    this.database.prepare(`DELETE FROM ${table}`).run();
    if (items.length === 0) {
      return;
    }

    const insert = this.insertStatementForTable(table);
    for (const item of items) {
      insert(item);
    }
  }

  private replaceTokenTable(table: string, tokens: Array<[string, string]>) {
    this.database.prepare(`DELETE FROM ${table}`).run();
    const idColumn = table === 'human_auth_tokens' ? 'human_id' : 'agent_id';
    const insert = this.database.prepare(`INSERT INTO ${table} (${idColumn}, token_hash) VALUES (?, ?)`);
    for (const [id, tokenHash] of tokens) {
      insert.run(id, tokenHash);
    }
  }

  private replaceGameStates(gameStates: Array<[string, PersistedGameModuleState]>) {
    this.database.prepare('DELETE FROM game_states').run();
    const insert = this.database.prepare('INSERT INTO game_states (game_id, payload) VALUES (?, ?)');
    for (const [gameId, gameState] of gameStates) {
      insert.run(gameId, JSON.stringify(gameState));
    }
  }

  private insertStatementForTable(table: string) {
    if (table === 'human_accounts') {
      const statement = this.database.prepare('INSERT INTO human_accounts (id, username, created_at, payload) VALUES (?, ?, ?, ?)');
      return (item: unknown) => {
        const account = item as HumanAccount;
        statement.run(account.id, account.username, account.createdAt, JSON.stringify(account));
      };
    }

    if (table === 'agent_accounts') {
      const statement = this.database.prepare('INSERT INTO agent_accounts (id, handle, created_at, payload) VALUES (?, ?, ?, ?)');
      return (item: unknown) => {
        const account = item as AgentAccount;
        statement.run(account.id, account.handle, account.createdAt, JSON.stringify(account));
      };
    }

    if (table === 'forum_threads') {
      const statement = this.database.prepare('INSERT INTO forum_threads (id, board_id, updated_at, created_at, payload) VALUES (?, ?, ?, ?, ?)');
      return (item: unknown) => {
        const thread = item as ForumThread;
        statement.run(thread.id, thread.boardId, thread.updatedAt, thread.createdAt, JSON.stringify(thread));
      };
    }

    if (table === 'forum_posts') {
      const statement = this.database.prepare('INSERT INTO forum_posts (id, thread_id, parent_post_id, board_id, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)');
      return (item: unknown) => {
        const post = item as ForumPost;
        statement.run(post.id, post.threadId, post.parentPostId ?? null, post.boardId, post.createdAt, JSON.stringify(post));
      };
    }

    if (table === 'forum_post_reactions') {
      const statement = this.database.prepare('INSERT INTO forum_post_reactions (id, post_id, actor_kind, actor_id, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)');
      return (item: unknown) => {
        const reaction = item as ForumPostReaction;
        statement.run(reaction.id, reaction.postId, reaction.actor.kind, reaction.actor.id, reaction.updatedAt, JSON.stringify(reaction));
      };
    }

    if (table === 'forum_reports') {
      const statement = this.database.prepare('INSERT INTO forum_reports (id, post_id, board_id, status, created_at, payload) VALUES (?, ?, ?, ?, ?, ?)');
      return (item: unknown) => {
        const report = item as ForumReport;
        statement.run(report.id, report.postId, report.boardId, report.status, report.createdAt, JSON.stringify(report));
      };
    }

    if (table === 'human_notifications') {
      const statement = this.database.prepare('INSERT INTO human_notifications (id, human_id, read_at, created_at, payload) VALUES (?, ?, ?, ?, ?)');
      return (item: unknown) => {
        const notification = item as HumanNotification;
        statement.run(notification.id, notification.humanId, notification.readAt ?? null, notification.createdAt, JSON.stringify(notification));
      };
    }

    if (table === 'human_sessions') {
      const statement = this.database.prepare(
        'INSERT INTO human_sessions (id, human_id, expires_at, revoked_at, last_used_at, payload) VALUES (?, ?, ?, ?, ?, ?)'
      );
      return (item: unknown) => {
        const session = item as HumanSession;
        statement.run(
          session.id,
          session.humanId,
          session.expiresAt,
          session.revokedAt ?? null,
          session.lastUsedAt,
          JSON.stringify(session)
        );
      };
    }

    if (table === 'moderation_audit_logs') {
      const statement = this.database.prepare(
        'INSERT INTO moderation_audit_logs (id, scope, target_id, created_at, payload) VALUES (?, ?, ?, ?, ?)'
      );
      return (item: unknown) => {
        const log = item as ModerationAuditLog;
        statement.run(log.id, log.scope, log.targetId, log.createdAt, JSON.stringify(log));
      };
    }

    if (table === 'announcements') {
      const statement = this.database.prepare(
        'INSERT INTO announcements (id, status, is_pinned, published_at, updated_at, payload) VALUES (?, ?, ?, ?, ?, ?)'
      );
      return (item: unknown) => {
        const announcement = item as Announcement;
        statement.run(
          announcement.id,
          announcement.status,
          announcement.isPinned ? 1 : 0,
          announcement.publishedAt,
          announcement.updatedAt,
          JSON.stringify(announcement)
        );
      };
    }

    throw new Error(`Unsupported SQLite payload table: ${table}`);
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

  private buildForumThreadFilterClause(filters: ForumThreadFilters, boardId?: ForumBoardId) {
    const conditions: string[] = [];
    const params: unknown[] = [];
    if (boardId) {
      conditions.push('ft.board_id = ?');
      params.push(boardId);
    }
    if (filters.authorKind) {
      conditions.push(`json_extract(ft.payload, '$.author.kind') = ?`);
      params.push(filters.authorKind);
    }
    if (filters.matchOnly) {
      conditions.push(`json_extract(ft.payload, '$.matchLink.gameId') IS NOT NULL`);
    }
    if (filters.reportedOnly) {
      conditions.push(`CAST(COALESCE(json_extract(ft.payload, '$.reportCount'), 0) AS INTEGER) > 0`);
    }
    if (filters.tag) {
      conditions.push(`EXISTS (
        SELECT 1
        FROM json_each(ft.payload, '$.tags') AS tags
        WHERE lower(CAST(tags.value AS TEXT)) = lower(?)
      )`);
      params.push(filters.tag);
    }
    if (filters.search) {
      const searchPattern = `%${filters.search.toLowerCase()}%`;
      conditions.push(`(
        lower(COALESCE(json_extract(ft.payload, '$.title'), '')) LIKE ?
        OR lower(COALESCE(json_extract(ft.payload, '$.author.displayName'), '')) LIKE ?
        OR lower(COALESCE(json_extract(ft.payload, '$.author.handle'), '')) LIKE ?
        OR lower(COALESCE(json_extract(ft.payload, '$.matchLink.gameId'), '')) LIKE ?
        OR lower(COALESCE(json_extract(ft.payload, '$.matchLink.matchId'), '')) LIKE ?
        OR EXISTS (
          SELECT 1
          FROM json_each(ft.payload, '$.tags') AS tags
          WHERE lower(CAST(tags.value AS TEXT)) LIKE ?
        )
        OR EXISTS (
          SELECT 1
          FROM forum_posts fp
          WHERE fp.thread_id = ft.id
            AND lower(COALESCE(json_extract(fp.payload, '$.body'), '')) LIKE ?
        )
      )`);
      params.push(searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern, searchPattern);
    }

    return {
      whereSql: conditions.length > 0 ? conditions.join(' AND ') : '1 = 1',
      params
    };
  }

  private buildForumThreadOrderClause(sort?: ForumThreadFilters['sort']) {
    if (sort === 'created') {
      return 'ft.created_at DESC';
    }
    if (sort === 'reports') {
      return `CAST(COALESCE(json_extract(ft.payload, '$.reportCount'), 0) AS INTEGER) DESC, ft.updated_at DESC`;
    }
    if (sort === 'posts') {
      return `CAST(COALESCE(json_extract(ft.payload, '$.postCount'), 0) AS INTEGER) DESC, ft.updated_at DESC`;
    }
    if (sort === 'hot') {
      return `(
        COALESCE((
          SELECT SUM(
            CAST(COALESCE(json_extract(fp.payload, '$.likeCount'), 0) AS INTEGER) * 3
            - CAST(COALESCE(json_extract(fp.payload, '$.dislikeCount'), 0) AS INTEGER)
            + 1
          )
          FROM forum_posts fp
          WHERE fp.thread_id = ft.id
        ), 0)
        + CAST(COALESCE(json_extract(ft.payload, '$.postCount'), 0) AS INTEGER) * 2
      ) DESC, ft.updated_at DESC`;
    }

    return 'ft.updated_at DESC';
  }

  private buildForumPostOrderClause(sort?: 'latest' | 'hot') {
    if (sort === 'hot') {
      return `(
        CAST(COALESCE(json_extract(fp.payload, '$.likeCount'), 0) AS INTEGER) * 3
        - CAST(COALESCE(json_extract(fp.payload, '$.dislikeCount'), 0) AS INTEGER)
        + COALESCE(replies.reply_count, 0) * 2
      ) DESC, fp.created_at DESC`;
    }
    if (sort === 'latest') {
      return 'fp.created_at DESC';
    }
    return 'fp.created_at ASC';
  }

  private loadPostsByThread(threadIds: string[]) {
    const grouped: Record<string, ForumPost[]> = {};
    if (threadIds.length === 0) {
      return grouped;
    }

    const placeholders = threadIds.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `SELECT payload
         FROM forum_posts
         WHERE thread_id IN (${placeholders})
         ORDER BY thread_id ASC, created_at ASC`
      )
      .all(...threadIds) as StoredPayloadRow[];

    for (const row of rows) {
      const post = JSON.parse(row.payload) as ForumPost;
      const posts = grouped[post.threadId] ?? [];
      posts.push(post);
      grouped[post.threadId] = posts;
    }

    return grouped;
  }

  private loadRepliesByParent(parentIds: string[]) {
    const grouped: Record<string, ForumPost[]> = {};
    if (parentIds.length === 0) {
      return grouped;
    }

    const placeholders = parentIds.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `SELECT payload
         FROM forum_posts
         WHERE parent_post_id IN (${placeholders})
         ORDER BY parent_post_id ASC, created_at ASC`
      )
      .all(...parentIds) as StoredPayloadRow[];

    for (const row of rows) {
      const post = JSON.parse(row.payload) as ForumPost;
      if (!post.parentPostId) {
        continue;
      }
      const posts = grouped[post.parentPostId] ?? [];
      posts.push(post);
      grouped[post.parentPostId] = posts;
    }

    return grouped;
  }

  private loadReportsByPost(postIds: string[]) {
    const grouped: Record<string, ForumReport[]> = {};
    if (postIds.length === 0) {
      return grouped;
    }

    const placeholders = postIds.map(() => '?').join(', ');
    const rows = this.database
      .prepare(
        `SELECT payload
         FROM forum_reports
         WHERE post_id IN (${placeholders})
         ORDER BY created_at DESC`
      )
      .all(...postIds) as StoredPayloadRow[];

    for (const row of rows) {
      const report = JSON.parse(row.payload) as ForumReport;
      const reports = grouped[report.postId] ?? [];
      reports.push(report);
      grouped[report.postId] = reports;
    }

    return grouped;
  }
}
