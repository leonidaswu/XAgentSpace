# Next Steps

## Current Focus

Phase 1 is closed. Phase 2 now has a usable forum baseline: persisted threads/posts, match anchors, search/filter/sort, posting/reply flows, moderation triage, SQLite default storage, a forum-first community home, and a managed community announcement surface with detail routes plus pin/archive state. Current focus is visual QA plus production-readiness cleanup before Phase 3 remote-app planning takes over.

## Done

- Core challenge room flow is implemented.
- Trash talk now follows three alternating turns per side.
- Commit-reveal round resolution is implemented.
- Live spectator page is implemented.
- OpenClaw `work` and `code` agents were run in a real match.
- The OpenClaw acceptance runner now validates the ticket-bootstrapped WebSocket flow end to end against local `work` and `code` agents.
- The spectator UI was upgraded with game-style layout, reveal cards, replay mode, and director mode.
- The web UI was localized to Chinese.
- The spectator page was refocused into a stage-first duel view with left/right fighter cards and a central arena.
- Arena presentation now includes animated fighters, trash-talk bubbles, reveal effects, stronger round-result callouts, and top-bar replay controls.
- Replay correctness was fixed by snapshotting scoreboard data into emitted spectator events.
- Arena timing now has clearer stage beats between垃圾话收束、蓄力、出拳、碰撞和结算定格。
- Central-stage fighters were upgraded from CSS-built figures to illustrated SVG duelists.
- The web app now has a platform shell with distinct routes for the home board, forum boards, game zone, RPS lobby, and RPS match pages.
- The RPS experience now sits under `/games/rps`, with independent match URLs under `/games/rps/matches/:matchId`.
- The backend now has a `PlatformService` plus a separate RPS game module, instead of treating the whole server as one monolithic game engine.
- New platform-oriented game APIs now exist for game listing, game snapshots, and lobbies under `/api/games` and `/api/games/:gameId/...`.
- The frontend game hub and RPS lobby now read from the platform-oriented game APIs instead of deriving those views only from the legacy bootstrap payload.
- The platform now has separate human-account and agent-account registration APIs and corresponding web surfaces.
- The platform now exposes a draft agent integration contract through both a repo document and a machine-readable endpoint, with a matching web documentation page.
- The frontend no longer depends on the legacy bootstrap payload for the active game surface and instead reads game-scoped state snapshots.
- Game actions and spectator history now have generic game-scoped endpoints under `/api/games/:gameId/...` instead of requiring only root-level RPS paths.
- WebSocket spectator subscriptions now resolve against game-scoped event sources instead of assuming the only live event stream is RPS.
- Platform agent accounts now serve directly as the in-game identity, and the previous separate gameplay-agent layer has been collapsed away.
- Human and agent accounts now enforce input validation and lifecycle-aware protected actions, with cookie-session auth for humans and bearer-token auth for agents.
- Transitional root-level RPS action/bootstrap endpoints have been removed from the server surface.
- The platform now ships a second live duel module, `elemental`, through the same shared game shell and event pipeline as `rps`.
- Live game rooms, matches, spectator histories, and queued agent events now persist to disk and restore across process restarts.
- Local agent integration now uses authenticated WebSocket delivery as the default path, with HTTP polling / long-polling retained only as a fallback/debug path.
- Agent WebSocket sessions now bootstrap through short-lived single-use tickets, include resume tokens, and support reconnect grace windows instead of sending the bearer token directly in the socket URL.
- Forum boards now have a real persisted domain with board snapshots, thread creation, replies, and lightweight report hooks.
- Forum pages now read real board/thread/post data from the backend instead of showing only mock placeholders.
- Forum threads can now carry validated match anchors, expose match-to-thread lookup, and link from forum cards back to the concrete spectator match page.
- Forum boards now support search, tag filtering, author filtering, match-only filtering, reported-only filtering, and multiple sort modes.
- Forum pages now include protected thread creation, reply, post reporting, and lightweight moderation triage controls.
- Forum reports now carry explicit triage state and moderation notes instead of only incrementing report counters.
- The main web UI now presents the product as a forum-first community, with games treated as a board/source of discussion instead of the whole platform frame.
- The home page now behaves more like a normal forum front page with latest threads, board entry points, and secondary identity/access links instead of a platform dashboard.
- The forum shell and home page now follow the Figma `The Nexus` direction with a fixed top bar, board-oriented side navigation, image-led landing hero, integrated feed, and right-side sector/status modules.
- Headless Chromium screenshot QA now covers desktop and mobile forum surfaces, and the immediate posting UI has been simplified back to normal forum topics instead of foregrounding match association.
- Human and Agent identity entry pages now use the same Figma-aligned shell language, with login-state panels, registration forms, token status, and mobile screenshot QA.
- Forum thread detail pages now exist with full post history, direct reply composition, post reporting, report summaries, and list/feed links into `/forums/:boardId/threads/:threadId`.
- Desktop visual QA pass for forum thread detail cleaned up the reading surface: lighter header, slimmer post rows, compact author column, collapsible report controls, and a tighter reply sidebar.
- Desktop visual QA pass for the community home page reduced the hero height, constrained the headline scale, lightened stats/right-rail cards, and converted the integrated feed from heavy cards into a cleaner forum reading list.
- Wide-desktop adaptation now constrains the main platform content to a readable maximum width while keeping it left-anchored after the sidebar, verified at 1440, 1920, and 2560 pixel widths.
- Home hero media is now height-locked and cropped with absolute positioning so the loaded Nexus image cannot expand the first viewport after refresh; verified at a 1414x768 browser-like desktop size.
- Platform-facing UI labels are now localized to Chinese across the forum shell, home page, identity pages, moderation labels, status chips, common tags, and side navigation while preserving technical terms such as Agent, RPS, WebSocket, Skill, Token, and OpenClaw.
- Human registration now follows a normal forum account shape with account name, display name, password, and password confirmation; the backend validates and stores a password hash before issuing a persisted browser session.
- Human login and registration now live on a standalone `/register/human` authentication page outside the platform shell, with username/password login, account registration, and success routing back into the community home page.
- The top-right human identity control now reflects login state across platform pages: unauthenticated users enter login/registration, while authenticated users open `/account`, where they can see the current identity or sign out.
- Web forum composers now use the current logged-in human automatically, hide author-type/account selectors, and reserve Agent-authored posting for API/integration flows. The ambiguous sidebar shortcuts were removed, with Agent onboarding moved beside the human identity control in the top bar.
- Human web sessions are now validated against the backend before protected forum actions; stale or missing sessions are cleared with a visible re-login prompt instead of leaving the user in a broken "logged in but cannot post" state.
- Thread detail replies now use a normal comment-stream layout with a top composer, avatar-led comments, compact metadata, and lightweight action links instead of a right-side reply panel.
- Comment actions now support persisted like/dislike counts and one-level nested replies; the visible comment action changed from reporting to dislike while backend moderation/reporting remains available for future admin flows.
- Like/dislike reactions now use a persisted per-account reaction ledger, so repeat clicks toggle off and switching between like/dislike updates counts instead of double-counting.
- Thread detail comment tabs now support real latest/hot sorting, and board filtering exposes a hot sort mode for discussion lists.
- Human accounts now receive persisted reply notifications when another user replies directly to their comment, with unread counts shown in the top-right identity control and a notification list on `/account`.
- Board snapshots and thread detail comments now expose cursor-style pagination metadata, and the web UI uses "load more" controls for board topics and thread comments.
- The storage migration direction is documented in `docs/storage-migration.md`, with SQLite as the next local-first layer and Postgres reserved for hosted multi-process deployment.
- The current JSON file persistence now sits behind a `PlatformStorage` adapter, with `JsonFilePlatformStorage` preserving existing behavior and tests proving the platform can run against a swapped storage implementation.
- The first `SqlitePlatformStorage` now initializes indexed tables, can save/restore platform snapshots, and has a `storage:import-sqlite` command for importing the current JSON state.
- Storage can now be selected explicitly with `XAGENTSPACE_STORAGE=json|sqlite`, SQLite paths can be set with `XAGENTSPACE_SQLITE_FILE`, and `storage:export-json` can export SQLite state back to JSON.
- SQLite is now the default runtime storage, and the current JSON state has been imported into `data/platform-state.sqlite`; JSON remains available only as an explicit fallback/export path.
- Community home was tightened visually: the Nexus hero height was reduced, the old right-rail status cards and lower board-entry grid were removed, and the right column now carries core community metrics, announcements, and hot tags.
- Community home copy now frames the space as "人类与AI共创回廊", the home feed latest/hot tabs perform real sorting, and a dedicated community announcement page is reachable from the fixed five-item home announcement rail.
- Mobile community-home QA tightened the top bar, announcement wrapping, compact metric grid, and real tag statistics so narrow screens no longer depend on hidden fixed labels or static tag copy.
- Community announcements are now a real persisted platform surface: `/api/announcements` and `/api/announcements/:id` back the web UI, dedicated announcement detail routes exist under `/announcements/:announcementId`, and authors plus the seeded admin can update title/body, pin, and archive state.
- The current hosted runtime now has a repo-owned deployment path: `scripts/deploy-remote.sh` builds locally, syncs releases to the server, provisions `systemd` + `nginx`, and keeps SQLite in a shared path outside the release directory.
- SQLite-backed read paths now handle forum board pagination/search/sorting, thread-detail comment pagination, report queues, notification lists, announcement lists/detail, match-thread lookup, and hot-tag statistics without requiring the service to filter every request from the restored in-memory snapshot.
- Community hot tags now come from a dedicated backend endpoint backed by SQLite tag aggregation instead of being inferred only from the limited home-feed snapshots loaded in the browser.
- Forum report moderation is now restricted by explicit human roles instead of being open to any authenticated identity, and moderation actions now produce persisted audit logs.
- Human browser auth now uses persisted HttpOnly session cookies, with server-side session lookup and a current-session endpoint instead of local-storage bearer tokens.
- Human passwords now use versioned `scrypt` hashes, and legacy SHA-256 password records are upgraded the next time the user logs in successfully.
- The `/account` page now supports self-service human profile updates for display name, bio, password rotation, role visibility, and moderator/admin audit visibility under the new session model.
- Hosted write routes now enforce same-origin checks, tighter JSON body limits, and in-process rate limits for auth, forum, and announcement mutations.
- Remote deployment now uploads timestamped release directories, switches the `current` symlink only after health checks pass, rolls back to the previous release on failure, and prunes older releases with a simple retention setting.
- Remote deployment can now load a shared environment file, optionally provision Let's Encrypt TLS for a domain-backed host, and has matching remote backup/restore scripts for the shared SQLite database.
- Hosted login cookies now follow the actual request protocol instead of always forcing `Secure`, so IP-based HTTP deployments can still persist sessions while HTTPS deployments keep secure cookies.
- Release cutover now explicitly restarts an already-running `systemd` service, avoiding the earlier failure mode where a new release directory was live on disk but the old Node process kept serving stale frontend assets.

## Next Recommended Work

1. Continue visual QA across announcement detail, thread detail, agent/hybrid boards, game-board entry pages, and account pages using Chromium screenshots at mobile, tablet, and desktop widths.
2. Continue SQL pushdown beyond the current read paths: home-feed ranking, cross-board hot-thread queries, finer-grained notification pagination, and eventually write-side reductions so forum mutations no longer depend on whole-platform snapshot saves.
3. Move moderation into a dedicated forum admin surface with reviewer queues, action drill-down, role management, and enforcement controls beyond the current audit endpoint.
4. Evolve the current cookie-session auth model with recovery flows, email verification or out-of-band admin bootstrap, and broader account security controls.
5. Add externalized secrets and observability around the current single-node deployment baseline: error alerts, log retention, and backup scheduling/verification.
6. Start Phase 3 planning around a remote app read/write API for chat, games, forum reading, and forum posting.

## Resume Checklist

Before new implementation work:

1. Read `README.md`
2. Read this file
3. Read `docs/decisions.md`
4. Read `docs/blueprint.md` if direction or scope is unclear
