import { execFile } from 'node:child_process';
import crypto from 'node:crypto';
import { promisify } from 'node:util';
import WebSocket from 'ws';
import { commitmentFor } from '../apps/server/src/game.ts';
import type {
  AgentAccount,
  AgentAccountRegistrationResult,
  AgentEvent,
  AgentWebSocketSessionResult,
  AgentWebSocketTicketResult,
  GameSummary,
  Match
} from '../apps/server/src/types.js';

const execFileAsync = promisify(execFile);
const serverUrl = process.env.AGENT_ARENA_BASE_URL ?? 'http://127.0.0.1:3000';
const gameId = process.env.AGENT_ARENA_GAME_ID ?? 'rps';
const leftAgentName = process.env.OPENCLAW_LEFT_AGENT ?? 'work';
const rightAgentName = process.env.OPENCLAW_RIGHT_AGENT ?? 'code';
const wsOrigin = serverUrl.replace(/^http/, 'ws');

type MatchEnvelope = {
  match: Match;
};

type ChoicePlan = {
  move: string;
  nonce: string;
  note?: string;
};

type TrashTalkPlan = {
  text: string;
};

type RegisteredArenaAgent = {
  openclawAgent: string;
  token: string;
  account: AgentAccount;
  socket: AgentSocket;
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

async function request<T>(pathname: string, init: RequestInit = {}, token?: string): Promise<T> {
  const headers = new Headers(init.headers);
  if (!headers.has('Content-Type') && init.body) {
    headers.set('Content-Type', 'application/json');
  }
  if (token) {
    headers.set('Authorization', `Bearer ${token}`);
  }

  const response = await fetch(new URL(pathname, serverUrl), {
    ...init,
    headers
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

function cleanText(value: string, maxLength = 48) {
  return value.replace(/\s+/g, ' ').trim().slice(0, maxLength) || '...';
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  if (!trimmed) {
    throw new Error('Empty OpenClaw response');
  }

  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const fencedMatch = trimmed.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fencedMatch) {
    const fenced = tryParseJson(fencedMatch[1].trim());
    if (fenced) {
      return fenced;
    }
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const extracted = tryParseJson(trimmed.slice(start, end + 1));
    if (extracted) {
      return extracted;
    }
  }

  throw new Error(`Could not extract JSON object from OpenClaw response: ${trimmed}`);
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

async function runOpenClawJson<T extends Record<string, unknown>>(agent: string, message: string): Promise<T> {
  const { stdout } = await execFileAsync(
    'openclaw',
    ['agent', '--agent', agent, '--message', message, '--json'],
    {
      cwd: process.cwd(),
      env: process.env,
      maxBuffer: 1024 * 1024 * 4
    }
  );

  const parsed = JSON.parse(stdout) as {
    result?: {
      payloads?: Array<{ text?: string | null }>;
      finalAssistantVisibleText?: string;
    };
  };

  const candidates = [
    ...(parsed.result?.payloads?.map((payload) => payload.text ?? '').filter(Boolean) ?? []),
    parsed.result?.finalAssistantVisibleText ?? ''
  ].filter(Boolean);

  for (const candidate of candidates) {
    try {
      return extractJsonObject(candidate) as T;
    } catch {
      continue;
    }
  }

  throw new Error(`OpenClaw did not return usable JSON for agent ${agent}`);
}

class AgentSocket {
  readonly agentId: string;
  readonly token: string;
  private socket: WebSocket | null = null;
  private session: AgentWebSocketSessionResult | null = null;
  private readonly events: AgentEvent[] = [];

  constructor(agentId: string, token: string) {
    this.agentId = agentId;
    this.token = token;
  }

  get currentSession() {
    return this.session;
  }

  async connect() {
    const ticket = await request<AgentWebSocketTicketResult>(
      `/api/agents/${this.agentId}/ws-ticket`,
      { method: 'POST' },
      this.token
    );

    const socket = new WebSocket(
      `${wsOrigin}/ws/agents?agentId=${encodeURIComponent(this.agentId)}&ticket=${encodeURIComponent(ticket.ticket)}`
    );
    this.socket = socket;

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error(`Timed out connecting websocket for ${this.agentId}`)), 10_000);

      socket.on('message', (raw) => {
        const payload = JSON.parse(raw.toString()) as {
          type?: string;
          session?: AgentWebSocketSessionResult;
          events?: AgentEvent[];
        };

        if (payload.type === 'ready' && payload.session) {
          clearTimeout(timeout);
          this.session = payload.session;
          resolve();
          return;
        }

        if (payload.type === 'agent_events' && payload.events?.length) {
          this.handleEvents(payload.events);
        }
      });
      socket.on('error', reject);
      socket.on('close', () => {
        if (!this.session) {
          reject(new Error(`WebSocket closed before ready for ${this.agentId}`));
        }
      });
    });
  }

  private handleEvents(events: AgentEvent[]) {
    this.events.push(...events);
    if (this.socket?.readyState === WebSocket.OPEN) {
      this.socket.send(JSON.stringify({ type: 'ack', eventIds: events.map((event) => event.id) }));
    }
  }

  async waitForEvent(
    predicate: (event: AgentEvent) => boolean,
    timeoutMs = 10_000
  ): Promise<AgentEvent> {
    const deadline = Date.now() + timeoutMs;

    while (Date.now() < deadline) {
      const match = this.events.find(predicate);
      if (match) {
        return match;
      }
      if (this.socket?.readyState === WebSocket.OPEN) {
        this.socket.send(JSON.stringify({ type: 'pull' }));
      }
      await sleep(100);
    }

    throw new Error(`Timed out waiting for agent event on ${this.agentId}`);
  }

  async close() {
    if (!this.socket) {
      return;
    }
    const socket = this.socket;
    this.socket = null;
    if (socket.readyState === WebSocket.OPEN || socket.readyState === WebSocket.CONNECTING) {
      await new Promise<void>((resolve) => {
        socket.once('close', () => resolve());
        socket.close();
      });
    }
  }
}

async function ensureServerHealthy() {
  const response = await fetch(new URL('/api/health', serverUrl));
  if (!response.ok) {
    throw new Error(`Server health check failed: ${response.status}`);
  }
}

async function ensureOpenClawAgentResponds(agent: string) {
  const response = await runOpenClawJson<{ ok?: boolean; agent?: string }>(
    agent,
    `Return JSON only: {"ok":true,"agent":"${agent}"}`
  );

  if (response.ok !== true || response.agent !== agent) {
    throw new Error(`OpenClaw agent ${agent} did not return the expected payload`);
  }
}

async function fetchGameSummary() {
  return request<GameSummary>(`/api/games/${gameId}`);
}

async function fetchMatch(matchId: string) {
  return request<MatchEnvelope>(`/api/games/${gameId}/matches/${matchId}`);
}

async function registerArenaAgent(openclawAgent: string, sideLabel: 'left' | 'right'): Promise<RegisteredArenaAgent> {
  const suffix = `${Date.now().toString(36)}_${crypto.randomBytes(3).toString('hex')}`;
  const registration = await request<AgentAccountRegistrationResult>('/api/platform/agent-accounts', {
    method: 'POST',
    body: JSON.stringify({
      handle: `oc_${openclawAgent}_${suffix}`,
      displayName: `OpenClaw ${openclawAgent}`,
      bio: `Local OpenClaw ${openclawAgent} arena runner (${sideLabel})`,
      accessMode: 'websocket',
      registrationSource: 'api'
    })
  });

  const socket = new AgentSocket(registration.account.id, registration.issuedAuthToken);
  await socket.connect();

  return {
    openclawAgent,
    token: registration.issuedAuthToken,
    account: registration.account,
    socket
  };
}

async function generateTrashTalk(agent: RegisteredArenaAgent, match: Match, opponentLastLine?: string) {
  const prompt = [
    'You are controlling an arena duel bot.',
    `Game: ${gameId}.`,
    `Your handle: ${agent.account.handle}.`,
    `Round: ${match.currentRound}.`,
    `Scoreboard: ${JSON.stringify(match.scoreboard)}.`,
    opponentLastLine ? `Opponent last line: ${opponentLastLine}` : 'No opponent line yet.',
    'Return JSON only in the exact shape {"text":"..."}',
    'Constraints: one short taunt, under 24 Chinese characters or under 60 ASCII characters, no markdown.'
  ].join('\n');

  const plan = await runOpenClawJson<TrashTalkPlan>(agent.openclawAgent, prompt);
  return cleanText(String(plan.text ?? '你的概率看起来不太稳定。'), 60);
}

async function generateMove(agent: RegisteredArenaAgent, match: Match, moveIds: string[], opponentLines: string[]) {
  const prompt = [
    'You are selecting a move for a commit-reveal duel.',
    `Game: ${gameId}.`,
    `Allowed moves: ${moveIds.join(', ')}.`,
    `Round: ${match.currentRound}.`,
    `Scoreboard: ${JSON.stringify(match.scoreboard)}.`,
    opponentLines.length ? `Opponent trash talk this round: ${opponentLines.join(' | ')}` : 'Opponent trash talk this round: none',
    'Return JSON only in the exact shape {"move":"...","nonce":"...","note":"..."}',
    'Constraints:',
    `- move must be one of: ${moveIds.join(', ')}`,
    '- nonce must be 8-16 chars of lowercase letters or numbers',
    '- note should be short'
  ].join('\n');

  const plan = await runOpenClawJson<ChoicePlan>(agent.openclawAgent, prompt);
  const proposedMove = String(plan.move ?? '').trim();
  const proposedNonce = String(plan.nonce ?? '').trim();

  const move = moveIds.includes(proposedMove) ? proposedMove : moveIds[0];
  const nonce = /^[a-z0-9]{8,16}$/.test(proposedNonce)
    ? proposedNonce
    : crypto.randomBytes(6).toString('hex').slice(0, 12);

  return {
    move,
    nonce,
    note: String(plan.note ?? '')
  };
}

async function playRound(
  matchId: string,
  left: RegisteredArenaAgent,
  right: RegisteredArenaAgent,
  moveIds: string[]
) {
  const openingMatch = (await fetchMatch(matchId)).match;
  const roundNumber = openingMatch.currentRound;
  const roundLines: string[] = [];
  const speakers = [left, right, left, right, left, right];

  for (const speaker of speakers) {
    const match = (await fetchMatch(matchId)).match;
    const agentId = speaker.account.id;
    const opponentLastLine = roundLines.length > 0 ? roundLines[roundLines.length - 1] : undefined;
    const line = await generateTrashTalk(speaker, match, opponentLastLine);
    await request(
      `/api/games/${gameId}/matches/${matchId}/trash-talk`,
      {
        method: 'POST',
        body: JSON.stringify({ agentId, text: line })
      },
      speaker.token
    );
    roundLines.push(line);
  }

  await Promise.all([
    left.socket.waitForEvent(
      (event) =>
        event.type === 'phase_changed' &&
        event.payload.matchId === matchId &&
        event.payload.phase === 'move_commit_open' &&
        event.payload.roundNumber === roundNumber
    ),
    right.socket.waitForEvent(
      (event) =>
        event.type === 'phase_changed' &&
        event.payload.matchId === matchId &&
        event.payload.phase === 'move_commit_open' &&
        event.payload.roundNumber === roundNumber
    )
  ]);

  const currentMatch = (await fetchMatch(matchId)).match;
  const [leftPlan, rightPlan] = await Promise.all([
    generateMove(left, currentMatch, moveIds, roundLines.filter((_line, index) => index % 2 === 1)),
    generateMove(right, currentMatch, moveIds, roundLines.filter((_line, index) => index % 2 === 0))
  ]);

  await request(
    `/api/games/${gameId}/matches/${matchId}/commit`,
    {
      method: 'POST',
      body: JSON.stringify({
        agentId: left.account.id,
        commitment: commitmentFor(leftPlan.move, leftPlan.nonce)
      })
    },
    left.token
  );
  await request(
    `/api/games/${gameId}/matches/${matchId}/commit`,
    {
      method: 'POST',
      body: JSON.stringify({
        agentId: right.account.id,
        commitment: commitmentFor(rightPlan.move, rightPlan.nonce)
      })
    },
    right.token
  );

  await Promise.all([
    left.socket.waitForEvent(
      (event) =>
        event.type === 'phase_changed' &&
        event.payload.matchId === matchId &&
        event.payload.phase === 'move_reveal' &&
        event.payload.roundNumber === roundNumber
    ),
    right.socket.waitForEvent(
      (event) =>
        event.type === 'phase_changed' &&
        event.payload.matchId === matchId &&
        event.payload.phase === 'move_reveal' &&
        event.payload.roundNumber === roundNumber
    )
  ]);

  await request(
    `/api/games/${gameId}/matches/${matchId}/reveal`,
    {
      method: 'POST',
      body: JSON.stringify({
        agentId: left.account.id,
        move: leftPlan.move,
        nonce: leftPlan.nonce
      })
    },
    left.token
  );
  await request(
    `/api/games/${gameId}/matches/${matchId}/reveal`,
    {
      method: 'POST',
      body: JSON.stringify({
        agentId: right.account.id,
        move: rightPlan.move,
        nonce: rightPlan.nonce
      })
    },
    right.token
  );

  const [leftResult] = await Promise.all([
    left.socket.waitForEvent(
      (event) =>
        event.type === 'round_result' &&
        event.payload.matchId === matchId &&
        event.payload.roundNumber === roundNumber
    ),
    right.socket.waitForEvent(
      (event) =>
        event.type === 'round_result' &&
        event.payload.matchId === matchId &&
        event.payload.roundNumber === roundNumber
    )
  ]);

  return {
    leftPlan,
    rightPlan,
    scoreboard: leftResult.payload.scoreboard as Record<string, number>,
    winnerAgentId: (leftResult.payload.winnerAgentId as string | null | undefined) ?? null
  };
}

async function main() {
  await ensureServerHealthy();
  await ensureOpenClawAgentResponds(leftAgentName);
  await ensureOpenClawAgentResponds(rightAgentName);

  const game = await fetchGameSummary();
  const moveIds = game.moveOptions.map((option) => option.id);
  if (moveIds.length === 0) {
    throw new Error(`Game ${gameId} has no move options`);
  }

  const left = await registerArenaAgent(leftAgentName, 'left');
  const right = await registerArenaAgent(rightAgentName, 'right');

  try {
    const challenge = await request<{ id: string }>(
      `/api/games/${gameId}/challenges`,
      {
        method: 'POST',
        body: JSON.stringify({
          challengerAgentId: left.account.id,
          roundsToWin: 1
        })
      },
      left.token
    );

    await right.socket.waitForEvent(
      (event) => event.type === 'challenge_received' && event.payload.challengeId === challenge.id
    );

    const match = await request<Match>(
      `/api/games/${gameId}/challenges/${challenge.id}/join`,
      {
        method: 'POST',
        body: JSON.stringify({
          challengedAgentId: right.account.id
        })
      },
      right.token
    );

    await Promise.all([
      left.socket.waitForEvent((event) => event.type === 'match_started' && event.payload.matchId === match.id),
      right.socket.waitForEvent((event) => event.type === 'match_started' && event.payload.matchId === match.id)
    ]);

    let roundsPlayed = 0;
    let lastRound: Awaited<ReturnType<typeof playRound>> | null = null;
    let finalMatch = (await fetchMatch(match.id)).match;

    while (finalMatch.status !== 'finished') {
      lastRound = await playRound(match.id, left, right, moveIds);
      roundsPlayed += 1;
      finalMatch = (await fetchMatch(match.id)).match;
      if (roundsPlayed >= 9 && finalMatch.status !== 'finished') {
        throw new Error(`Match ${match.id} exceeded 9 played rounds without finishing`);
      }
    }

    console.log(`Created match ${match.id}`);
    console.log(`Spectator URL: ${serverUrl}/games/${gameId}/matches/${match.id}`);
    console.log(`Left agent: ${left.account.handle} via ${left.openclawAgent}`);
    console.log(`Right agent: ${right.account.handle} via ${right.openclawAgent}`);
    console.log(
      `WebSocket sessions: ${left.account.handle}=${left.socket.currentSession?.sessionId ?? 'unknown'}, ${right.account.handle}=${right.socket.currentSession?.sessionId ?? 'unknown'}`
    );
    if (lastRound) {
      console.log(
        `Last round plans: ${left.openclawAgent}=${lastRound.leftPlan.move}, ${right.openclawAgent}=${lastRound.rightPlan.move}`
      );
    }
    console.log(`Rounds played: ${roundsPlayed}`);
    console.log(`Winner: ${finalMatch.winnerAgentId ?? lastRound?.winnerAgentId ?? 'draw'}`);
    console.log(`Final scoreboard: ${JSON.stringify(finalMatch.scoreboard)}`);
  } finally {
    await Promise.allSettled([left.socket.close(), right.socket.close()]);
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
