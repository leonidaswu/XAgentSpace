import { execFile, spawn, type ChildProcess } from 'node:child_process';
import { promisify } from 'node:util';

const execFileAsync = promisify(execFile);
const serverUrl = process.env.AGENT_ARENA_BASE_URL ?? 'http://127.0.0.1:3000';
const gameId = process.env.AGENT_ARENA_GAME_ID ?? 'rps';
const leftAgent = process.env.OPENCLAW_LEFT_AGENT ?? 'work';
const rightAgent = process.env.OPENCLAW_RIGHT_AGENT ?? 'code';

type MatchEnvelope = {
  match: {
    id: string;
    status: string;
    winnerAgentId?: string;
    scoreboard: Record<string, number>;
  };
};

function sleep(ms: number) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function tryParseJson(text: string) {
  try {
    return JSON.parse(text) as Record<string, unknown>;
  } catch {
    return null;
  }
}

function extractJsonObject(text: string) {
  const trimmed = text.trim();
  const direct = tryParseJson(trimmed);
  if (direct) {
    return direct;
  }

  const start = trimmed.indexOf('{');
  const end = trimmed.lastIndexOf('}');
  if (start >= 0 && end > start) {
    const sliced = tryParseJson(trimmed.slice(start, end + 1));
    if (sliced) {
      return sliced;
    }
  }

  throw new Error(`Could not parse JSON from OpenClaw output: ${trimmed}`);
}

async function request<T>(pathname: string, init?: RequestInit): Promise<T> {
  const response = await fetch(new URL(pathname, serverUrl), {
    headers: {
      'Content-Type': 'application/json'
    },
    ...init
  });

  if (!response.ok) {
    throw new Error(`${response.status} ${response.statusText}: ${await response.text()}`);
  }

  if (response.status === 204) {
    return undefined as T;
  }

  return response.json() as Promise<T>;
}

async function isServerHealthy() {
  try {
    const response = await fetch(new URL('/api/health', serverUrl));
    return response.ok;
  } catch {
    return false;
  }
}

async function waitForServer(timeoutMs = 20_000) {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    if (await isServerHealthy()) {
      return;
    }
    await sleep(300);
  }
  throw new Error(`Server did not become healthy within ${timeoutMs}ms`);
}

function startServer(): ChildProcess {
  const child = spawn('./node_modules/.bin/tsx', ['apps/server/src/index.ts'], {
    cwd: process.cwd(),
    stdio: ['ignore', 'pipe', 'pipe'],
    env: process.env
  });

  child.stdout?.on('data', (chunk) => {
    process.stdout.write(`[server] ${chunk}`);
  });
  child.stderr?.on('data', (chunk) => {
    process.stderr.write(`[server] ${chunk}`);
  });

  return child;
}

async function ensureOpenClawAgentResponds(agent: string) {
  const { stdout } = await execFileAsync(
    'openclaw',
    ['agent', '--agent', agent, '--message', `Return JSON only: {"ok":true,"agent":"${agent}"}`, '--json'],
    {
      env: process.env,
      maxBuffer: 1024 * 1024
    }
  );

  const parsed = extractJsonObject(stdout) as {
    result?: {
      payloads?: Array<{ text?: string | null }>;
      finalAssistantVisibleText?: string;
    };
  };
  const text =
    parsed.result?.payloads?.map((item) => item.text ?? '').find(Boolean) ??
    parsed.result?.finalAssistantVisibleText ??
    '';
  const response = extractJsonObject(text);

  if (response.ok !== true || response.agent !== agent) {
    throw new Error(`OpenClaw agent ${agent} did not return the expected payload`);
  }
}

async function runOpenClawDemo() {
  const { stdout } = await execFileAsync('npm', ['run', 'demo:openclaw'], {
    cwd: process.cwd(),
    env: {
      ...process.env,
      AGENT_ARENA_BASE_URL: serverUrl,
      AGENT_ARENA_GAME_ID: gameId,
      OPENCLAW_LEFT_AGENT: leftAgent,
      OPENCLAW_RIGHT_AGENT: rightAgent
    },
    maxBuffer: 1024 * 1024 * 4
  });

  const matchId = stdout.match(/Created match (\S+)/)?.[1];
  const winner = stdout.match(/Winner: (.+)/)?.[1]?.trim();
  const finalScore = stdout.match(/Final scoreboard: (.+)/)?.[1]?.trim();
  const sessionLine = stdout.match(/WebSocket sessions: (.+)/)?.[1]?.trim() ?? '';

  if (!matchId || !winner || !finalScore) {
    throw new Error(`Could not parse demo output:\n${stdout}`);
  }

  return { stdout, matchId, winner, finalScore, sessionLine };
}

async function main() {
  let startedServer: ChildProcess | null = null;

  try {
    if (!(await isServerHealthy())) {
      console.log('Server not running, starting local server...');
      startedServer = startServer();
      await waitForServer();
    } else {
      console.log('Server already healthy, reusing existing process.');
    }

    if (leftAgent !== 'work' || rightAgent !== 'code') {
      throw new Error(`This acceptance flow is pinned to local work/code agents, got ${leftAgent}/${rightAgent}`);
    }

    console.log('Checking OpenClaw agents...');
    await ensureOpenClawAgentResponds(leftAgent);
    await ensureOpenClawAgentResponds(rightAgent);

    console.log('Running end-to-end OpenClaw websocket demo match...');
    const demo = await runOpenClawDemo();
    const finalMatch = await request<MatchEnvelope>(`/api/games/${gameId}/matches/${demo.matchId}`);

    if (finalMatch.match.status !== 'finished') {
      throw new Error(`Match ${demo.matchId} did not finish`);
    }

    const summary = {
      serverUrl,
      gameId,
      startedServer: Boolean(startedServer),
      agents: [leftAgent, rightAgent],
      match: {
        id: demo.matchId,
        winner: demo.winner,
        finalScoreboard: demo.finalScore,
        status: finalMatch.match.status,
        persistedWinnerAgentId: finalMatch.match.winnerAgentId ?? null,
        persistedScoreboard: finalMatch.match.scoreboard
      },
      websocketSessions: demo.sessionLine
    };

    console.log('Acceptance summary:');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    if (startedServer) {
      startedServer.kill('SIGTERM');
    }
  }
}

void main().catch((error) => {
  console.error(error instanceof Error ? error.message : String(error));
  process.exitCode = 1;
});
