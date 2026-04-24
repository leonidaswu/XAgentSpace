import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import http from 'node:http';
import os from 'node:os';
import path from 'node:path';
import request from 'supertest';
import WebSocket from 'ws';
import { commitmentFor, GameEngine, TOTAL_TRASH_TALK_TURNS } from '../apps/server/src/game.ts';
import { attachWebSocket, createApp } from '../apps/server/src/app.ts';
import { PlatformService } from '../apps/server/src/platform.ts';
import {
  createDefaultPlatformStorage,
  JsonFilePlatformStorage,
  SqlitePlatformStorage,
  type PersistedPlatformState,
  type PlatformStorage
} from '../apps/server/src/storage.ts';

class MemoryPlatformStorage implements PlatformStorage {
  state: PersistedPlatformState | null = null;

  load() {
    return this.state ? structuredClone(this.state) : null;
  }

  save(state: PersistedPlatformState) {
    this.state = structuredClone(state);
  }
}

function readSessionCookie(response: { headers: Record<string, string | string[] | undefined> }) {
  const setCookie = response.headers['set-cookie'];
  const cookies = Array.isArray(setCookie) ? setCookie : setCookie ? [setCookie] : [];
  const cookie = cookies.find((value: string) => value.startsWith('xagentspace_human_session='));
  assert.ok(cookie, 'expected human session cookie');
  return cookie.split(';')[0];
}

function createIsolatedPlatform() {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-arena-platform-'));
  const stateFilePath = path.join(stateDir, 'platform-state.json');
  return {
    platform: new PlatformService({ stateFilePath }),
    cleanup() {
      fs.rmSync(stateDir, { recursive: true, force: true });
    }
  };
}

async function startPlatformServer(platform: PlatformService) {
  const app = createApp(platform);
  const server = http.createServer(app);
  const sockets = attachWebSocket(server, platform);

  await new Promise<void>((resolve) => {
    server.listen(0, '127.0.0.1', () => resolve());
  });

  const address = server.address();
  if (!address || typeof address === 'string') {
    throw new Error('Failed to start test server');
  }

  return {
    server,
    origin: `http://127.0.0.1:${address.port}`,
    async close() {
      for (const client of sockets.spectatorWss.clients) {
        client.terminate();
      }
      for (const client of sockets.agentWss.clients) {
        client.terminate();
      }
      sockets.spectatorWss.close();
      sockets.agentWss.close();
      server.closeAllConnections?.();
      await new Promise<void>((resolve, reject) => {
        server.close((error) => {
          if (error) {
            reject(error);
            return;
          }
          resolve();
        });
      });
    }
  };
}

test('game engine progresses from trash talk to commit to reveal and scores a round', () => {
  const engine = new GameEngine();
  const alpha = engine.createAgent({ handle: 'agent_a', displayName: 'Agent A' });
  const beta = engine.createAgent({ handle: 'agent_b', displayName: 'Agent B' });
  const challenge = engine.createChallenge({ challengerAgentId: alpha.id, roundsToWin: 1 });
  const match = engine.joinChallenge(challenge.id, { challengedAgentId: beta.id });

  assert.equal(match.phase, 'trash_talk_round_open');

  for (let turn = 0; turn < TOTAL_TRASH_TALK_TURNS; turn += 1) {
    const agentId = turn % 2 === 0 ? alpha.id : beta.id;
    engine.submitTrashTalk(match.id, agentId, `line-${turn + 1}`);
  }

  assert.equal(engine.getMatch(match.id)?.phase, 'move_commit_open');

  engine.submitCommit(match.id, alpha.id, commitmentFor('rock', 'n1'));
  engine.submitCommit(match.id, beta.id, commitmentFor('scissors', 'n2'));
  assert.equal(engine.getMatch(match.id)?.phase, 'move_reveal');

  engine.submitReveal(match.id, alpha.id, 'rock', 'n1');
  engine.submitReveal(match.id, beta.id, 'scissors', 'n2');

  const finished = engine.getMatch(match.id);
  assert.equal(finished?.status, 'finished');
  assert.equal(finished?.winnerAgentId, alpha.id);
  assert.equal(finished?.scoreboard[alpha.id], 1);
});

test('game engine finishes as a draw after five consecutive drawn rounds', () => {
  const engine = new GameEngine();
  const alpha = engine.createAgent({ handle: 'draw_a', displayName: 'Draw A' });
  const beta = engine.createAgent({ handle: 'draw_b', displayName: 'Draw B' });
  const challenge = engine.createChallenge({ challengerAgentId: alpha.id, roundsToWin: 2 });
  const match = engine.joinChallenge(challenge.id, { challengedAgentId: beta.id });
  const moves = ['rock', 'paper', 'scissors', 'rock', 'paper'];

  for (const [roundIndex, move] of moves.entries()) {
    for (let turn = 0; turn < TOTAL_TRASH_TALK_TURNS; turn += 1) {
      const agentId = turn % 2 === 0 ? alpha.id : beta.id;
      engine.submitTrashTalk(match.id, agentId, `draw-${roundIndex + 1}-${turn + 1}`);
    }

    const leftNonce = `left-${roundIndex}`;
    const rightNonce = `right-${roundIndex}`;
    engine.submitCommit(match.id, alpha.id, commitmentFor(move, leftNonce));
    engine.submitCommit(match.id, beta.id, commitmentFor(move, rightNonce));
    engine.submitReveal(match.id, alpha.id, move, leftNonce);
    engine.submitReveal(match.id, beta.id, move, rightNonce);
  }

  const finished = engine.getMatch(match.id);
  assert.equal(finished?.status, 'finished');
  assert.equal(finished?.phase, 'match_finished');
  assert.equal(finished?.winnerAgentId, undefined);
  assert.equal(finished?.scoreboard[alpha.id], 0);
  assert.equal(finished?.scoreboard[beta.id], 0);
  assert.equal(finished?.rounds.length, 5);
});

test('open challenges are discoverable through agent queues', () => {
  const engine = new GameEngine();
  const challenger = engine.createAgent({ handle: 'nova', displayName: 'Nova' });
  const joiner = engine.createAgent({ handle: 'quill', displayName: 'Quill' });

  const challenge = engine.createChallenge({ challengerAgentId: challenger.id, roundsToWin: 2 });
  const queuedEvents = engine.pollAgentEvents(joiner.id);

  assert.ok(
    queuedEvents.some(
      (event) => event.type === 'challenge_received' && event.payload.challengeId === challenge.id
    )
  );
});

test('spectator events are recorded in sequence', () => {
  const engine = new GameEngine();
  const alpha = engine.createAgent({ handle: 'one', displayName: 'Agent One' });
  const beta = engine.createAgent({ handle: 'two', displayName: 'Agent Two' });
  const challenge = engine.createChallenge({ challengerAgentId: alpha.id, roundsToWin: 1 });
  const match = engine.joinChallenge(challenge.id, { challengedAgentId: beta.id });

  for (let turn = 0; turn < TOTAL_TRASH_TALK_TURNS; turn += 1) {
    const agentId = turn % 2 === 0 ? alpha.id : beta.id;
    engine.submitTrashTalk(match.id, agentId, `line-${turn + 1}`);
  }
  engine.submitCommit(match.id, alpha.id, commitmentFor('paper', 'x'));
  engine.submitCommit(match.id, beta.id, commitmentFor('rock', 'y'));

  const events = engine.listSpectatorEvents(match.id);
  assert.ok(events.length >= 6);
  assert.deepEqual(
    events.map((event) => event.seq),
    events.map((_event, index) => index + 1)
  );
});

test('platform exposes generic game endpoints', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);

    const stateResponse = await request(app).get('/api/games/rps/state').expect(200);
    assert.equal(stateResponse.body.game.id, 'rps');
    assert.ok(Array.isArray(stateResponse.body.agents));

    const createAgentResponse = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'generic_agent', displayName: 'Generic Agent' })
      .expect(201);

    const challengeResponse = await request(app)
      .post('/api/games/rps/challenges')
      .send({ challengerAgentId: createAgentResponse.body.account.id, roundsToWin: 1 })
      .set('Authorization', `Bearer ${createAgentResponse.body.issuedAuthToken}`)
      .expect(201);

    const joinerResponse = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'joiner_agent', displayName: 'Joiner Agent' })
      .expect(201);

    const matchResponse = await request(app)
      .post(`/api/games/rps/challenges/${challengeResponse.body.id}/join`)
      .send({ challengedAgentId: joinerResponse.body.account.id })
      .set('Authorization', `Bearer ${joinerResponse.body.issuedAuthToken}`)
      .expect(201);

    assert.equal(matchResponse.body.status, 'active');

    const eventsResponse = await request(app).get(`/api/games/rps/matches/${matchResponse.body.id}/events`).expect(200);
    assert.ok(Array.isArray(eventsResponse.body));
  } finally {
    isolated.cleanup();
  }
});

test('game rooms accept human and agent participants', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);
    const human = await request(app)
      .post('/api/platform/humans')
      .send({ username: 'human_rps_one', displayName: 'Human RPS One', password: 'human_rps_one_2026' })
      .expect(201);
    const humanCookie = readSessionCookie(human);

    const agent = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'mixed_rps_bot', displayName: 'Mixed RPS Bot' })
      .expect(201);

    const challenge = await request(app)
      .post('/api/games/rps/challenges')
      .set('Cookie', humanCookie)
      .send({ challengerKind: 'human', challengerId: human.body.account.id, roundsToWin: 1 })
      .expect(201);

    assert.equal(challenge.body.challenger.kind, 'human');
    assert.equal(challenge.body.challenger.id, human.body.account.id);

    const joinedRoom = await request(app)
      .post(`/api/games/rps/challenges/${challenge.body.id}/join`)
      .set('Authorization', `Bearer ${agent.body.issuedAuthToken}`)
      .send({ challengedKind: 'agent', challengedId: agent.body.account.id })
      .expect(201);

    assert.deepEqual(
      [joinedRoom.body.challenger, joinedRoom.body.challenged].map((participant: { kind: string }) => participant.kind),
      ['human', 'agent']
    );

    await request(app)
      .post(`/api/games/rps/challenges/${challenge.body.id}/ready`)
      .set('Cookie', humanCookie)
      .send({ actorKind: 'human', actorId: human.body.account.id })
      .expect(200);

    const match = await request(app)
      .post(`/api/games/rps/challenges/${challenge.body.id}/ready`)
      .set('Authorization', `Bearer ${agent.body.issuedAuthToken}`)
      .send({ actorKind: 'agent', actorId: agent.body.account.id })
      .expect(200);

    assert.equal(match.body.status, 'active');
    assert.deepEqual(
      match.body.participants.map((participant: { kind: string }) => participant.kind),
      ['human', 'agent']
    );

    for (let turn = 0; turn < TOTAL_TRASH_TALK_TURNS; turn += 1) {
      const humanTurn = turn % 2 === 0;
      await request(app)
        .post(`/api/games/rps/matches/${match.body.id}/trash-talk`)
        .set(humanTurn ? 'Cookie' : 'Authorization', humanTurn ? humanCookie : `Bearer ${agent.body.issuedAuthToken}`)
        .send({
          actorKind: humanTurn ? 'human' : 'agent',
          actorId: humanTurn ? human.body.account.id : agent.body.account.id,
          text: `mixed-line-${turn + 1}`
        })
        .expect(201);
    }

    await request(app)
      .post(`/api/games/rps/matches/${match.body.id}/commit`)
      .set('Cookie', humanCookie)
      .send({ actorKind: 'human', actorId: human.body.account.id, commitment: commitmentFor('rock', 'human-nonce') })
      .expect(201);
    await request(app)
      .post(`/api/games/rps/matches/${match.body.id}/commit`)
      .set('Authorization', `Bearer ${agent.body.issuedAuthToken}`)
      .send({ actorKind: 'agent', actorId: agent.body.account.id, commitment: commitmentFor('scissors', 'agent-nonce') })
      .expect(201);
    await request(app)
      .post(`/api/games/rps/matches/${match.body.id}/reveal`)
      .set('Cookie', humanCookie)
      .send({ actorKind: 'human', actorId: human.body.account.id, move: 'rock', nonce: 'human-nonce' })
      .expect(201);
    await request(app)
      .post(`/api/games/rps/matches/${match.body.id}/reveal`)
      .set('Authorization', `Bearer ${agent.body.issuedAuthToken}`)
      .send({ actorKind: 'agent', actorId: agent.body.account.id, move: 'scissors', nonce: 'agent-nonce' })
      .expect(201);

    const finished = await request(app).get(`/api/games/rps/matches/${match.body.id}`).expect(200);
    assert.equal(finished.body.match.status, 'finished');
    assert.equal(finished.body.match.winnerAgentId, human.body.account.id);

    const secondHuman = await request(app)
      .post('/api/platform/humans')
      .send({ username: 'human_rps_two', displayName: 'Human RPS Two', password: 'human_rps_two_2026' })
      .expect(201);
    const secondHumanCookie = readSessionCookie(secondHuman);
    const humanChallenge = await request(app)
      .post('/api/games/rps/challenges')
      .set('Cookie', humanCookie)
      .send({ challengerKind: 'human', challengerId: human.body.account.id, roundsToWin: 1 })
      .expect(201);
    const humanRoom = await request(app)
      .post(`/api/games/rps/challenges/${humanChallenge.body.id}/join`)
      .set('Cookie', secondHumanCookie)
      .send({ challengedKind: 'human', challengedId: secondHuman.body.account.id })
      .expect(201);

    assert.deepEqual(
      [humanRoom.body.challenger, humanRoom.body.challenged].map((participant: { kind: string }) => participant.kind),
      ['human', 'human']
    );

    const abandonedChallenge = await request(app)
      .post('/api/games/rps/challenges')
      .set('Cookie', humanCookie)
      .send({ challengerKind: 'human', challengerId: human.body.account.id, roundsToWin: 1 })
      .expect(201);
    const leaveResponse = await request(app)
      .post(`/api/games/rps/challenges/${abandonedChallenge.body.id}/leave`)
      .set('Cookie', humanCookie)
      .send({ actorKind: 'human', actorId: human.body.account.id })
      .expect(200);
    assert.equal(leaveResponse.body.dissolved, true);
  } finally {
    isolated.cleanup();
  }
});

test('platform exposes a second live game module through the shared game surface', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);

    const gamesResponse = await request(app).get('/api/games').expect(200);
    assert.ok(gamesResponse.body.some((game: { id: string }) => game.id === 'elemental'));

    const stateResponse = await request(app).get('/api/games/elemental/state').expect(200);
    assert.equal(stateResponse.body.game.id, 'elemental');
    assert.deepEqual(
      stateResponse.body.game.moveOptions.map((option: { id: string }) => option.id),
      ['ember', 'tide', 'grove']
    );

    const leftAgentResponse = await request(app)
      .post('/api/games/elemental/agents')
      .send({ handle: 'ember_duelist', displayName: 'Ember Duelist' })
      .expect(201);

    const rightAgentResponse = await request(app)
      .post('/api/games/elemental/agents')
      .send({ handle: 'tide_duelist', displayName: 'Tide Duelist' })
      .expect(201);

    const challengeResponse = await request(app)
      .post('/api/games/elemental/challenges')
      .set('Authorization', `Bearer ${leftAgentResponse.body.issuedAuthToken}`)
      .send({ challengerAgentId: leftAgentResponse.body.account.id, roundsToWin: 1 })
      .expect(201);

    const matchResponse = await request(app)
      .post(`/api/games/elemental/challenges/${challengeResponse.body.id}/join`)
      .set('Authorization', `Bearer ${rightAgentResponse.body.issuedAuthToken}`)
      .send({ challengedAgentId: rightAgentResponse.body.account.id })
      .expect(201);

    for (let turn = 0; turn < TOTAL_TRASH_TALK_TURNS; turn += 1) {
      const agentId = turn % 2 === 0 ? leftAgentResponse.body.account.id : rightAgentResponse.body.account.id;
      await request(app)
        .post(`/api/games/elemental/matches/${matchResponse.body.id}/trash-talk`)
        .set('Authorization', `Bearer ${agentId === leftAgentResponse.body.account.id ? leftAgentResponse.body.issuedAuthToken : rightAgentResponse.body.issuedAuthToken}`)
        .send({ agentId, text: `elemental-line-${turn + 1}` })
        .expect(201);
    }

    await request(app)
      .post(`/api/games/elemental/matches/${matchResponse.body.id}/commit`)
      .set('Authorization', `Bearer ${leftAgentResponse.body.issuedAuthToken}`)
      .send({ agentId: leftAgentResponse.body.account.id, commitment: commitmentFor('ember', 'fire') })
      .expect(201);

    await request(app)
      .post(`/api/games/elemental/matches/${matchResponse.body.id}/commit`)
      .set('Authorization', `Bearer ${rightAgentResponse.body.issuedAuthToken}`)
      .send({ agentId: rightAgentResponse.body.account.id, commitment: commitmentFor('grove', 'leaf') })
      .expect(201);

    await request(app)
      .post(`/api/games/elemental/matches/${matchResponse.body.id}/reveal`)
      .set('Authorization', `Bearer ${leftAgentResponse.body.issuedAuthToken}`)
      .send({ agentId: leftAgentResponse.body.account.id, move: 'ember', nonce: 'fire' })
      .expect(201);

    await request(app)
      .post(`/api/games/elemental/matches/${matchResponse.body.id}/reveal`)
      .set('Authorization', `Bearer ${rightAgentResponse.body.issuedAuthToken}`)
      .send({ agentId: rightAgentResponse.body.account.id, move: 'grove', nonce: 'leaf' })
      .expect(201);

    const finishedMatchResponse = await request(app).get(`/api/games/elemental/matches/${matchResponse.body.id}`).expect(200);
    assert.equal(finishedMatchResponse.body.match.status, 'finished');
    assert.equal(finishedMatchResponse.body.match.winnerAgentId, leftAgentResponse.body.account.id);
  } finally {
    isolated.cleanup();
  }
});

test('quick game-surface agent creation creates a platform agent account directly', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);

    const createAgentResponse = await request(app)
      .post('/api/games/rps/agents')
      .send({
        handle: 'linked_agent',
        displayName: 'Linked Agent'
      })
      .expect(201);

    assert.equal(createAgentResponse.body.account.handle, 'linked_agent');
    assert.equal(createAgentResponse.body.account.displayName, 'Linked Agent');
    assert.equal(isolated.platform.listAgentAccounts().some((account) => account.id === createAgentResponse.body.account.id), true);

    await request(app)
      .post('/api/games/rps/agents')
      .send({
        handle: 'linked_agent',
        displayName: 'Duplicate Linked Agent'
      })
      .expect(400);
  } finally {
    isolated.cleanup();
  }
});

test('agent-controlled routes require a valid bearer token and respect lifecycle state', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);
    const registration = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'secure_agent', displayName: 'Secure Agent' })
      .expect(201);

    await request(app)
      .post('/api/games/rps/challenges')
      .send({ challengerAgentId: registration.body.account.id, roundsToWin: 1 })
      .expect(401);

    await request(app)
      .post('/api/games/rps/challenges')
      .set('Authorization', `Bearer ${registration.body.issuedAuthToken}`)
      .send({ challengerAgentId: registration.body.account.id, roundsToWin: 1 })
      .expect(201);

    await request(app)
      .post(`/api/platform/agent-accounts/${registration.body.account.id}/lifecycle`)
      .set('Authorization', `Bearer ${registration.body.issuedAuthToken}`)
      .send({ lifecycleState: 'revoked' })
      .expect(401);

    const adminLogin = await request(app)
      .post('/api/platform/humans/login')
      .send({
        username: 'arena_admin',
        password: 'arena_admin_2026'
      })
      .expect(200);
    const adminCookie = readSessionCookie(adminLogin);

    await request(app)
      .post(`/api/platform/agent-accounts/${registration.body.account.id}/lifecycle`)
      .set('Cookie', adminCookie)
      .send({ lifecycleState: 'revoked' })
      .expect(200);

    await request(app)
      .post('/api/games/rps/challenges')
      .set('Authorization', `Bearer ${registration.body.issuedAuthToken}`)
      .send({ challengerAgentId: registration.body.account.id, roundsToWin: 1 })
      .expect(401);
  } finally {
    isolated.cleanup();
  }
});

test('account registration uses session cookies for humans and one-time auth tokens for agents', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);
    const human = await request(app)
      .post('/api/platform/humans')
      .send({ username: 'player_two', displayName: 'Player Two', password: 'player_two_2026', bio: 'Human tester' })
      .expect(201);
    const humanCookie = readSessionCookie(human);

    assert.ok(typeof human.body.sessionExpiresAt === 'string' && human.body.sessionExpiresAt.length > 10);

    const humanLogin = await request(app)
      .post('/api/platform/humans/login')
      .send({ username: 'player_two', password: 'player_two_2026' })
      .expect(200);
    const humanLoginCookie = readSessionCookie(humanLogin);

    assert.equal(humanLogin.body.account.id, human.body.account.id);
    assert.ok(typeof humanLogin.body.sessionExpiresAt === 'string' && humanLogin.body.sessionExpiresAt.length > 10);

    await request(app)
      .get('/api/platform/humans/session')
      .set('Cookie', humanLoginCookie)
      .expect(200);

    await request(app)
      .get('/api/platform/humans/session')
      .expect(401);

    await request(app)
      .post('/api/platform/humans/logout')
      .set('Cookie', humanCookie)
      .expect(204);

    await request(app)
      .get('/api/platform/humans/session')
      .set('Cookie', humanCookie)
      .expect(401);

    const humansList = await request(app).get('/api/platform/humans').expect(200);
    assert.equal('passwordHash' in humansList.body[0], false);

    await request(app)
      .post('/api/platform/humans/login')
      .send({ username: 'player_two', password: 'wrong_password_2026' })
      .expect(401);

    const agent = await request(app)
      .post('/api/platform/agent-accounts')
      .send({
        handle: 'verified_bot',
        displayName: 'Verified Bot',
        accessMode: 'websocket'
      })
      .expect(201);

    assert.ok(typeof agent.body.issuedAuthToken === 'string' && agent.body.issuedAuthToken.length > 20);
    assert.equal(agent.body.account.status, 'offline');

    await request(app)
      .post('/api/platform/humans')
      .send({ username: 'Bad Name', displayName: 'Bad User', password: 'bad_user_2026' })
      .expect(400);

    await request(app)
      .post('/api/platform/agent-accounts')
      .send({ handle: 'UPPERCASE', displayName: 'Invalid Bot' })
      .expect(400);
  } finally {
    isolated.cleanup();
  }
});

test('agent event endpoint supports long-polling for local agents', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);
    const challenger = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'longpoll_alpha', displayName: 'Longpoll Alpha' })
      .expect(201);

    const joiner = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'longpoll_beta', displayName: 'Longpoll Beta' })
      .expect(201);

    const challengeResponse = await request(app)
      .post('/api/games/rps/challenges')
      .set('Authorization', `Bearer ${challenger.body.issuedAuthToken}`)
      .send({ challengerAgentId: challenger.body.account.id, roundsToWin: 1 })
      .expect(201);

    const startedAt = Date.now();
    const eventsResponse = await request(app)
      .get(`/api/agents/${joiner.body.account.id}/events`)
      .query({ waitMs: 250, limit: 10 })
      .set('Authorization', `Bearer ${joiner.body.issuedAuthToken}`)
      .expect(200);

    assert.ok(Date.now() - startedAt < 250);
    assert.ok(
      eventsResponse.body.some(
        (event: { type: string; payload: { challengeId?: string } }) =>
          event.type === 'challenge_received' && event.payload.challengeId === challengeResponse.body.id
      )
    );

    const repeatStartedAt = Date.now();
    const repeatResponse = await request(app)
      .get(`/api/agents/${joiner.body.account.id}/events`)
      .query({ waitMs: 120, limit: 10 })
      .set('Authorization', `Bearer ${joiner.body.issuedAuthToken}`)
      .expect(200);

    assert.ok(Date.now() - repeatStartedAt < 120);
    assert.equal(repeatResponse.body.length > 0, true);

    await request(app)
      .post(`/api/agents/${joiner.body.account.id}/events/ack`)
      .set('Authorization', `Bearer ${joiner.body.issuedAuthToken}`)
      .send({ eventIds: repeatResponse.body.map((event: { id: string }) => event.id) })
      .expect(204);

    const timeoutStartedAt = Date.now();
    const timeoutResponse = await request(app)
      .get(`/api/agents/${joiner.body.account.id}/events`)
      .query({ waitMs: 120, limit: 10 })
      .set('Authorization', `Bearer ${joiner.body.issuedAuthToken}`)
      .expect(200);

    assert.ok(Date.now() - timeoutStartedAt >= 100);
    assert.deepEqual(timeoutResponse.body, []);
  } finally {
    isolated.cleanup();
  }
});

test('agent websocket delivers queued events and supports ack messages', async () => {
  const isolated = createIsolatedPlatform();
  const runtime = await startPlatformServer(isolated.platform);

  try {
    const app = createApp(isolated.platform);
    const challenger = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'socket_alpha', displayName: 'Socket Alpha' })
      .expect(201);

    const joiner = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'socket_beta', displayName: 'Socket Beta' })
      .expect(201);

    await request(app)
      .post('/api/games/rps/challenges')
      .set('Authorization', `Bearer ${challenger.body.issuedAuthToken}`)
      .send({ challengerAgentId: challenger.body.account.id, roundsToWin: 1 })
      .expect(201);

    const ticketResponse = await request(app)
      .post(`/api/agents/${joiner.body.account.id}/ws-ticket`)
      .set('Authorization', `Bearer ${joiner.body.issuedAuthToken}`)
      .expect(201);

    const socket = new WebSocket(
      `${runtime.origin.replace('http', 'ws')}/ws/agents?agentId=${encodeURIComponent(joiner.body.account.id)}&ticket=${encodeURIComponent(ticketResponse.body.ticket)}`
    );

    const frames: Array<{
      type?: string;
      events?: Array<{ id: string; type: string }>;
      session?: { sessionId: string; resumeToken: string; resumed: boolean };
    }> = [];
    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for agent websocket events')), 2000);

      socket.on('message', (raw) => {
        const payload = JSON.parse(raw.toString()) as { type?: string; events?: Array<{ id: string; type: string }> };
        frames.push(payload);
        if (payload.type === 'agent_events' && payload.events?.some((event) => event.type === 'challenge_received')) {
          clearTimeout(timeout);
          resolve();
        }
      });
      socket.on('error', reject);
    });

    const eventFrame = frames.find((frame) => frame.type === 'agent_events' && frame.events?.length);
    const readyFrame = frames.find((frame) => frame.type === 'ready');
    assert.ok(eventFrame?.events?.some((event) => event.type === 'challenge_received'));
    assert.ok(readyFrame?.session?.sessionId);
    assert.ok(readyFrame?.session?.resumeToken);
    assert.equal(readyFrame?.session?.resumed, false);
    assert.equal(isolated.platform.getAgentAccount(joiner.body.account.id)?.status, 'online');

    socket.send(
      JSON.stringify({
        type: 'ack',
        eventIds: eventFrame?.events?.map((event) => event.id) ?? []
      })
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for ack confirmation')), 2000);
      socket.on('message', (raw) => {
        const payload = JSON.parse(raw.toString()) as { type?: string };
        if (payload.type === 'acknowledged') {
          clearTimeout(timeout);
          resolve();
        }
      });
      socket.on('error', reject);
    });

    assert.deepEqual(isolated.platform.pollAgentEvents(joiner.body.account.id), []);
    socket.terminate();
  } finally {
    await runtime.close();
    isolated.cleanup();
  }
});

test('agent websocket sessions can reconnect with a resume token during the grace window', async () => {
  const isolated = createIsolatedPlatform();
  const runtime = await startPlatformServer(isolated.platform);

  try {
    const app = createApp(isolated.platform);
    const registration = await request(app)
      .post('/api/platform/agent-accounts')
      .send({ handle: 'resume_guard', displayName: 'Resume Guard', accessMode: 'websocket' })
      .expect(201);

    const firstTicket = await request(app)
      .post(`/api/agents/${registration.body.account.id}/ws-ticket`)
      .set('Authorization', `Bearer ${registration.body.issuedAuthToken}`)
      .expect(201);

    const firstSocket = new WebSocket(
      `${runtime.origin.replace('http', 'ws')}/ws/agents?agentId=${encodeURIComponent(registration.body.account.id)}&ticket=${encodeURIComponent(firstTicket.body.ticket)}`
    );

    const firstReady = await new Promise<{ session: { sessionId: string; resumeToken: string; resumed: boolean } }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for first websocket ready frame')), 2000);
      firstSocket.on('message', (raw) => {
        const payload = JSON.parse(raw.toString()) as { type?: string; session?: { sessionId: string; resumeToken: string; resumed: boolean } };
        if (payload.type === 'ready' && payload.session) {
          clearTimeout(timeout);
          resolve(payload as { session: { sessionId: string; resumeToken: string; resumed: boolean } });
        }
      });
      firstSocket.on('error', reject);
    });

    await new Promise<void>((resolve) => {
      firstSocket.once('close', () => resolve());
      firstSocket.terminate();
    });
    await new Promise((resolve) => setTimeout(resolve, 20));
    assert.equal(isolated.platform.getAgentAccount(registration.body.account.id)?.status, 'reconnecting');

    const secondTicket = await request(app)
      .post(`/api/agents/${registration.body.account.id}/ws-ticket`)
      .set('Authorization', `Bearer ${registration.body.issuedAuthToken}`)
      .expect(201);

    const secondSocket = new WebSocket(
      `${runtime.origin.replace('http', 'ws')}/ws/agents?agentId=${encodeURIComponent(registration.body.account.id)}&ticket=${encodeURIComponent(secondTicket.body.ticket)}&resumeToken=${encodeURIComponent(firstReady.session.resumeToken)}`
    );

    const secondReady = await new Promise<{ session: { sessionId: string; resumeToken: string; resumed: boolean } }>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for resumed websocket ready frame')), 2000);
      secondSocket.on('message', (raw) => {
        const payload = JSON.parse(raw.toString()) as { type?: string; session?: { sessionId: string; resumeToken: string; resumed: boolean } };
        if (payload.type === 'ready' && payload.session) {
          clearTimeout(timeout);
          resolve(payload as { session: { sessionId: string; resumeToken: string; resumed: boolean } });
        }
      });
      secondSocket.on('error', reject);
    });

    assert.equal(secondReady.session.resumed, true);
    assert.equal(secondReady.session.sessionId, firstReady.session.sessionId);
    assert.equal(isolated.platform.getAgentAccount(registration.body.account.id)?.status, 'online');

    secondSocket.terminate();
  } finally {
    await runtime.close();
    isolated.cleanup();
  }
});

test('agent websocket tickets are single-use and tied to one agent', async () => {
  const isolated = createIsolatedPlatform();
  const runtime = await startPlatformServer(isolated.platform);

  try {
    const app = createApp(isolated.platform);
    const registration = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'ticket_guard', displayName: 'Ticket Guard' })
      .expect(201);

    const ticketResponse = await request(app)
      .post(`/api/agents/${registration.body.account.id}/ws-ticket`)
      .set('Authorization', `Bearer ${registration.body.issuedAuthToken}`)
      .expect(201);

    const firstSocket = new WebSocket(
      `${runtime.origin.replace('http', 'ws')}/ws/agents?agentId=${encodeURIComponent(registration.body.account.id)}&ticket=${encodeURIComponent(ticketResponse.body.ticket)}`
    );

    await new Promise<void>((resolve, reject) => {
      const timeout = setTimeout(() => reject(new Error('Timed out waiting for websocket ready frame')), 2000);
      firstSocket.on('message', (raw) => {
        const payload = JSON.parse(raw.toString()) as { type?: string };
        if (payload.type === 'ready') {
          clearTimeout(timeout);
          resolve();
        }
      });
      firstSocket.on('error', reject);
    });

    const secondSocket = new WebSocket(
      `${runtime.origin.replace('http', 'ws')}/ws/agents?agentId=${encodeURIComponent(registration.body.account.id)}&ticket=${encodeURIComponent(ticketResponse.body.ticket)}`
    );

    await new Promise<void>((resolve) => {
      secondSocket.on('unexpected-response', () => resolve());
      secondSocket.on('error', () => resolve());
      secondSocket.on('close', () => resolve());
    });

    firstSocket.terminate();
    secondSocket.terminate();
  } finally {
    await runtime.close();
    isolated.cleanup();
  }
});

test('platform persists game module state across restarts', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-arena-game-state-'));
  const stateFilePath = path.join(stateDir, 'platform-state.json');

  try {
    const first = new PlatformService({ stateFilePath });
    const left = first.createGameAgent('elemental', {
      handle: 'persist_ember',
      displayName: 'Persist Ember'
    });
    const right = first.createGameAgent('elemental', {
      handle: 'persist_tide',
      displayName: 'Persist Tide'
    });
    const challenge = first.createGameChallenge('elemental', {
      challengerAgentId: left.account.id,
      roundsToWin: 1
    });
    const match = first.joinGameChallenge('elemental', challenge.id, {
      challengedAgentId: right.account.id
    });

    for (let turn = 0; turn < TOTAL_TRASH_TALK_TURNS; turn += 1) {
      const agentId = turn % 2 === 0 ? left.account.id : right.account.id;
      first.submitGameTrashTalk('elemental', match.id, agentId, `persist-line-${turn + 1}`);
    }
    first.submitGameCommit('elemental', match.id, left.account.id, commitmentFor('ember', 'persist-fire'));
    first.submitGameCommit('elemental', match.id, right.account.id, commitmentFor('tide', 'persist-tide'));

    await new Promise((resolve) => setTimeout(resolve, 30));

    const second = new PlatformService({ stateFilePath });
    const restoredMatch = second.getGameMatch('elemental', match.id);
    const restoredEvents = second.listGameSpectatorEvents('elemental', match.id);
    const restoredLobby = second.getGameLobby('elemental');

    assert.equal(restoredMatch?.phase, 'move_reveal');
    assert.equal(restoredMatch?.agentIds[0], left.account.id);
    assert.equal(restoredEvents.some((event) => event.type === 'move_committed'), true);
    assert.equal(restoredLobby?.game.id, 'elemental');
    assert.equal(restoredLobby?.game.moveOptions[0]?.id, 'ember');
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('platform persistence can be swapped through a storage adapter', async () => {
  const storage = new MemoryPlatformStorage();
  const first = new PlatformService({ storage });
  const registration = first.createHumanAccount({
    username: 'adapter_user',
    displayName: 'Adapter User',
    password: 'adapter_user_2026',
    bio: 'Exercises storage adapter persistence.'
  });
  const announcement = first.createAnnouncement({
    title: '内存存储也应保留公告状态',
    summary: '通过 storage adapter 恢复后，公告不应丢失。',
    body: '这条公告用于验证 PersistedPlatformState 已经把公告纳入快照，从而让不同存储实现都能恢复它。',
    tags: ['storage', 'announcements'],
    authorKind: 'human',
    authorId: registration.account.id
  });

  await new Promise((resolve) => setTimeout(resolve, 30));

  assert.ok(storage.state?.humans.some((human) => human.id === registration.account.id));
  assert.ok(storage.state?.announcements?.some((item) => item.id === announcement.id));

  const second = new PlatformService({ storage });
  assert.equal(
    second.listHumanAccounts().some((human) => human.id === registration.account.id),
    true
  );
  assert.equal(second.getAnnouncement(announcement.id).id, announcement.id);
});

test('sqlite storage adapter saves and restores platform state', async () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-arena-sqlite-state-'));
  const databasePath = path.join(stateDir, 'platform-state.sqlite');

  try {
    const firstStorage = new SqlitePlatformStorage(databasePath);
    const first = new PlatformService({ storage: firstStorage });
    const registration = first.createHumanAccount({
      username: 'sqlite_user',
      displayName: 'SQLite User',
      password: 'sqlite_user_2026',
      bio: 'Exercises SQLite storage persistence.'
    });
    first.createForumThread('human', {
      title: 'SQLite 查询路径验证主题',
      body: '这条主题用于验证论坛列表、搜索和标签统计可以从 SQLite 直接读取。',
      authorKind: 'human',
      authorId: registration.account.id,
      tags: ['sqlite', 'query']
    });
    const announcement = first.createAnnouncement({
      title: 'SQLite 公告恢复验证',
      summary: 'SQLite 存储应完整保存公告记录。',
      body: '这条公告用于验证 SQLite 适配器已经拥有 announcements 表，并能在重启后读取回来。',
      tags: ['sqlite', 'announcements'],
      authorKind: 'human',
      authorId: registration.account.id
    });

    await new Promise((resolve) => setTimeout(resolve, 30));
    firstStorage.close();

    const secondStorage = new SqlitePlatformStorage(databasePath);
    const second = new PlatformService({ storage: secondStorage });
    assert.equal(
      second.listHumanAccounts().some((human) => human.id === registration.account.id),
      true
    );
    assert.equal(
      second.getForumBoard('human', { search: 'SQLite', sort: 'latest' }, { limit: 10 }).threads.some((thread) => thread.title.includes('SQLite')),
      true
    );
    assert.equal(second.searchForumThreads({ boardId: 'human', tag: 'sqlite', sort: 'latest' }).length >= 1, true);
    assert.equal(second.listHotForumTags({ limit: 8 }).includes('sqlite'), true);
    assert.equal(second.getAnnouncement(announcement.id).title, 'SQLite 公告恢复验证');
    secondStorage.close();
  } finally {
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('default storage factory uses sqlite unless json is explicitly requested', () => {
  const stateDir = fs.mkdtempSync(path.join(os.tmpdir(), 'agent-arena-storage-factory-'));
  const databasePath = path.join(stateDir, 'platform-state.sqlite');
  const previousStorage = process.env.XAGENTSPACE_STORAGE;
  const previousSqliteFile = process.env.XAGENTSPACE_SQLITE_FILE;

  try {
    delete process.env.XAGENTSPACE_STORAGE;
    delete process.env.XAGENTSPACE_SQLITE_FILE;
    const storage = createDefaultPlatformStorage({ sqliteFilePath: databasePath });
    assert.ok(storage instanceof SqlitePlatformStorage);
    storage.close();

    process.env.XAGENTSPACE_STORAGE = 'sqlite';
    process.env.XAGENTSPACE_SQLITE_FILE = databasePath;
    const envStorage = createDefaultPlatformStorage();
    assert.ok(envStorage instanceof SqlitePlatformStorage);
    envStorage.close();

    process.env.XAGENTSPACE_STORAGE = 'json';
    const jsonStorage = createDefaultPlatformStorage({ stateFilePath: path.join(stateDir, 'platform-state.json') });
    assert.ok(jsonStorage instanceof JsonFilePlatformStorage);
  } finally {
    if (previousStorage === undefined) {
      delete process.env.XAGENTSPACE_STORAGE;
    } else {
      process.env.XAGENTSPACE_STORAGE = previousStorage;
    }
    if (previousSqliteFile === undefined) {
      delete process.env.XAGENTSPACE_SQLITE_FILE;
    } else {
      process.env.XAGENTSPACE_SQLITE_FILE = previousSqliteFile;
    }
    fs.rmSync(stateDir, { recursive: true, force: true });
  }
});

test('platform exposes persisted forum boards, thread creation, replies, and reporting', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);

    const boardsResponse = await request(app).get('/api/forums/human').expect(200);
    assert.equal(boardsResponse.body.board.id, 'human');
    assert.ok(Array.isArray(boardsResponse.body.threads));
    assert.ok(boardsResponse.body.threads.length >= 1);

    const humanRegistration = await request(app)
      .post('/api/platform/humans')
      .send({ username: 'forum_owner', displayName: 'Forum Owner', password: 'forum_owner_2026', bio: 'Forum bootstrap author' })
      .expect(201);
    const humanCookie = readSessionCookie(humanRegistration);

    const replyingHumanRegistration = await request(app)
      .post('/api/platform/humans')
      .send({ username: 'forum_reader', displayName: 'Forum Reader', password: 'forum_reader_2026', bio: 'Forum reply author' })
      .expect(201);
    const replyingHumanCookie = readSessionCookie(replyingHumanRegistration);

    const threadResponse = await request(app)
      .post('/api/forums/human/threads')
      .set('Cookie', humanCookie)
      .send({
        title: 'Arena 收官后论坛第一批帖子应该怎么分类？',
        body: '我建议把复盘、版本变更、平台建设拆成三类，先不要把全部内容塞进一个大杂烩板块。',
        authorKind: 'human',
        authorId: humanRegistration.body.account.id,
        tags: ['phase-2', 'forum']
      })
      .expect(201);

    const replyResponse = await request(app)
      .post(`/api/forums/threads/${threadResponse.body.thread.id}/posts`)
      .set('Cookie', humanCookie)
      .send({
        body: '后续再接 match 链接时，可以让复盘帖直接引用具体对局。',
        authorKind: 'human',
        authorId: humanRegistration.body.account.id
      })
      .expect(201);

    const nestedReplyResponse = await request(app)
      .post(`/api/forums/threads/${threadResponse.body.thread.id}/posts`)
      .set('Cookie', replyingHumanCookie)
      .send({
        body: '楼中楼回复可以直接跟在这条评论下面。',
        authorKind: 'human',
        authorId: replyingHumanRegistration.body.account.id,
        parentPostId: replyResponse.body.id
      })
      .expect(201);

    assert.equal(nestedReplyResponse.body.parentPostId, replyResponse.body.id);

    const reactionResponse = await request(app)
      .post(`/api/forums/posts/${replyResponse.body.id}/reactions`)
      .set('Cookie', humanCookie)
      .send({
        actorKind: 'human',
        actorId: humanRegistration.body.account.id,
        reaction: 'dislike'
      })
      .expect(200);

    assert.equal(reactionResponse.body.dislikeCount, 1);

    const reactionToggleResponse = await request(app)
      .post(`/api/forums/posts/${replyResponse.body.id}/reactions`)
      .set('Cookie', humanCookie)
      .send({
        actorKind: 'human',
        actorId: humanRegistration.body.account.id,
        reaction: 'dislike'
      })
      .expect(200);

    assert.equal(reactionToggleResponse.body.dislikeCount, 0);

    const reactionSwitchResponse = await request(app)
      .post(`/api/forums/posts/${replyResponse.body.id}/reactions`)
      .set('Cookie', humanCookie)
      .send({
        actorKind: 'human',
        actorId: humanRegistration.body.account.id,
        reaction: 'like'
      })
      .expect(200);

    assert.equal(reactionSwitchResponse.body.likeCount, 1);
    assert.equal(reactionSwitchResponse.body.dislikeCount, 0);

    const notificationsResponse = await request(app)
      .get(`/api/platform/humans/${humanRegistration.body.account.id}/notifications`)
      .set('Cookie', humanCookie)
      .expect(200);

    assert.equal(notificationsResponse.body.notifications.length, 1);
    assert.equal(notificationsResponse.body.notifications[0].postId, nestedReplyResponse.body.id);

    const readNotificationsResponse = await request(app)
      .post(`/api/platform/humans/${humanRegistration.body.account.id}/notifications/read`)
      .set('Cookie', humanCookie)
      .expect(200);

    assert.ok(readNotificationsResponse.body.notifications[0].readAt);

    const agentRegistration = await request(app)
      .post('/api/platform/agent-accounts')
      .send({
        handle: 'forum_agent',
        displayName: 'Forum Agent',
        accessMode: 'websocket'
      })
      .expect(201);

    const reportResponse = await request(app)
      .post(`/api/forums/posts/${replyResponse.body.id}/report`)
      .set('Authorization', `Bearer ${agentRegistration.body.issuedAuthToken}`)
      .send({
        reporterKind: 'agent',
        reporterId: agentRegistration.body.account.id,
        reason: '需要后续 moderation 流进一步判断是否偏题'
      })
      .expect(201);

    const refreshedBoard = await request(app).get('/api/forums/human').expect(200);
    const createdThread = refreshedBoard.body.threads.find((thread: { id: string }) => thread.id === threadResponse.body.thread.id);
    assert.ok(createdThread);
    assert.equal(createdThread.postCount, 3);
    assert.equal(createdThread.reportCount, 1);
    assert.equal(refreshedBoard.body.postsByThread[threadResponse.body.thread.id].length, 3);
    assert.equal(refreshedBoard.body.stats.openReportCount, 1);
    assert.equal(
      refreshedBoard.body.postsByThread[threadResponse.body.thread.id].some((post: { id: string; reportCount: number }) => post.id === replyResponse.body.id && post.reportCount === 1),
      true
    );

    const paginatedBoard = await request(app).get('/api/forums/human?limit=1').expect(200);
    assert.equal(paginatedBoard.body.threads.length, 1);
    assert.ok(paginatedBoard.body.pageInfo.total >= 2);
    assert.equal(typeof paginatedBoard.body.pageInfo.nextCursor, 'string');

    const threadDetail = await request(app)
      .get(`/api/forums/threads/${threadResponse.body.thread.id}`)
      .expect(200);
    assert.equal(threadDetail.body.thread.id, threadResponse.body.thread.id);
    assert.equal(threadDetail.body.board.id, 'human');
    assert.equal(threadDetail.body.posts.length, 3);
    assert.equal(
      threadDetail.body.posts.some((post: { id: string; parentPostId?: string }) => post.id === nestedReplyResponse.body.id && post.parentPostId === replyResponse.body.id),
      true
    );
    assert.equal(threadDetail.body.reportsByPost[replyResponse.body.id][0].id, reportResponse.body.id);

    const paginatedThreadDetail = await request(app)
      .get(`/api/forums/threads/${threadResponse.body.thread.id}?postLimit=1`)
      .expect(200);
    assert.equal(paginatedThreadDetail.body.posts.length, 1);
    assert.equal(paginatedThreadDetail.body.postsPageInfo.total, 2);
    assert.equal(typeof paginatedThreadDetail.body.postsPageInfo.nextCursor, 'string');

    const searchResponse = await request(app)
      .get('/api/forums/search?boardId=human&search=match&reportedOnly=true&sort=reports')
      .expect(200);
    assert.equal(searchResponse.body.threads.some((thread: { id: string }) => thread.id === threadResponse.body.thread.id), true);

    const reportsResponse = await request(app)
      .get('/api/forums/reports?boardId=human&status=open')
      .expect(200);
    assert.equal(reportsResponse.body.reports.some((report: { id: string }) => report.id === reportResponse.body.id), true);

    const deniedModerationResponse = await request(app)
      .post(`/api/forums/reports/${reportResponse.body.id}/moderation`)
      .set('Cookie', humanCookie)
      .send({
        status: 'resolved',
        moderatorKind: 'human',
        moderatorId: humanRegistration.body.account.id,
        resolutionNote: '已确认该举报完成处理'
      })
      .expect(403);
    assert.equal(deniedModerationResponse.body.error.includes('permission'), true);

    const adminLogin = await request(app)
      .post('/api/platform/humans/login')
      .send({
        username: 'arena_admin',
        password: 'arena_admin_2026'
      })
      .expect(200);
    const adminCookie = readSessionCookie(adminLogin);

    const moderationResponse = await request(app)
      .post(`/api/forums/reports/${reportResponse.body.id}/moderation`)
      .set('Cookie', adminCookie)
      .send({
        status: 'resolved',
        moderatorKind: 'human',
        moderatorId: adminLogin.body.account.id,
        resolutionNote: '已确认该举报完成处理'
      })
      .expect(200);
    assert.equal(moderationResponse.body.status, 'resolved');
    assert.equal(moderationResponse.body.moderator.id, adminLogin.body.account.id);

    const auditResponse = await request(app)
      .get('/api/forums/moderation/audits?limit=5')
      .set('Cookie', adminCookie)
      .expect(200);
    assert.equal(auditResponse.body.audits.some((entry: { targetId: string }) => entry.targetId === reportResponse.body.id), true);

    const hotTagsResponse = await request(app)
      .get('/api/forums/tags/hot?limit=5')
      .expect(200);
    assert.equal(Array.isArray(hotTagsResponse.body.tags), true);
    assert.equal(hotTagsResponse.body.tags.includes('phase-2') || hotTagsResponse.body.tags.includes('forum'), true);
  } finally {
    isolated.cleanup();
  }
});

test('human accounts can update profile fields and rotate password through the account API', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);

    const registration = await request(app)
      .post('/api/platform/humans')
      .send({
        username: 'profile_owner',
        displayName: 'Profile Owner',
        password: 'profile_owner_2026',
        bio: 'Original bio'
      })
      .expect(201);
    const sessionCookie = readSessionCookie(registration);

    const updated = await request(app)
      .patch(`/api/platform/humans/${registration.body.account.id}/profile`)
      .set('Cookie', sessionCookie)
      .send({
        displayName: 'Updated Owner',
        bio: 'Updated bio',
        currentPassword: 'profile_owner_2026',
        nextPassword: 'profile_owner_next_2026'
      })
      .expect(200);

    assert.equal(updated.body.account.displayName, 'Updated Owner');
    assert.equal(updated.body.account.bio, 'Updated bio');

    const relogin = await request(app)
      .post('/api/platform/humans/login')
      .send({
        username: 'profile_owner',
        password: 'profile_owner_next_2026'
      })
      .expect(200);

    assert.equal(relogin.body.account.displayName, 'Updated Owner');
  } finally {
    isolated.cleanup();
  }
});

test('platform exposes managed announcements with detail, creation, and pin/archive updates', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);

    const seededAnnouncements = await request(app).get('/api/announcements').expect(200);
    assert.ok(Array.isArray(seededAnnouncements.body.announcements));
    assert.ok(seededAnnouncements.body.announcements.length >= 3);

    const humanRegistration = await request(app)
      .post('/api/platform/humans')
      .send({
        username: 'notice_owner',
        displayName: 'Notice Owner',
        password: 'notice_owner_2026',
        bio: 'Publishes community notices'
      })
      .expect(201);
    const humanCookie = readSessionCookie(humanRegistration);

    const createdAnnouncement = await request(app)
      .post('/api/announcements')
      .set('Cookie', humanCookie)
      .send({
        title: '社区公告现在接入真实持久化',
        summary: '公告列表、详情与更新不再依赖前端静态数组。',
        body: '这条公告用于验证 API 创建、详情查询、置顶和归档状态都能通过后端完成，并且后续重启仍可恢复。',
        tags: ['announcements', 'phase-2'],
        authorKind: 'human',
        authorId: humanRegistration.body.account.id
      })
      .expect(201);

    assert.equal(createdAnnouncement.body.author.id, humanRegistration.body.account.id);
    assert.equal(createdAnnouncement.body.status, 'active');
    assert.equal(createdAnnouncement.body.isPinned, false);

    const detailResponse = await request(app)
      .get(`/api/announcements/${createdAnnouncement.body.id}`)
      .expect(200);
    assert.equal(detailResponse.body.id, createdAnnouncement.body.id);
    assert.equal(detailResponse.body.title, '社区公告现在接入真实持久化');

    const updatedAnnouncement = await request(app)
      .patch(`/api/announcements/${createdAnnouncement.body.id}`)
      .set('Cookie', humanCookie)
      .send({
        title: '社区公告已完成托管化收口',
        summary: '公告列表、详情、置顶与归档都已经由后端驱动。',
        body: '这条公告经过作者更新后，应该可以在详情页和列表页中体现新内容，并且允许继续进行置顶与归档状态调整。',
        tags: ['announcements', 'managed'],
        isPinned: true,
        status: 'archived',
        actorKind: 'human',
        actorId: humanRegistration.body.account.id
      })
      .expect(200);

    assert.equal(updatedAnnouncement.body.title, '社区公告已完成托管化收口');
    assert.equal(updatedAnnouncement.body.isPinned, true);
    assert.equal(updatedAnnouncement.body.status, 'archived');

    const activeList = await request(app).get('/api/announcements').expect(200);
    assert.equal(
      activeList.body.announcements.some((announcement: { id: string }) => announcement.id === createdAnnouncement.body.id),
      false
    );

    const archivedList = await request(app).get('/api/announcements?includeArchived=true').expect(200);
    assert.equal(
      archivedList.body.announcements.some((announcement: { id: string; status: string }) => announcement.id === createdAnnouncement.body.id && announcement.status === 'archived'),
      true
    );
  } finally {
    isolated.cleanup();
  }
});

test('forum threads can anchor strategy discussion to a concrete match', async () => {
  const isolated = createIsolatedPlatform();

  try {
    const app = createApp(isolated.platform);

    const challenger = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'anchor_alpha', displayName: 'Anchor Alpha' })
      .expect(201);
    const joiner = await request(app)
      .post('/api/games/rps/agents')
      .send({ handle: 'anchor_beta', displayName: 'Anchor Beta' })
      .expect(201);
    const challenge = await request(app)
      .post('/api/games/rps/challenges')
      .set('Authorization', `Bearer ${challenger.body.issuedAuthToken}`)
      .send({ challengerAgentId: challenger.body.account.id, roundsToWin: 1 })
      .expect(201);
    const match = await request(app)
      .post(`/api/games/rps/challenges/${challenge.body.id}/join`)
      .set('Authorization', `Bearer ${joiner.body.issuedAuthToken}`)
      .send({ challengedAgentId: joiner.body.account.id })
      .expect(201);
    const human = await request(app)
      .post('/api/platform/humans')
      .send({ username: 'anchor_owner', displayName: 'Anchor Owner', password: 'anchor_owner_2026', bio: 'Links matches to forum analysis' })
      .expect(201);
    const humanCookie = readSessionCookie(human);

    const linkedThread = await request(app)
      .post('/api/forums/hybrid/threads')
      .set('Cookie', humanCookie)
      .send({
        title: '这场 RPS 开局值得复盘',
        body: '这个帖子直接挂到具体对局，后续搜索和复盘页就能从比赛跳回讨论。',
        authorKind: 'human',
        authorId: human.body.account.id,
        tags: ['复盘', 'rps'],
        matchLink: {
          gameId: 'rps',
          matchId: match.body.id
        }
      })
      .expect(201);

    assert.deepEqual(linkedThread.body.thread.matchLink, { gameId: 'rps', matchId: match.body.id });

    const matchThreads = await request(app)
      .get(`/api/forums/matches/rps/${match.body.id}/threads`)
      .expect(200);
    assert.equal(matchThreads.body.matchId, match.body.id);
    assert.equal(matchThreads.body.threads.some((thread: { id: string }) => thread.id === linkedThread.body.thread.id), true);

    await request(app)
      .post('/api/forums/hybrid/threads')
      .set('Cookie', humanCookie)
      .send({
        title: '不存在的比赛不能作为复盘锚点',
        body: '如果允许无效比赛链接进入论坛，后续从比赛反查讨论会变得不可信。',
        authorKind: 'human',
        authorId: human.body.account.id,
        matchLink: {
          gameId: 'rps',
          matchId: 'match_missing'
        }
      })
      .expect(400);
  } finally {
    isolated.cleanup();
  }
});
