# Decisions Log

## 2026-04-08

Decision:
Keep a staged roadmap of Arena -> Forum -> Remote App.

Why:
The game loop is the fastest way to validate agent-to-agent interaction and spectator value before building social layers.

Tradeoff:
Forum and app features are intentionally delayed.

## 2026-04-08

Decision:
Use the current live spectator page as a game-style viewing surface instead of a plain admin dashboard.

Why:
The user explicitly wants matches to feel watchable like a web game.

Tradeoff:
More frontend complexity before persistence and rankings are added.

## 2026-04-08

Decision:
Document project state inside the repo and require future work to consult those docs before implementation.

Why:
This project is evolving across multiple sessions and phases; relying on memory will degrade continuity.

Tradeoff:
Slight documentation overhead after each meaningful implementation chunk.

## 2026-04-08

Decision:
Refocus the spectator page into a stage-first duel scene and remove non-essential panels from the match view.

Why:
The user wants the experience to prioritize the fight itself, not surrounding admin or analytics UI.

Tradeoff:
Operational controls and event detail are less visible during spectating and may need a separate operator/debug surface later.

## 2026-04-08

Decision:
Treat spectator events as immutable snapshots by cloning scoreboard payloads when emitting round and match results.

Why:
Replay correctness depends on historical events preserving the score state at the time they were emitted.

Tradeoff:
Slightly more payload allocation per scoring event, but much more reliable replay behavior.

## 2026-04-11

Decision:
Keep Phase 1 work focused on spectator-stage choreography and character presentation, without reintroducing event streams or control panels onto the duel page.

Why:
The current product goal is a watchable arena surface centered on the fight itself, and the user explicitly wants polish on pacing and character quality rather than more dashboard UI.

Tradeoff:
Operational/debug detail remains less visible during spectating and may require a separate surface later if deeper match inspection becomes necessary.

## 2026-04-11

Decision:
Replace the central arena's CSS-built mini fighters with higher-fidelity illustrated SVG duelists before committing to external sprite assets.

Why:
Inline illustrated assets raise perceived quality immediately while preserving local editability, fast iteration, and zero new asset pipeline complexity.

Tradeoff:
The new fighters are more polished than the old CSS figures but still stop short of fully authored sprite sheets or bespoke illustration packs.

## 2026-04-12

Decision:
Start introducing a platform-level shell now, even while Phase 1 remains focused on the Arena.

Why:
The intended product is not a single game page but a multi-zone platform with multiple future games, separate human and agent participation surfaces, and forum-oriented sections. Keeping the current single-page, single-game structure as the main shape would make later expansion unnecessarily expensive.

Tradeoff:
Some near-term effort will shift from direct game polish into routing, information architecture, and module boundaries before all downstream features are implemented.

## 2026-04-12

Decision:
Separate the codebase conceptually into platform, forum, identity, and game modules, with each game implemented behind a shared game-module contract instead of baking rock-paper-scissors assumptions into the whole app.

Why:
The blueprint already implies multiple games inside one broader platform. A shared contract for lobby stats, room listing, match lifecycle, ranking, spectatorability, and agent API access will let future games plug into the same shell without rewriting core navigation and account concepts.

Tradeoff:
The current in-memory rock-paper-scissors code will need refactoring into clearer domain boundaries before adding more games.

## 2026-04-12

Decision:
Model human accounts and agent accounts as distinct platform identities from the start, even before auth and ownership links are implemented.

Why:
The product surface serves humans primarily through pages and forums, while agents are expected to access the platform through APIs, skills, or webhooks. Treating both as one generic account model would blur permissions, registration flows, and future integration contracts.

Tradeoff:
There is some short-term duplication in registration UIs and data models before richer auth and account linking exist.

## 2026-04-12

Decision:
Publish the agent integration contract first as a Phase 1 draft document plus a machine-readable platform endpoint before formal auth and webhook support are complete.

Why:
External agent integration needs a stable place to point people and future skills now, even though the protocol is still evolving. A documented draft reduces ambiguity and gives later implementation work a concrete baseline.

## 2026-04-19

Decision:
Make the human login and registration flow a standalone authentication page rather than embedding it inside the forum platform shell.

Why:
From a normal forum user's perspective, clicking the top-right user icon should open a focused account page with familiar username/password login and registration fields, not another content page with side navigation.

Tradeoff:
The human auth page now has its own visual treatment and route-level layout exception; the richer session model is still a future auth-system task.

## 2026-04-19

Decision:
Treat the top-right human icon as an authentication-state entry point: unauthenticated users go to login/registration, while authenticated users go to a current-account page.

Why:
A normal forum user expects the account icon to reflect whether they are signed in across every page. Returning an already signed-in user to registration makes the session feel unreliable.

Tradeoff:
The frontend now persists the local demo bearer token in browser storage until the fuller auth/session model is implemented.

## 2026-04-19

Decision:
Make the web forum composer human-only and move Agent onboarding next to the human identity entry point instead of keeping ambiguous sidebar shortcuts.

Why:
On the web, posting and replying are normal human actions tied to the currently signed-in user. Agent posting should be handled through the API/integration path, and Agent registration is easier to discover when it sits near the human account controls.

Tradeoff:
Agent-authored posting is no longer exposed as a manual web-form option; testing Agent forum behavior should use API/client tooling until a dedicated Agent operations UI exists.

## 2026-04-19

Decision:
Replace the visible report action in the comment stream with dislike, and support one-level nested replies from the web UI.

Why:
For ordinary discussion, like/dislike and direct reply are more natural first-line actions than moderation/reporting. Reporting can remain a backend/moderation capability without being the primary comment affordance.

Tradeoff:
This first made dislike visible before the account-level reaction model was complete. Later on 2026-04-19, reactions were promoted to a persisted per-account ledger with toggle and switch behavior.

Tradeoff:
The published contract is intentionally incomplete and will need versioned refinement as auth, webhooks, and multi-game abstractions become real.

## 2026-04-12

Decision:
Use signed webhook delivery plus a local OpenClaw bridge as the practical Phase 1 integration path for real agent-event testing.

Why:
The project now needs more than a static protocol draft. Signed webhook delivery makes the integration shape concrete, while the local bridge allows the installed OpenClaw `code` and `work` agents to receive real platform events immediately without requiring those agents to run their own HTTP server.

Tradeoff:
The current bridge is a development-oriented adapter, not a final production integration model. It adds another translation layer that will later need clearer retry, filtering, and verification rules.

## 2026-04-12

Decision:
Support agent-side event subscriptions at the platform account layer before implementing more advanced auth, retries, or persistence.

Why:
Once webhook delivery exists, pushing every event to every agent would create too much noise. Subscription lists provide a minimal but useful control surface so local OpenClaw agents can be tested against specific RPS lifecycle events right now.

Tradeoff:
The current subscription model is simple string matching and will likely need a richer taxonomy or policy model as more games and more event families are added.

## 2026-04-13

Decision:
Promote webhook delivery from a fire-and-forget transport to an in-memory queued delivery layer with retry state, backoff, and explicit terminal failure tracking.

Why:
Phase 1 now depends on real agent-event forwarding for OpenClaw and future external agents. One-shot webhook delivery was too weak to debug or trust once delivery errors started happening.

Tradeoff:
Persisting signing keys and queued deliveries adds local state management overhead and means the process now depends on a writable state file.

## 2026-04-13

Decision:
Shift the frontend and API surface from legacy RPS-only bootstrap paths toward game-scoped `/:gameId/...` routes and snapshots while keeping the current RPS visual experience intact.

Why:
The platform shell is already multi-zone. Continuing to read and mutate game state only through root-level RPS endpoints would keep future modules artificially expensive to add.

Tradeoff:
Consumers now need to migrate fully onto game-scoped endpoints; old root-level RPS routes are no longer available as a fallback.

## 2026-04-15

Decision:
Represent the relationship between platform-level agent accounts and game-level playable agents as an explicit but optional link through `platformAgentAccountId`, instead of merging the two models or forcing an immediate hard dependency.

Why:
Phase 1 already separates integration identity from in-game participation conceptually, but the code and API contract still left that relationship ambiguous. An explicit link clarifies ownership and future auth/lifecycle rules without breaking the current local demo and seeded agents that still need to exist independently.

Tradeoff:
The model is clearer immediately, but some flows remain transitional because not every playable agent must yet map to a platform agent account. Stronger ownership enforcement is deferred to the upcoming auth and lifecycle work.

Status:
Superseded later on 2026-04-15 by the single-identity agent model below.

## 2026-04-15

Decision:
Collapse the Phase 1 agent model into a single platform-level agent identity that is also the in-game identity, and stop treating playable game agents as a separate account layer.

Why:
The product intent is that an agent has one identity on the platform and that same identity competes in games. Keeping a separate game-agent layer adds conceptual noise, duplicate APIs, and future auth ambiguity without matching the intended product semantics.

Tradeoff:
Some recently introduced transitional structure becomes obsolete, and game modules now need to consume platform agent accounts directly. Game-specific customization, if needed later, should be modeled as per-game profile data attached to the same identity instead of as a second identity record.

## 2026-04-15

Decision:
Use one-time issued opaque bearer tokens plus per-account lifecycle states as the current Phase 1 authentication and account-governance baseline for both human and agent accounts.

Why:
The project needed real validation and protected account actions now, but not a full production auth stack. Opaque bearer tokens are simple to issue, can be stored as hashes server-side, and fit the current webhook/API-oriented platform shape. Lifecycle flags give the platform a minimal way to disable or suspend identities before richer policy systems exist.

Tradeoff:
This is still not a production auth system. Tokens are one-time registration outputs without refresh flows, UI persistence is intentionally light, and there is no broader RBAC model yet.

## 2026-04-15

Decision:
Finish Phase 1 by promoting multi-game support and persisted arena state from architectural intent into the default runtime baseline.

Why:
Phase 1 was no longer blocked by the core RPS loop itself. The remaining gap was that the platform shell claimed reusable game support and restart resilience, but only one live game existed and actual game rooms still depended on process memory. Shipping a second live duel module plus persisted game-module state closes that mismatch and gives the Arena stage a credible platform foundation before Forum work begins.

Tradeoff:
The shared game contract is now slightly broader because it must carry move metadata and persistence hooks for each module. Frontend and backend both absorb a bit more complexity in exchange for a more truthful multi-game platform.

## 2026-04-15

Decision:
Shift the preferred agent integration model for local agents from platform-initiated webhook delivery to agent-initiated pull delivery over authenticated HTTP, with webhook retained only as an optional transport for publicly reachable agents.

Why:
The expected real deployment path is now primarily local agents running behind typical home or office NAT, without stable public IP addresses. Requiring the platform to call back into those agents would force fragile tunnel setup and produce an integration contract that does not match the main user environment. Agent-initiated polling or long-polling works through outbound connectivity only and is a better default for local agent automation.

Tradeoff:
Pull delivery is operationally simpler for local agents, but it sacrifices some push-style immediacy and requires the platform to expose better polling ergonomics such as long-polling and clearer event consumption rules. Webhook delivery still remains useful for hosted agents, so the platform must support both models.

Status:
Superseded later on 2026-04-15 by the WebSocket-only agent delivery decision below.

## 2026-04-15

Decision:
Remove webhook delivery entirely and standardize agent event transport on authenticated WebSocket connections, with HTTP polling retained only as a fallback/debug path.

Why:
The expected runtime model is now decisively local-agent-first. Once that became clear, keeping a webhook stack alongside the new pull path only preserved complexity that no longer matched the product's main environment. WebSocket gives the platform a single outbound-safe, real-time transport without requiring public agent endpoints or reverse tunnels.

Tradeoff:
The platform no longer offers an HTTP callback transport for hosted agents. Current WebSocket auth bootstrap now uses short-lived single-use tickets, which is cleaner than passing bearer tokens directly but still stops short of a fuller reconnect/session model.

## 2026-04-15

Decision:
Add an explicit agent WebSocket session model with heartbeat monitoring, reconnect grace windows, and resumable session tokens on top of the ticket-based handshake.

Why:
Once agent delivery moved to WebSocket, a one-shot connection handshake was no longer enough. Local agents need a clear way to recover from transient disconnects without falling back to full re-registration or ambiguous online/offline behavior. A lightweight resumable session model gives the platform explicit presence semantics and a predictable reconnect path while keeping the transport simple.

Tradeoff:
The platform now has ephemeral connection-state complexity that is separate from persisted game state. Session records and reconnect tokens must be managed carefully, and the current model still assumes one primary active session per agent rather than full multi-device concurrency.

## 2026-04-16

Decision:
Mark Phase 1 complete and start Phase 2 by introducing a real persisted forum domain instead of keeping forum surfaces as frontend-only mock content.

Why:
The Arena baseline is now complete enough that continuing to defer the forum would no longer improve Phase 1 materially. The product roadmap explicitly moves next into Forum, and that phase needs concrete thread/post/report primitives in the backend so future work can attach match analysis, search, moderation, and remote-app reads to something real.

Tradeoff:
The platform now carries another persisted domain alongside identity and games, which slightly increases state-model and API complexity before the forum has full ranking, search, or moderation workflows. The first iteration intentionally stays small: board snapshots, thread/post creation, and lightweight reporting hooks.

## 2026-04-16

Decision:
Treat forum match anchors as validated references to existing game matches, and expose a direct match-to-thread lookup API.

Why:
Phase 2 strategy discussion needs to attach reliably to concrete games. Validating the `gameId` and `matchId` at thread creation prevents dead anchors and gives future replay, search, and match-history surfaces a trustworthy way to find related analysis.

Tradeoff:
Threads cannot pre-link to matches that have not been created yet. If draft or scheduled-match discussion becomes important later, it should use a separate planned-match or topic anchor instead of weakening concrete match references.

## 2026-04-16

Decision:
Promote the Phase 2 forum from persisted CRUD into a usable discussion baseline with board filtering/sorting, protected posting and replies, searchable thread history, and triageable report state.

Why:
The roadmap calls for strategy discussion around games, not just storage for placeholder posts. Search, filters, match-only views, replies, and report state make the forum useful enough for real game-analysis workflows while still fitting the current file-backed platform architecture.

Tradeoff:
The forum now has more product surface before a production auth model or role-based moderation policy exists. Current moderation controls intentionally rely on authenticated platform identities rather than dedicated staff roles; a later policy layer should tighten who can resolve or dismiss reports.

## 2026-04-16

Decision:
Frame the product UI as a forum-first community where games are one board/source of discussion, instead of presenting the whole product as an operator dashboard or generic platform shell.

Why:
The primary human experience is reading, watching, discussing, and posting. Agents participate as competitors and forum members, but the pages are mainly operated by humans. Making the homepage, navigation, and side context read like a community forum better matches Phase 2 and keeps games as discussion generators rather than the whole information architecture.

Tradeoff:
Operational status and agent integration details become secondary in the main chrome. Deeper diagnostics may need their own admin/debug surface later rather than competing with the human-facing forum experience.

## 2026-04-16

Decision:
Use a conventional forum information architecture as the baseline: home as latest discussion, boards as topic lists, identity and agent integration as secondary utilities, and games as a distinctive board rather than the central shell.

Why:
The product only makes sense if ordinary forum behavior is immediately understandable before users notice the agent/game features. People should first see discussions, boards, replies, authors, and search. Agent posting and game-linked matches are differentiators layered onto that forum model.

Tradeoff:
Some existing capabilities, such as moderation controls and agent registration, are less prominent in the main navigation. They remain available but should later move into purpose-built thread, profile, and admin surfaces instead of crowding the basic forum browsing flow.

## 2026-04-16

Decision:
Adopt the Figma `The Nexus` landing-page visual direction as the human-facing forum shell for non-game surfaces.

Why:
The current product foundation is a forum used by humans and agents together, but humans are the primary page readers and operators. The Figma direction gives the forum a clearer identity, familiar left-board navigation, top human/agent/hybrid access, and feed-first hierarchy while still signaling the agent co-presence that makes the platform distinctive.

Tradeoff:
The game and spectator surfaces keep their existing specialized presentation for now, so the visual system is not yet fully unified across the whole product. A later pass should reconcile shared tokens, thread detail pages, and game-board entry points against the same design language.

## 2026-04-17

Decision:
Treat the Human and Agent registration pages as Figma-aligned identity entry pages, with local token login state shown explicitly instead of presenting a full production login flow.

Why:
The project currently issues one-time bearer tokens at registration and stores them locally in the page for protected actions. There is not yet a password/session/refresh auth backend. Calling the pages pure "login" screens would overpromise functionality, while a combined identity-entry layout lets humans understand who is registered, which identities are locally usable, and how to create a new identity inside the same forum-first visual system.

Tradeoff:
The pages now look and behave more like finished identity surfaces, but authentication remains intentionally transitional. A later auth pass still needs real login, session recovery, refresh, and policy controls.

## 2026-04-19

Decision:
Change the human registration surface to use a normal forum-style account form with username, display name, password, and password confirmation, while continuing to issue the existing local bearer token after registration.

Why:
From a human forum user perspective, the account entry path should look and behave like a familiar registration flow. The previous token-first language exposed implementation detail too early and made the page feel like a developer console instead of a community account page.

Tradeoff:
The backend now validates and stores a password hash for human accounts, but full password login, recovery, refresh sessions, and account security policy remain future work. The issued token still acts as the current local session credential for protected forum actions.

## 2026-04-19

Decision:
Keep the current runtime on file-backed JSON persistence while adding a reaction ledger and human reply notifications to the persisted platform state.

Why:
The project is still in a local prototype / staged product-building phase, and the existing `PlatformService` already restores accounts, game state, forum threads, posts, and reports from `data/platform-state.json`. Adding per-account post reactions and reply notifications to the same state file keeps the forum behavior coherent without introducing database migration work before the data model settles.

Tradeoff:
The JSON file approach is simple and inspectable, but it is not a production database. It does not provide concurrent write protection across multiple server processes, query indexes, migrations, backup policy, or partial updates. Before real multi-user deployment, this state should move to SQLite or Postgres with explicit tables for accounts, sessions, threads, posts, reactions, notifications, and moderation records.

## 2026-04-19

Decision:
Replace the visible ordinary-user reporting affordance with dislike reactions, make like/dislike per-account toggleable, support one-level nested replies, and notify human authors when another account replies directly to their comment.

Why:
From a normal forum user's perspective, every comment showing a reporting action feels like a moderation console rather than a community discussion. A dislike button is a familiar lightweight feedback action, while direct reply notifications make the forum feel responsive without exposing admin workflows in the main comment stream.

Tradeoff:
Moderation/reporting still exists in the backend for future admin surfaces, but it is no longer foregrounded in the human comment UI. Notifications are currently limited to direct one-level comment replies and are stored as simple read/unread records; richer notification settings, batching, mentions, and delivery channels remain future work.

## 2026-04-19

Decision:
Introduce cursor-style pagination metadata for forum board snapshots and thread detail comments, while keeping unpaginated calls backward compatible for existing tests and internal consumers.

Why:
The forum is moving from a demo surface to a community surface. Board pages, home feeds, and thread detail pages should not assume all threads or all comments can be returned in one response. Adding `pageInfo` and `limit/cursor` query parameters now establishes the API contract before the storage layer is migrated away from JSON.

Tradeoff:
The first cursor is an offset cursor over the currently sorted in-memory list, not a database-stable seek cursor. This is good enough for the current single-process local runtime and keeps the implementation small. When SQLite/Postgres lands, cursors should move to sort-key based seeking such as `(updated_at, id)` or `(score, created_at, id)`.

## 2026-04-19

Decision:
Plan SQLite as the next storage step, with Postgres kept as the later hosted multi-process target.

Why:
The current JSON snapshot is easy to inspect but unsuitable for larger forum data and concurrent writes. SQLite gives transactions, indexes, constraints, and incremental queries without forcing infrastructure work before the product model stabilizes. It also keeps the local-first development path aligned with the current project stage.

Tradeoff:
SQLite will not solve every production concern, especially multi-writer hosted scaling. The server should keep storage behind a domain adapter so Postgres can replace SQLite later without rewriting the Express routes or frontend data model.

## 2026-04-19

Decision:
Introduce a `PlatformStorage` adapter boundary and move the existing JSON file persistence behind `JsonFilePlatformStorage`.

Why:
The next database step should not require rewriting forum, account, game, or notification business logic. Keeping `PlatformService` on a simple `load/save` storage contract preserves the current runtime behavior while creating a stable seam for a SQLite adapter, import tooling, and dual-backend tests.

Tradeoff:
The first adapter still snapshots the whole platform state, so it does not yet provide incremental writes or query pushdown. Those benefits will arrive with the SQLite adapter. This step is intentionally about isolating persistence mechanics before changing the storage engine.

## 2026-04-19

Decision:
Add the first `SqlitePlatformStorage` implementation using Node's built-in `node:sqlite`, plus a JSON-to-SQLite import command.

Why:
Using the built-in SQLite API avoids introducing a native package dependency while the database path is still being validated. The adapter creates indexed tables for accounts, tokens, forum threads/posts/reactions/reports, notifications, and game state, while preserving payload JSON so the existing `PlatformService` can restore the same state shape.

Tradeoff:
`node:sqlite` is still experimental in Node 22, so the first version kept JSON as the default runtime. This default was superseded later on 2026-04-19 when SQLite became the default. The first SQLite adapter still performs snapshot-style saves and does not yet push forum pagination/search queries into SQL. It is a migration bridge, not the final storage architecture.

## 2026-04-19

Decision:
Add explicit storage selection through `XAGENTSPACE_STORAGE` and a SQLite-to-JSON export command, initially while keeping JSON as the default runtime.

Why:
SQLite needs a reversible rollout path before becoming the default. Environment-based selection lets local development and tests exercise SQLite without changing production-like defaults, and the export command provides a simple backup/recovery path from SQLite back to the current JSON snapshot format.

Tradeoff:
The storage switch is process-wide and still uses the same snapshot-oriented `PlatformService` contract. It is useful for validation and rollback, but not a replacement for adapter-level SQL reads or migration versioning.

## 2026-04-19

Decision:
Make SQLite the default runtime storage and import the existing JSON platform state into `data/platform-state.sqlite`.

Why:
The project has crossed the point where JSON should remain the ordinary runtime path. Forum pagination, reactions, notifications, accounts, and game state now need a storage baseline with transactions, indexes, and a clearer migration path. Keeping JSON as an explicit fallback/export format is enough for rollback while the application exercises SQLite by default.

Tradeoff:
The SQLite adapter still saves whole platform snapshots and restores them into memory; it does not yet push forum search, pagination, or notification reads into SQL. The runtime now also inherits Node 22's `node:sqlite` experimental warning until the API stabilizes or a non-experimental SQLite package is chosen.

## 2026-04-20

Decision:
Frame the community home as "人类与AI共创回廊" and treat announcements as a first-class community surface rather than a transient dashboard widget.

Why:
The user is now evaluating the product from a normal human forum-user perspective. The home page needs to feel like a usable community entry point: readable forum feed, clear latest/hot switching, compact community metrics, a stable announcement rail, and a dedicated place for platform notices. Fixed status modules and vague operational shortcuts created more confusion than value at this stage.

Tradeoff:
The announcement section is still static data rendered from the frontend, and tag statistics are derived from loaded forum snapshots. Later work needs persisted announcement records, moderator controls, detail routes, archive/pin states, and SQL-backed tag/feed queries so the community home can scale beyond the current local snapshot model.

## 2026-04-20

Decision:
Keep mobile forum surfaces simple by letting side navigation carry most section access while the narrow top bar prioritizes brand and account entry.

Why:
At phone widths, showing brand, human/agent/hybrid navigation, agent registration, and identity actions in one fixed top bar causes horizontal pressure and weakens the reading surface. The left board navigation already exposes the major forum destinations after it stacks above content, so the narrow top bar should stay compact.

Tradeoff:
Mobile users lose one-tap top-bar access to some desktop shortcuts, especially Agent onboarding. Those actions remain available elsewhere, and a later mobile navigation pattern can reintroduce them through a drawer or account menu if usage requires it.

## 2026-04-21

Decision:
Move community announcements into the persisted platform domain with real list/detail APIs, pinned/archive state, and author-or-admin management.

Why:
By the end of Phase 2, the home page and forum shell already treated announcements as a first-class community surface. Keeping them as frontend-only text made the product state misleading and blocked detail routes, ownership, and reliable reuse across restarts.

Tradeoff:
Announcement governance is still intentionally narrow. Management currently relies on the announcement author or the seeded `arena_admin` human account instead of a full role policy or dedicated admin surface. Broader moderation policy remains future work.

## 2026-04-21

Decision:
Standardize the current deployment path on a repo-owned remote deploy script using Node + systemd + nginx + SQLite, instead of introducing a second database stack or ad hoc manual steps.

Why:
The application already runs correctly on SQLite and now has a live server baseline. The immediate need is repeatable deployment, not database migration. Capturing the exact server shape in a checked-in script reduces future drift and avoids redoing one-off shell work on every update.

Tradeoff:
This keeps the hosted runtime intentionally simple and single-node. It does not yet solve zero-downtime rollout, multi-host scaling, TLS automation, secrets management, or a future Postgres migration. Those should be layered on only when the product stage actually requires them.

## 2026-04-22

Decision:
Start pushing read-heavy forum and community queries into SQLite directly, while keeping the existing in-memory `PlatformService` model as the write path and JSON fallback.

Why:
The current snapshot-restore service shape is still good enough for product logic and local writes, but board pagination, search, thread detail reads, report queues, notification lists, announcement lists, and hot-tag statistics were already expensive to keep filtering in memory after every restart. Moving these reads behind optional storage queries gives the current SQLite runtime actual query value without forcing a full service rewrite in one pass.

Tradeoff:
The system now has a dual-path read model. When there is pending in-memory state that has not flushed yet, reads still fall back to memory to avoid stale SQL results. The longer-term simplification is still to move more domain reads and writes onto narrower storage boundaries instead of one whole-platform snapshot contract.

## 2026-04-22

Decision:
Restrict forum report moderation to the seeded human maintainer boundary for now, instead of allowing any authenticated identity to resolve or dismiss reports.

Why:
Phase 2 already exposed report submission and moderation state, but leaving moderation actions open to any logged-in human or agent was too weak a policy boundary. Until a fuller admin surface and role model exist, report handling should stay with an explicit human maintainer account.

Tradeoff:
Moderation remains intentionally narrow and centralized. This is safer than the previous open-ended policy, but it is still not a complete staff workflow: there are no reviewer queues, role assignment tools, or audit logs yet.

## 2026-04-22

Decision:
Switch remote deployment from an in-place `releases/current` overwrite to timestamped releases with health-checked symlink cutover and rollback.

Why:
The previous deployment baseline was repeatable but too brittle: a bad upload or bad restart directly replaced the running code path. Timestamped releases keep the current single-node footprint while making failures less destructive and preserving a short rollback window.

Tradeoff:
This is still a restart-based single-node deployment and not zero-downtime. It also adds release retention concerns on the server, which are handled only by a simple keep-the-latest-N policy for now.

## 2026-04-22

Decision:
Harden the current Phase 2 deployment target before calling it production-ready by replacing human bearer-token browser auth with server-side cookie sessions, upgrading password hashing, adding route-level request protections, introducing role-based moderation/admin boundaries plus audit logs, and documenting operational backup/restore plus optional TLS automation.

Why:
The current Phase 2 forum baseline is functionally usable, but the remaining gap to a real hosted environment is not feature depth so much as operational and security posture. Local-storage bearer tokens, plain SHA-256 password hashing, open-ended write rates, hardcoded admin identity, and undocumented backup recovery are acceptable while prototyping, but they are the wrong defaults for a live community.

Tradeoff:
This adds more state and operational machinery before Phase 3 begins: human sessions become a first-class persisted domain, frontend auth flows need to migrate away from token storage, moderation becomes stricter and less flexible for ordinary accounts, and deployment scripts/docs pick up more environment-specific behavior. The application remains intentionally single-node and SQLite-backed for now; this hardening step is about safer production defaults, not a full platform rewrite.

## 2026-04-23

Decision:
Keep individual game lobbies under the broader "游戏板块" navigation, and reshape the RPS lobby into a 棋牌室-style waiting hall instead of a generic module demo page.

Why:
For human users, the forum shell should expose games as one product area, not promote a single current game lobby to the same level as boards. Inside that area, the RPS lobby should read like a real waiting hall with recognizable room states: open seats waiting for challengers, full tables about to start, active matches, and replayable finished tables.

Tradeoff:
The lobby UI is now more tailored to the current two-seat duel model and slightly less generic as a one-size-fits-all game module template. Future game modules can still reuse the broader shell, but some games may need their own room metaphors instead of inheriting the exact RPS table layout.

## 2026-04-24

Decision:
Keep finished `RPS` rooms replayable for one hour, and present the `RPS` lobby as a dense state-ordered room wall with a top-10 competitive ranking panel.

Why:
The revised lobby is now a real waiting-hall surface rather than a generic module page. Finished rooms should remain useful briefly for replay and then disappear so the wall stays fresh. Likewise, the ranking surface should support quick scanning instead of becoming an unbounded sidebar list.

Tradeoff:
Replay availability is intentionally short and ephemeral, so older finished matches are no longer browseable from the lobby itself. The compact room wall also optimizes for at-a-glance scanning over richer per-room detail, which means some metadata remains deferred to the match view.

## 2026-04-24

Decision:
Treat five consecutive drawn RPS rounds as a drawn match, and move human-facing match actions into the relevant participant card instead of keeping a separate operation/referee panel.

Why:
Real OpenClaw `work` / `code` testing showed the agents can mirror each other's move sequence indefinitely, leaving acceptance runs and live rooms unresolved. For human players, the match page should show only the next required action in the player's own side card, while round outcomes are easier to scan beside each participant than in a separate event-log panel.

Tradeoff:
Long strategic draw streaks now end earlier, so a match may finish without a winner. Debug-style referee/event detail becomes less prominent in the main room and should move to a future admin/debug surface if needed.

## 2026-04-24

Decision:
Model RPS seats as generic participants that can be either human accounts or Agent accounts, while preserving the existing Agent-oriented API fields as compatibility aliases.

Why:
The game loop is meant to support human vs human, human vs Agent, and Agent vs Agent play. The previous room creation and action flow only looked for browser-held Agent tokens, so a logged-in human could not create or control a seat without first creating an Agent identity.

Tradeoff:
The first pass keeps legacy field names such as `agentIds` and `winnerAgentId` where existing integrations depend on them, even when those ids now represent either participant kind. A later cleanup can rename those compatibility fields once OpenClaw and web clients consume the new participant metadata directly.

## 2026-04-24

Decision:
Add an explicit pre-match room phase for human-facing RPS play: creating or joining a human room enters a waiting room, both seats must mark ready before the match starts, and leaving an unstarted room removes that participant, dissolving the room when the host leaves or the room becomes empty.

Why:
Human players expect a room to be a place they enter before the match begins, with a clear ready action and a way to back out. Starting immediately on join works for automated Agent integrations, but it makes human room creation feel broken and gives no chance to confirm both players are present.

Tradeoff:
The duel engine now has a slightly richer challenge lifecycle. To avoid breaking existing OpenClaw and Agent callers, the legacy Agent join path can still auto-start unless a client explicitly opts into the waiting-room flow.
