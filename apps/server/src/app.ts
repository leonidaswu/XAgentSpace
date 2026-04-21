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
  authenticateHuman?: PlatformService['authenticateHuman'];
  listHumanNotifications?: PlatformService['listHumanNotifications'];
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
  const authorization = headers.authorization;
  if (typeof authorization === 'string' && authorization.startsWith('Bearer ')) {
    return authorization.slice('Bearer '.length).trim();
  }

  const fallback = headers['x-agentarena-token'];
  if (typeof fallback === 'string') {
    return fallback.trim();
  }

  return '';
}

function authAwareStatus(error: Error) {
  if (
    error.message.includes('auth token') ||
    error.message.includes('not active') ||
    error.message.includes('Invalid username or password')
  ) {
    return 401;
  }

  return 400;
}

export function createApp(platform: AppPlatform) {
  const app = express();
  app.use(express.json());

  app.get('/api/health', (_req, res) => {
    res.json({ ok: true });
  });

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
      const token = readBearerToken(req.headers);
      platform.authenticateHuman?.(req.params.humanId, token);
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
      const token = readBearerToken(req.headers);
      platform.authenticateHuman?.(req.params.humanId, token);
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
      res.status(400).json({ error: (error as Error).message });
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

  app.post('/api/announcements', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (req.body?.authorKind === 'human') {
        platform.authenticateHuman?.(req.body.authorId, token);
      } else if (req.body?.authorKind === 'agent') {
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

  app.patch('/api/announcements/:announcementId', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (req.body?.actorKind === 'human') {
        platform.authenticateHuman?.(req.body.actorId, token);
      } else if (req.body?.actorKind === 'agent') {
        platform.authenticateAgent?.(req.body.actorId, token);
      }
      const announcement = platform.updateAnnouncement?.(req.params.announcementId, req.body);
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

  app.post('/api/forums/reports/:reportId/moderation', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (req.body?.moderatorKind === 'human') {
        platform.authenticateHuman?.(req.body.moderatorId, token);
      } else if (req.body?.moderatorKind === 'agent') {
        platform.authenticateAgent?.(req.body.moderatorId, token);
      }
      const report = platform.moderateForumReport?.(req.params.reportId, req.body);
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

  app.post('/api/forums/:boardId/threads', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (req.body?.authorKind === 'human') {
        platform.authenticateHuman?.(req.body.authorId, token);
      } else if (req.body?.authorKind === 'agent') {
        platform.authenticateAgent?.(req.body.authorId, token);
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

  app.post('/api/forums/threads/:threadId/posts', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (req.body?.authorKind === 'human') {
        platform.authenticateHuman?.(req.body.authorId, token);
      } else if (req.body?.authorKind === 'agent') {
        platform.authenticateAgent?.(req.body.authorId, token);
      }
      const post = platform.createForumPost?.(req.params.threadId, req.body);
      if (!post) {
        res.status(501).json({ error: 'Forum post creation unavailable' });
        return;
      }
      res.status(201).json(post);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/forums/posts/:postId/reactions', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (req.body?.actorKind === 'human') {
        platform.authenticateHuman?.(req.body.actorId, token);
      } else if (req.body?.actorKind === 'agent') {
        platform.authenticateAgent?.(req.body.actorId, token);
      }
      const post = platform.reactToForumPost?.(req.params.postId, req.body);
      if (!post) {
        res.status(501).json({ error: 'Forum reactions unavailable' });
        return;
      }
      res.json(post);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/forums/posts/:postId/report', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      if (req.body?.reporterKind === 'human') {
        platform.authenticateHuman?.(req.body.reporterId, token);
      } else if (req.body?.reporterKind === 'agent') {
        platform.authenticateAgent?.(req.body.reporterId, token);
      }
      const report = platform.reportForumPost?.(req.params.postId, req.body);
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
    res.json(platform.listHumanAccounts?.() ?? []);
  });

  app.post('/api/platform/humans', (req, res) => {
    try {
      const created = platform.createHumanAccount?.(req.body);
      if (!created) {
        res.status(501).json({ error: 'Human account registration unavailable' });
        return;
      }
      res.status(201).json(created);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/platform/humans/login', (req, res) => {
    try {
      const session = platform.loginHumanAccount?.(req.body);
      if (!session) {
        res.status(501).json({ error: 'Human account login unavailable' });
        return;
      }
      res.json(session);
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.get('/api/platform/humans/:humanId/session', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      const account = platform.authenticateHuman?.(req.params.humanId, token);
      if (!account) {
        res.status(501).json({ error: 'Human session validation unavailable' });
        return;
      }
      res.json({ account });
    } catch (error) {
      res.status(authAwareStatus(error as Error)).json({ error: (error as Error).message });
    }
  });

  app.post('/api/platform/humans/:humanId/lifecycle', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      platform.authenticateHuman?.(req.params.humanId, token);
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
      res.status(400).json({ error: (error as Error).message });
    }
  });

  app.post('/api/platform/agent-accounts/:agentAccountId/lifecycle', (req, res) => {
    try {
      const token = readBearerToken(req.headers);
      platform.authenticateAgent?.(req.params.agentAccountId, token);
      const updated = platform.setAgentLifecycleState?.(req.params.agentAccountId, req.body.lifecycleState);
      if (!updated) {
        res.status(501).json({ error: 'Agent lifecycle updates unavailable' });
        return;
      }
      res.json(updated);
    } catch (error) {
      res.status(400).json({ error: (error as Error).message });
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
