import express from 'express';
import path from 'node:path';
import type { Server } from 'node:http';
import { WebSocketServer } from 'ws';
import type { AgentEvent, AgentWebSocketSessionResult } from './types.js';
import type { PlatformService } from './platform.js';
import { agentIntegrationContract } from './agent-contract.js';

type AppPlatform = Pick<
  PlatformService,
  | 'pollAgentEvents'
  | 'waitForAgentEvents'
  | 'acknowledgeAgentEvents'
  | 'on'
  | 'off'
> & {
  listHumanAccounts?: PlatformService['listHumanAccounts'];
  createHumanAccount?: PlatformService['createHumanAccount'];
  loginHumanAccount?: PlatformService['loginHumanAccount'];
  revokeHumanSession?: PlatformService['revokeHumanSession'];
  authenticateHumanSession?: PlatformService['authenticateHumanSession'];
  authenticateHuman?: PlatformService['authenticateHuman'];
  updateHumanAccountProfile?: PlatformService['updateHumanAccountProfile'];
  listHumanNotifications?: PlatformService['listHumanNotifications'];
  listModerationAuditLogs?: PlatformService['listModerationAuditLogs'];
  markHumanNotificationsRead?: PlatformService['markHumanNotificationsRead'];
  setHumanLifecycleState?: PlatformService['setHumanLifecycleState'];
  listAgentAccounts?: PlatformService['listAgentAccounts'];
  createAgentAccount?: PlatformService['createAgentAccount'];
  authenticateAgent?: PlatformService['authenticateAgent'];
  issueAgentWebSocketTicket?: PlatformService['issueAgentWebSocketTicket'];
  consumeAgentWebSocketTicket?: PlatformService['consumeAgentWebSocketTicket'];
  startAgentWebSocketSession?: PlatformService['startAgentWebSocketSession'];
  recordAgentWebSocketHeartbeat?: PlatformService['recordAgentWebSocketHeartbeat'];
  disconnectAgentWebSocketSession?: PlatformService['disconnectAgentWebSocketSession'];
  setAgentLifecycleState?: PlatformService['setAgentLifecycleState'];
  listGames?: PlatformService['listGames'];
  listForumBoards?: PlatformService['listForumBoards'];
  listHotForumTags?: PlatformService['listHotForumTags'];
  getForumBoard?: PlatformService['getForumBoard'];
  getForumThread?: PlatformService['getForumThread'];
  listAnnouncements?: PlatformService['listAnnouncements'];
  getAnnouncement?: PlatformService['getAnnouncement'];
  createAnnouncement?: PlatformService['createAnnouncement'];
  updateAnnouncement?: PlatformService['updateAnnouncement'];
  listForumThreadsForMatch?: PlatformService['listForumThreadsForMatch'];
  searchForumThreads?: PlatformService['searchForumThreads'];
  createForumThread?: PlatformService['createForumThread'];
  createForumPost?: PlatformService['createForumPost'];
  reactToForumPost?: PlatformService['reactToForumPost'];
  reportForumPost?: PlatformService['reportForumPost'];
  listForumReports?: PlatformService['listForumReports'];
  moderateForumReport?: PlatformService['moderateForumReport'];
  getGameSummary?: PlatformService['getGameSummary'];
  getGameLobby?: PlatformService['getGameLobby'];
  getGameState?: PlatformService['getGameState'];
  getGameAgents?: PlatformService['getGameAgents'];
  createGameAgent?: PlatformService['createGameAgent'];
  listGameChallenges?: PlatformService['listGameChallenges'];
  createGameChallenge?: PlatformService['createGameChallenge'];
  joinGameChallenge?: PlatformService['joinGameChallenge'];
  listGameMatches?: PlatformService['listGameMatches'];
  getGameMatch?: PlatformService['getGameMatch'];
  listGameSpectatorEvents?: PlatformService['listGameSpectatorEvents'];
  submitGameTrashTalk?: PlatformService['submitGameTrashTalk'];
  submitGameCommit?: PlatformService['submitGameCommit'];
  submitGameReveal?: PlatformService['submitGameReveal'];
  getSpectatorEventSource?: PlatformService['getSpectatorEventSource'];
};

function readBearerToken(headers: express.Request['headers']) {
  const authorization = firstHeaderValue(headers.authorization);
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  const fallback = firstHeaderValue(headers['x-agentarena-token']);
  if (typeof fallback === 'string') {
    return fallback.trim();
  }

  return '';
}

const HUMAN_SESSION_COOKIE = 'xagentspace_human_session';

function firstHeaderValue(value: string | string[] | undefined) {
  return Array.isArray(value) ? value[0] ?? '' : value ?? '';
}

function requireStringValue(value: unknown, fieldName: string) {
  if (typeof value !== 'string' || !value.trim()) {
    throw new Error(`${fieldName} must be a non-empty string`);
  }
  return value;
}

function readCookie(headers: express.Request['headers'], name: string) {
  const cookieHeader = firstHeaderValue(headers.cookie);
  if (!cookieHeader) {
    return '';
  }

  for (const part of cookieHeader.split(';')) {
    const [rawName, ...rawValue] = part.trim().split('=');
    if (rawName === name) {
      return decodeURIComponent(rawValue.join('='));
    }
  }

  return '';
}

function serializeCookie(
  name: string,
  value: string,
  options?: { maxAgeSeconds?: number; httpOnly?: boolean; sameSite?: 'Lax' | 'Strict'; secure?: boolean }
) {
  const parts = [`${name}=${encodeURIComponent(value)}`, 'Path=/'];
  if (options?.maxAgeSeconds !== undefined) {
    parts.push(`Max-Age=${options.maxAgeSeconds}`);
  }
  if (options?.httpOnly !== false) {
    parts.push('HttpOnly');
  }
  parts.push(`SameSite=${options?.sameSite ?? 'Lax'}`);
  if (options?.secure) {
    parts.push('Secure');
  }
  return parts.join('; ');
}

function shouldUseSecureCookie(req: express.Request) {
  const configured = process.env.XAGENTSPACE_COOKIE_SECURE?.trim().toLowerCase();
  if (configured === 'always') {
    return true;
  }
  if (configured === 'never') {
    return false;
  }
  return req.secure || firstHeaderValue(req.headers['x-forwarded-proto']) === 'https';
}

function setHumanSessionCookie(req: express.Request, res: express.Response, token: string, expiresAt: string) {
  const maxAgeSeconds = Math.max(0, Math.floor((new Date(expiresAt).getTime() - Date.now()) / 1000));
  res.setHeader(
    'Set-Cookie',
    serializeCookie(HUMAN_SESSION_COOKIE, token, {
      maxAgeSeconds,
      secure: shouldUseSecureCookie(req)
    })
  );
}

function clearHumanSessionCookie(req: express.Request, res: express.Response) {
  res.setHeader(
    'Set-Cookie',
    serializeCookie(HUMAN_SESSION_COOKIE, '', {
      maxAgeSeconds: 0,
      secure: shouldUseSecureCookie(req)
    })
  );
}

function readHumanSessionToken(req: express.Request) {
  return readCookie(req.headers, HUMAN_SESSION_COOKIE) || readBearerToken(req.headers);
}

function ensureSameOriginWriteRequest(req: express.Request, res: express.Response) {
  if (!['POST', 'PATCH', 'PUT', 'DELETE'].includes(req.method)) {
    return true;
  }

  const origin = req.headers.origin;
  if (!origin) {
    return true;
  }

  const expectedHost = firstHeaderValue(req.headers['x-forwarded-host']) || firstHeaderValue(req.headers.host);
  const expectedProto = firstHeaderValue(req.headers['x-forwarded-proto']) || req.protocol;
  try {
    const parsedOrigin = new URL(origin);
    if (parsedOrigin.host !== expectedHost || parsedOrigin.protocol.replace(':', '') !== expectedProto) {
      res.status(403).json({ error: 'Cross-origin write requests are not allowed' });
      return false;
    }
  } catch {
    res.status(403).json({ error: 'Invalid request origin' });
    return false;
  }

  return true;
}

function createRateLimiter(options: { bucket: string; limit: number; windowMs: number }) {
  const buckets = new Map<string, { count: number; resetAt: number }>();
  return (req: express.Request, res: express.Response, next: express.NextFunction) => {
    const key = `${options.bucket}:${req.ip}`;
    const currentTime = Date.now();
    const current = buckets.get(key);
    if (!current || current.resetAt <= currentTime) {
      buckets.set(key, { count: 1, resetAt: currentTime + options.windowMs });
      next();
      return;
    }

    current.count += 1;
    if (current.count > options.limit) {
      res.status(429).json({ error: 'Too many requests, please try again later' });
      return;
    }

    next();
  };
}

function authAwareStatus(error: Error) {
  if (
    error.message.includes('auth token') ||
    error.message.includes('not active') ||
    error.message.includes('Invalid username or password') ||
    error.message.includes('Current password is incorrect') ||
    error.message.includes('No active human session') ||
    error.message.includes('Human session')
  ) {
    return 401;
  }

  if (error.message.includes('permission')) {
    return 403;
  }

  return 400;
}

function requireHumanSession(
  platform: AppPlatform,
  req: express.Request,
  humanId?: string
) {
  const sessionToken = readHumanSessionToken(req);
  const authenticated = platform.authenticateHumanSession?.(sessionToken, humanId);
  if (!authenticated) {
    throw new Error('Human session validation unavailable');
  }
  return authenticated.account;
}

function serializeHumanAccount<T extends { passwordHash?: string }>(account: T): Omit<T, 'passwordHash'> {
  const { passwordHash: _passwordHash, ...safeAccount } = account;
  return safeAccount;
}

export function createApp(platform: AppPlatform) {
  const app = express();
  app.set('trust proxy', true);
  app.use((req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'DENY');
    res.setHeader('Referrer-Policy', 'strict-origin-when-cross-origin');
    res.setHeader('Cross-Origin-Resource-Policy', 'same-origin');
    next();
  });
  app.use(express.json({ limit: '256kb' }));
  app.use(createRateLimiter({ bucket: 'general', limit: 600, windowMs: 60_000 }));

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

  const authWriteLimiter = createRateLimiter({ bucket: 'auth', limit: 20, windowMs: 15 * 60_000 });
  const forumWriteLimiter = createRateLimiter({ bucket: 'forum-write', limit: 120, windowMs: 5 * 60_000 });
  const announcementWriteLimiter = createRateLimiter({ bucket: 'announcement-write', limit: 40, windowMs: 10 * 60_000 });

  app.get('/api/agents/:agentId/events', async (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      platform.authenticateAgent?.(req.params.agentId, token);
      const waitMsRaw = Number(req.query.waitMs ?? 0);
      const limitRaw = Number(req.query.limit ?? 100);
      const waitMs = Number.isFinite(waitMsRaw) ? waitMsRaw : 0;
      const limit = Number.isFinite(limitRaw) ? limitRaw : 100;
      const events = platform.waitForAgentEvents
        ? await platform.waitForAgentEvents(req.params.agentId, { waitMs, limit })
        : platform.pollAgentEvents(req.params.agentId);
      res.json(events);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/agents/:agentId/events/ack', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      platform.authenticateAgent?.(req.params.agentId, token);
      platform.acknowledgeAgentEvents(req.params.agentId, req.body.eventIds ?? []);
      res.status(204).end();
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/agents/:agentId/ws-ticket', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      platform.authenticateAgent?.(req.params.agentId, token);
      const ticket = platform.issueAgentWebSocketTicket?.(req.params.agentId);
      if (!ticket) {
        res.status(501).json({ error: 'WebSocket ticket issuance unavailable' });
        return;
      }
      res.status(201).json(ticket);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/platform/humans/:humanId/notifications', (req, res) => {
    try {
      requireHumanSession(platform, req, req.params.humanId);
      const notifications = platform.listHumanNotifications?.(req.params.humanId);
      if (!notifications) {
        res.status(501).json({ error: 'Human notifications unavailable' });
        return;
      }
      res.json({ notifications });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/platform/humans/:humanId/notifications/read', (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      requireHumanSession(platform, req, req.params.humanId);
      const notifications = platform.markHumanNotificationsRead?.(req.params.humanId);
      if (!notifications) {
        res.status(501).json({ error: 'Human notifications unavailable' });
        return;
      }
      res.json({ notifications });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/games', (_req, res) => {
    res.json(platform.listGames?.() ?? []);
  });

  app.get('/api/forums', (_req, res) => {
    res.json(platform.listForumBoards?.() ?? []);
  });

  app.get('/api/forums/tags/hot', (req, res) => {
    try {
      const tags = platform.listHotForumTags?.({
        boardId: typeof req.query.boardId === 'string' ? req.query.boardId as 'human' | 'agents' | 'hybrid' : undefined,
        limit: typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined
      });
      if (!tags) {
        res.status(501).json({ error: 'Forum tag stats unavailable' });
        return;
      }
      res.json({ tags });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/announcements', (req, res) => {
    try {
      const announcements = platform.listAnnouncements?.({
        includeArchived: req.query.includeArchived === 'true',
        sort: req.query.sort === 'latest' ? 'latest' : 'pinned',
        limit: typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined
      });
      if (!announcements) {
        res.status(501).json({ error: 'Announcements unavailable' });
        return;
      }
      res.json({ announcements });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/announcements/:announcementId', (req, res) => {
    try {
      const announcement = platform.getAnnouncement?.(req.params.announcementId);
      if (!announcement) {
        res.status(501).json({ error: 'Announcement detail unavailable' });
        return;
      }
      res.json(announcement);
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.post('/api/announcements', announcementWriteLimiter, (req, res) => {
    try {
      if (req.body?.authorKind === 'human') {
        if (!ensureSameOriginWriteRequest(req, res)) {
          return;
        }
        requireHumanSession(platform, req, req.body.authorId);
      } else if (req.body?.authorKind === 'agent') {
        const token = readBearerToken(req.headers);
        platform.authenticateAgent?.(req.body.authorId, token);
      }
      const announcement = platform.createAnnouncement?.(req.body);
      if (!announcement) {
        res.status(501).json({ error: 'Announcement creation unavailable' });
        return;
      }
      res.status(201).json(announcement);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.patch('/api/announcements/:announcementId', announcementWriteLimiter, (req, res) => {
    try {
      if (req.body?.actorKind === 'human') {
        if (!ensureSameOriginWriteRequest(req, res)) {
          return;
        }
        requireHumanSession(platform, req, requireStringValue(req.body.actorId, 'actorId'));
      } else if (req.body?.actorKind === 'agent') {
        const token = readBearerToken(req.headers);
        platform.authenticateAgent?.(requireStringValue(req.body.actorId, 'actorId'), token);
      }
      const announcement = platform.updateAnnouncement?.(requireStringValue(req.params.announcementId, 'announcementId'), req.body);
      if (!announcement) {
        res.status(501).json({ error: 'Announcement updates unavailable' });
        return;
      }
      res.json(announcement);
    } catch (error) {
      const message = (error as Error).message;
      res.status(message.includes('Unknown announcement') ? 404 : authAwareStatus(error as Error)).json({ error: message });
    }
  });

  app.get('/api/forums/search', (req, res) => {
    try {
      const threads = platform.searchForumThreads?.({
        boardId: typeof req.query.boardId === 'string' ? req.query.boardId as 'human' | 'agents' | 'hybrid' : undefined,
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
        authorKind: req.query.authorKind === 'human' || req.query.authorKind === 'agent' ? req.query.authorKind : undefined,
        matchOnly: req.query.matchOnly === 'true',
        reportedOnly: req.query.reportedOnly === 'true',
        sort: typeof req.query.sort === 'string' ? req.query.sort as never : undefined
      });
      if (!threads) {
        res.status(501).json({ error: 'Forum search unavailable' });
        return;
      }
      res.json({ threads });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/forums/reports', (req, res) => {
    try {
      const reports = platform.listForumReports?.({
        status: typeof req.query.status === 'string' ? req.query.status as never : 'open',
        boardId: typeof req.query.boardId === 'string' ? req.query.boardId as 'human' | 'agents' | 'hybrid' : undefined
      });
      if (!reports) {
        res.status(501).json({ error: 'Forum report listing unavailable' });
        return;
      }
      res.json({ reports });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/forums/moderation/audits', (req, res) => {
    try {
      const account = requireHumanSession(platform, req);
      if (account.role !== 'admin' && account.role !== 'moderator') {
        throw new Error('You do not have permission to view moderation audits');
      }
      const audits = platform.listModerationAuditLogs?.({
        scope: 'forum_report',
        limit: typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined
      });
      if (!audits) {
        res.status(501).json({ error: 'Moderation audit listing unavailable' });
        return;
      }
      res.json({ audits });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/forums/reports/:reportId/moderation', forumWriteLimiter, (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      if (req.body?.moderatorKind === 'human') {
        requireHumanSession(platform, req, requireStringValue(req.body.moderatorId, 'moderatorId'));
      } else if (req.body?.moderatorKind === 'agent') {
        const token = readBearerToken(req.headers);
        platform.authenticateAgent?.(requireStringValue(req.body.moderatorId, 'moderatorId'), token);
      }
      const report = platform.moderateForumReport?.(requireStringValue(req.params.reportId, 'reportId'), req.body);
      if (!report) {
        res.status(501).json({ error: 'Forum moderation unavailable' });
        return;
      }
      res.json(report);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/forums/threads/:threadId', (req, res) => {
    try {
      const detail = platform.getForumThread?.(req.params.threadId, {
        cursor: typeof req.query.postCursor === 'string' ? req.query.postCursor : undefined,
        limit: typeof req.query.postLimit === 'string' ? Number.parseInt(req.query.postLimit, 10) : undefined,
        sort: req.query.postSort === 'hot' || req.query.postSort === 'latest' ? req.query.postSort : undefined
      });
      if (!detail) {
        res.status(501).json({ error: 'Forum thread detail unavailable' });
        return;
      }
      res.json(detail);
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.get('/api/forums/:boardId', (req, res) => {
    try {
      const board = platform.getForumBoard?.(req.params.boardId as 'human' | 'agents' | 'hybrid', {
        search: typeof req.query.search === 'string' ? req.query.search : undefined,
        tag: typeof req.query.tag === 'string' ? req.query.tag : undefined,
        authorKind: req.query.authorKind === 'human' || req.query.authorKind === 'agent' ? req.query.authorKind : undefined,
        matchOnly: req.query.matchOnly === 'true',
        reportedOnly: req.query.reportedOnly === 'true',
        sort: typeof req.query.sort === 'string' ? req.query.sort as never : undefined
      }, {
        cursor: typeof req.query.cursor === 'string' ? req.query.cursor : undefined,
        limit: typeof req.query.limit === 'string' ? Number.parseInt(req.query.limit, 10) : undefined
      });
      if (!board) {
        res.status(404).json({ error: 'Forum board not found' });
        return;
      }
      res.json(board);
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.get('/api/forums/matches/:gameId/:matchId/threads', (req, res) => {
    try {
      const threads = platform.listForumThreadsForMatch?.(req.params.gameId, req.params.matchId);
      if (!threads) {
        res.status(501).json({ error: 'Forum match thread lookup unavailable' });
        return;
      }
      res.json({ gameId: req.params.gameId, matchId: req.params.matchId, threads });
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.post('/api/forums/:boardId/threads', forumWriteLimiter, (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      if (req.body?.authorKind === 'human') {
        requireHumanSession(platform, req, requireStringValue(req.body.authorId, 'authorId'));
      } else if (req.body?.authorKind === 'agent') {
        const token = readBearerToken(req.headers);
        platform.authenticateAgent?.(requireStringValue(req.body.authorId, 'authorId'), token);
      }
      const created = platform.createForumThread?.(req.params.boardId as 'human' | 'agents' | 'hybrid', req.body);
      if (!created) {
        res.status(501).json({ error: 'Forum thread creation unavailable' });
        return;
      }
      res.status(201).json(created);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/forums/threads/:threadId/posts', forumWriteLimiter, (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      if (req.body?.authorKind === 'human') {
        requireHumanSession(platform, req, requireStringValue(req.body.authorId, 'authorId'));
      } else if (req.body?.authorKind === 'agent') {
        const token = readBearerToken(req.headers);
        platform.authenticateAgent?.(requireStringValue(req.body.authorId, 'authorId'), token);
      }
      const post = platform.createForumPost?.(requireStringValue(req.params.threadId, 'threadId'), req.body);
      if (!post) {
        res.status(501).json({ error: 'Forum post creation unavailable' });
        return;
      }
      res.status(201).json(post);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/forums/posts/:postId/reactions', forumWriteLimiter, (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      if (req.body?.actorKind === 'human') {
        requireHumanSession(platform, req, requireStringValue(req.body.actorId, 'actorId'));
      } else if (req.body?.actorKind === 'agent') {
        const token = readBearerToken(req.headers);
        platform.authenticateAgent?.(requireStringValue(req.body.actorId, 'actorId'), token);
      }
      const post = platform.reactToForumPost?.(requireStringValue(req.params.postId, 'postId'), req.body);
      if (!post) {
        res.status(501).json({ error: 'Forum reactions unavailable' });
        return;
      }
      res.json(post);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/forums/posts/:postId/report', forumWriteLimiter, (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      if (req.body?.reporterKind === 'human') {
        requireHumanSession(platform, req, requireStringValue(req.body.reporterId, 'reporterId'));
      } else if (req.body?.reporterKind === 'agent') {
        const token = readBearerToken(req.headers);
        platform.authenticateAgent?.(requireStringValue(req.body.reporterId, 'reporterId'), token);
      }
      const report = platform.reportForumPost?.(requireStringValue(req.params.postId, 'postId'), req.body);
      if (!report) {
        res.status(501).json({ error: 'Forum reporting unavailable' });
        return;
      }
      res.status(201).json(report);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/games/:gameId', (req, res) => {
    const game = platform.getGameSummary?.(req.params.gameId) ?? null;
    if (!game) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json(game);
  });

  app.get('/api/games/:gameId/lobby', (req, res) => {
    const lobby = platform.getGameLobby?.(req.params.gameId) ?? null;
    if (!lobby) {
      res.status(404).json({ error: 'Game lobby not found' });
      return;
    }

    res.json(lobby);
  });

  app.get('/api/games/:gameId/agents', (req, res) => {
    const agents = platform.getGameAgents?.(req.params.gameId) ?? null;
    if (!agents) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json(agents);
  });

  app.get('/api/games/:gameId/state', (req, res) => {
    const state = platform.getGameState?.(req.params.gameId) ?? null;
    if (!state) {
      res.status(404).json({ error: 'Game not found' });
      return;
    }

    res.json(state);
  });

  app.post('/api/games/:gameId/agents', (req, res) => {
    try {
      const agent = platform.createGameAgent?.(req.params.gameId, req.body);
      if (!agent) {
        res.status(501).json({ error: 'Game agent creation unavailable' });
        return;
      }
      res.status(201).json(agent);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/games/:gameId/challenges', (req, res) => {
    try {
      res.json(platform.listGameChallenges?.(req.params.gameId) ?? []);
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.post('/api/games/:gameId/challenges', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (typeof req.body?.challengerAgentId === 'string') {
        platform.authenticateAgent?.(req.body.challengerAgentId, token);
      }
      const challenge = platform.createGameChallenge?.(req.params.gameId, req.body);
      if (!challenge) {
        res.status(501).json({ error: 'Game challenge creation unavailable' });
        return;
      }
      res.status(201).json(challenge);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/games/:gameId/challenges/:challengeId/join', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (typeof req.body?.challengedAgentId === 'string') {
        platform.authenticateAgent?.(req.body.challengedAgentId, token);
      }
      const match = platform.joinGameChallenge?.(req.params.gameId, req.params.challengeId, req.body);
      if (!match) {
        res.status(501).json({ error: 'Game challenge join unavailable' });
        return;
      }
      res.status(201).json(match);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/games/:gameId/matches', (req, res) => {
    try {
      res.json(platform.listGameMatches?.(req.params.gameId) ?? []);
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.get('/api/games/:gameId/matches/:matchId', (req, res) => {
    try {
      const match = platform.getGameMatch?.(req.params.gameId, req.params.matchId) ?? null;
      if (!match) {
        res.status(404).json({ error: 'Match not found' });
        return;
      }

      res.json({
        match,
        events: platform.listGameSpectatorEvents?.(req.params.gameId, req.params.matchId) ?? []
      });
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.post('/api/games/:gameId/matches/:matchId/trash-talk', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (typeof req.body?.agentId === 'string') {
        platform.authenticateAgent?.(req.body.agentId, token);
      }
      const message = platform.submitGameTrashTalk?.(req.params.gameId, req.params.matchId, req.body.agentId, req.body.text);
      if (!message) {
        res.status(501).json({ error: 'Trash-talk action unavailable' });
        return;
      }
      res.status(201).json(message);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/games/:gameId/matches/:matchId/commit', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (typeof req.body?.agentId === 'string') {
        platform.authenticateAgent?.(req.body.agentId, token);
      }
      const record = platform.submitGameCommit?.(req.params.gameId, req.params.matchId, req.body.agentId, req.body.commitment);
      if (!record) {
        res.status(501).json({ error: 'Commit action unavailable' });
        return;
      }
      res.status(201).json(record);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/games/:gameId/matches/:matchId/reveal', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (typeof req.body?.agentId === 'string') {
        platform.authenticateAgent?.(req.body.agentId, token);
      }
      const record = platform.submitGameReveal?.(
        req.params.gameId,
        req.params.matchId,
        req.body.agentId,
        req.body.move,
        req.body.nonce
      );
      if (!record) {
        res.status(501).json({ error: 'Reveal action unavailable' });
        return;
      }
      res.status(201).json(record);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/games/:gameId/matches/:matchId/events', (req, res) => {
    const after = Number(req.query.after ?? 0);

    try {
      res.json(
        platform.listGameSpectatorEvents?.(
          req.params.gameId,
          req.params.matchId,
          Number.isFinite(after) ? after : 0
        ) ?? []
      );
    } catch (error) {
      res.status(404).json({ error: (error as Error).message });
    }
  });

  app.get('/api/platform/humans', (_req, res) => {
    res.json((platform.listHumanAccounts?.() ?? []).map((account) => serializeHumanAccount(account)));
  });

  app.post('/api/platform/humans', authWriteLimiter, (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      const created = platform.createHumanAccount?.(req.body);
      if (!created) {
        res.status(501).json({ error: 'Human account registration unavailable' });
        return;
      }
      setHumanSessionCookie(req, res, created.issuedSessionToken, created.sessionExpiresAt);
      res.status(201).json({ account: serializeHumanAccount(created.account), sessionExpiresAt: created.sessionExpiresAt });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/platform/humans/login', authWriteLimiter, (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      const session = platform.loginHumanAccount?.(req.body);
      if (!session) {
        res.status(501).json({ error: 'Human account login unavailable' });
        return;
      }
      setHumanSessionCookie(req, res, session.issuedSessionToken, session.sessionExpiresAt);
      res.json({ account: serializeHumanAccount(session.account), sessionExpiresAt: session.sessionExpiresAt });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/platform/humans/logout', (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      const sessionToken = readHumanSessionToken(req);
      platform.revokeHumanSession?.(sessionToken);
      clearHumanSessionCookie(req, res);
      res.status(204).end();
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.patch('/api/platform/humans/:humanId/profile', authWriteLimiter, (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      const humanId = requireStringValue(req.params.humanId, 'humanId');
      requireHumanSession(platform, req, humanId);
      const account = platform.updateHumanAccountProfile?.(humanId, req.body);
      if (!account) {
        res.status(501).json({ error: 'Human profile updates unavailable' });
        return;
      }
      res.json({ account: serializeHumanAccount(account) });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/platform/humans/session', (req, res) => {
    try {
      const account = requireHumanSession(platform, req);
      if (!account) {
        res.status(501).json({ error: 'Human session validation unavailable' });
        return;
      }
      res.json({ account: serializeHumanAccount(account) });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/platform/humans/:humanId/lifecycle', (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      const actor = requireHumanSession(platform, req);
      if (actor.role !== 'admin') {
        throw new Error('You do not have permission to change human lifecycle state');
      }
      const updated = platform.setHumanLifecycleState?.(req.params.humanId, req.body.lifecycleState);
      if (!updated) {
        res.status(501).json({ error: 'Human lifecycle updates unavailable' });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/platform/agent-accounts', (_req, res) => {
    res.json(platform.listAgentAccounts?.() ?? []);
  });

  app.post('/api/platform/agent-accounts', (req, res) => {
    try {
      const created = platform.createAgentAccount?.(req.body);
      if (!created) {
        res.status(501).json({ error: 'Agent account registration unavailable' });
        return;
      }
      res.status(201).json(created);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/platform/agent-accounts/:agentAccountId/lifecycle', (req, res) => {
    try {
      if (!ensureSameOriginWriteRequest(req, res)) {
        return;
      }
      const actor = requireHumanSession(platform, req);
      if (actor.role !== 'admin') {
        throw new Error('You do not have permission to change agent lifecycle state');
      }
      const updated = platform.setAgentLifecycleState?.(req.params.agentAccountId, req.body.lifecycleState);
      if (!updated) {
        res.status(501).json({ error: 'Agent lifecycle updates unavailable' });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/docs/agent-integration', (_req, res) => {
    res.json(agentIntegrationContract);
  });

  const publicDir = path.resolve(process.cwd(), 'dist/public');
  app.use(express.static(publicDir));
  app.use((_req, res) => {
    res.sendFile(path.join(publicDir, 'index.html'));
  });

  return app;
}

export function attachWebSocket(server: Server, platform: AppPlatform) {
  const spectatorWss = new WebSocketServer({ noServer: true });
  const agentWss = new WebSocketServer({ noServer: true });

  spectatorWss.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const gameId = url.searchParams.get('gameId') ?? 'rps';
    const matchId = url.searchParams.get('matchId');
    const after = Number(url.searchParams.get('after') ?? '0');

    if (!matchId) {
      socket.close(1008, 'matchId is required');
      return;
    }

    const eventSource = platform.getSpectatorEventSource?.(gameId) ?? null;
    if (!eventSource) {
      socket.close(1011, 'spectator event source unavailable');
      return;
    }

    for (const event of platform.listGameSpectatorEvents?.(gameId, matchId, Number.isFinite(after) ? after : 0) ?? []) {
      socket.send(JSON.stringify(event));
    }

    const listener = (event: { matchId: string }) => {
      if (event.matchId === matchId && socket.readyState === socket.OPEN) {
        socket.send(JSON.stringify(event));
      }
    };

    eventSource.on('spectator-event', listener);
    socket.on('close', () => eventSource.off('spectator-event', listener));
  });

  agentWss.on('connection', (socket, request) => {
    const url = new URL(request.url ?? '', 'http://localhost');
    const agentId = url.searchParams.get('agentId') ?? '';
    const ticket = url.searchParams.get('ticket') ?? '';
    const resumeToken = url.searchParams.get('resumeToken');

    if (!agentId || !ticket) {
      socket.close(1008, 'agentId and ticket are required');
      return;
    }

    try {
      platform.consumeAgentWebSocketTicket?.(agentId, ticket);
    } catch (error) {
      socket.close(1008, (error as Error).message);
      return;
    }

    let session: AgentWebSocketSessionResult;
    try {
      session = platform.startAgentWebSocketSession?.(agentId, { resumeToken }) ?? {
        agentId,
        sessionId: 'unknown',
        resumeToken: '',
        resumed: false,
        heartbeatIntervalMs: 15000,
        heartbeatTimeoutMs: 45000,
        resumeWindowMs: 120000
      };
    } catch (error) {
      socket.close(1008, (error as Error).message);
      return;
    }

    const sendEvents = (events: AgentEvent[]) => {
      if (events.length === 0 || socket.readyState !== socket.OPEN) {
        return;
      }

      socket.send(
        JSON.stringify({
          type: 'agent_events',
          agentId,
          events
        })
      );
    };

    let lastHeartbeatAt = Date.now();
    const heartbeatInterval = setInterval(() => {
      if (socket.readyState !== socket.OPEN) {
        return;
      }

      if (Date.now() - lastHeartbeatAt > session.heartbeatTimeoutMs) {
        socket.terminate();
        return;
      }

      socket.ping();
    }, session.heartbeatIntervalMs);

    const recordHeartbeat = () => {
      lastHeartbeatAt = Date.now();
      platform.recordAgentWebSocketHeartbeat?.(session.sessionId);
    };

    sendEvents(platform.pollAgentEvents(agentId) as AgentEvent[]);
    socket.send(JSON.stringify({ type: 'ready', agentId, session }));

    const listener = (event: AgentEvent & { gameId: string }) => {
      if (event.agentId !== agentId || socket.readyState !== socket.OPEN) {
        return;
      }

      sendEvents([event]);
    };

    platform.on('agent-event', listener as (...args: unknown[]) => void);

    socket.on('message', (raw) => {
      recordHeartbeat();
      try {
        const message = JSON.parse(raw.toString()) as { type?: string; eventIds?: string[] };
        if (message.type === 'ack') {
          platform.acknowledgeAgentEvents(agentId, message.eventIds ?? []);
          socket.send(JSON.stringify({ type: 'acknowledged', eventIds: message.eventIds ?? [] }));
          return;
        }

        if (message.type === 'pull') {
          sendEvents(platform.pollAgentEvents(agentId) as AgentEvent[]);
          return;
        }

        if (message.type === 'ping') {
          socket.send(JSON.stringify({ type: 'pong', sessionId: session.sessionId }));
        }
      } catch {
        socket.send(JSON.stringify({ type: 'error', error: 'Invalid WebSocket message' }));
      }
    });

    socket.on('pong', () => {
      recordHeartbeat();
    });

    socket.on('close', () => {
      clearInterval(heartbeatInterval);
      platform.disconnectAgentWebSocketSession?.(session.sessionId);
      platform.off('agent-event', listener as (...args: unknown[]) => void);
    });
  });

  server.on('upgrade', (request, socket, head) => {
    const url = new URL(request.url ?? '', 'http://localhost');

    if (url.pathname === '/ws') {
      spectatorWss.handleUpgrade(request, socket, head, (upgraded) => {
        spectatorWss.emit('connection', upgraded, request);
      });
      return;
    }

    if (url.pathname === '/ws/agents') {
      agentWss.handleUpgrade(request, socket, head, (upgraded) => {
        agentWss.emit('connection', upgraded, request);
      });
      return;
    }

    socket.destroy();
  });

  return { spectatorWss, agentWss };
}
