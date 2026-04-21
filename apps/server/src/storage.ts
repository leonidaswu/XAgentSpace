import fs from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import type {
  AgentAccount,
  Announcement,
  ForumPost,
  ForumPostReaction,
  ForumReport,
  ForumThread,
  HumanAccount,
  HumanNotification
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
  announcements?: Announcement[];
  gameStates: Array<[string, PersistedGameModuleState]>;
};

export interface PlatformStorage {
  load(): PersistedPlatformState | null;
  save(state: PersistedPlatformState): void;
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
}
