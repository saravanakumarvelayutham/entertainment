# Workspace Dashboard

This document records the current dashboard implementation inside the workspace
shell.

Related:

- [Workspace Shell](./workspace-shell.md)

## Summary

- The dashboard is the default `/workspace` landing page.
- It is a **rail-based** content surface (Netflix / Apple TV pattern), not a
  customizable widget grid.
- Layout order is static and curated — there is no edit mode, drag-drop, or
  size stepper. Each rail has a persisted show/hide toggle
  (`Settings.dashboardRails`, `DashboardRailsSettings` in
  `libs/shared/interfaces/src/lib/settings.interface.ts`, surfaced under
  Settings → Dashboard); every template rail is gated by
  `dashboardRails().<key>`. Rails additionally auto-hide when empty.
- First-run users see the shared welcome empty-state with a single primary
  CTA to add their first playlist.

Core implementation:

1. `libs/workspace/dashboard/feature/src/lib/rails/workspace-dashboard-rails.component.ts`
   — the page-level facade.
2. `libs/workspace/dashboard/feature/src/lib/rails/dashboard-rail.component.ts`
   — the reusable horizontal rail.
3. `libs/workspace/dashboard/data-access/src/lib/dashboard-data.service.ts`
   — data aggregation (recent items, favorites, playlist stats). Shared across
   rails.
4. `libs/playlist/shared/ui/src/lib/recent-playlists/empty-state/empty-state.component.ts`
   — reused welcome state with the primary "Add your first playlist" CTA.

## Page Structure

The Library masthead introduces a wide feature card with a horizontal history
deck beneath it. The deck scrolls sideways when its candidates do not fit.
The feature uses a dark media
surface, bold sans-serif title and silver actions. Desktop artwork occupies
the right side under a copy scrim; phone artwork fills the card. Content rails
follow in normal flow, with no negative overlap or colored page wash. The
loading skeleton reserves the same feature geometry. Existing artwork,
fallback handling, content order and metadata preferences remain the source
of every visible title and image.

```
┌─────────────────────────────────────────────────────────────────────┐
│  Library masthead + contained hero, "Up next for you"              │
│  separate history deck (the other newest recent items)            │
│  Independent content rails below the feature card                 │
│  Continue Watching · See all →                                      │
│  [16:9 still ▬▬▬▬▭][16:9 still ▬▭][16:9 still ▬▬▬▭] →→             │
├─────────────────────────────────────────────────────────────────────┤
│  Live now on your favorites · See all →                             │
│  [logo · channel / time · LIVE | programme | ▬▬▬▭] →→              │
├─────────────────────────────────────────────────────────────────────┤
│  Recently watched live TV · See all →                               │
│  [programme-first live card] →→                                     │
├─────────────────────────────────────────────────────────────────────┤
│  Favorite movies & series · See all →                               │
│  [poster][poster][poster][poster] →→                                │
├─────────────────────────────────────────────────────────────────────┤
│  Recently Used Sources · See all →                                  │
│  [tile][tile][tile][tile] →→                                        │
├─────────────────────────────────────────────────────────────────────┤
│  Recently Added on Xtream (aggregated across providers)             │
│  [poster][poster][poster] →→                                        │
├─────────────────────────────────────────────────────────────────────┤
│  Because you watched X (TMDB, opt-in, Electron-only)                │
│  [poster][poster][poster] →→                                        │
├─────────────────────────────────────────────────────────────────────┤
│  Top 10 this week (TMDB, opt-in, Electron-only)                     │
│  1[poster] 2[poster] 3[poster] … →→                                 │
├─────────────────────────────────────────────────────────────────────┤
│  Top rated (TMDB, same toggle; excludes the Top 10 titles)          │
│  [poster][poster][poster] →→                                        │
└─────────────────────────────────────────────────────────────────────┘
```

Render rules:

1. Dashboard rails render independently as their data sources resolve. The
   page no longer uses `dashboardReady()` as a page-wide skeleton gate.
   Initial hero/recent/favorites loading states render scoped skeletons so one
   slow rail does not hide already available content.
2. `hasPlaylists() === false` → render `<app-empty-state [type]="'welcome-dashboard'">`
   full-bleed. All rails and the hero are skipped.
3. The hero features one of the newest `HERO_CANDIDATE_LIMIT` (5) global
   recent items. The newest is featured by default; the up-next deck
   (`heroUpNext()`, `data-test-id="dashboard-hero-up-next"`) renders every
   candidate as a titled thumbnail button and `featureHeroItem(key)` swaps the
   banner without navigating. The selection is session-only; a selected item
   that leaves the recent list falls back to the newest one
   (`selectDashboardHeroItem`). The deck renders horizontally beneath the wide cinematic feature, with native
   sideways scrolling when needed, and appears only with at least two candidates. The TMDB extras effect follows the featured item.
4. Each rail is emitted via `@if (cards.length > 0)`. Empty rails are hidden
   — there is no "empty widget" placeholder.
5. The hero prefers a stored Xtream `backdrop_url` (or the TMDB backdrop
   extra). With a real backdrop the poster is not shown. Without one the
   banner falls back to a blurred poster wash with the sharp poster beside the
   copy, then to the title-derived fallback gradient. The banner surface is
   always dark, so the copy is light in both app themes.
6. The hero's primary action keeps the resume navigation state (series
   resume the saved episode); `Details` (`dashboard-hero-details`, movies and
   series only) carries the detail-only state. A live hero offers only
   "Watch live".
7. Continue Watching uses the rail's `landscape` layout: a 16:9 still from
   `backdrop_url` (poster contained over its own blurred copy when absent), an
   episode chip, the progress bar on the art and a `remainingLabel` ("17m
   left") caption, with the same ⋮ actions as before.
8. The Trending rail is the `ranked` layout labelled "Top 10 this week":
   TMDB's weekly trending order (popularity), cut to playable matches, numbered
   1–10 by `rankDashboardCards`. It is not re-ranked by rating. The Top rated
   rail (same `tmdbTrending` toggle, rating ≥ 7.5) excludes the titles already
   in the Top 10 (`excludeDashboardCards`) so no title appears twice.
9. Live favorites are promoted into their own live rail; movie/series
   favorites render in a separate `Favorite movies & series` rail
   (`favoriteMoviesAndSeriesCards`, `data-test-id="dashboard-favorite-vod-rail"`,
   mapped from `globalFavoriteItems()` filtered to movie/series). Full mixed
   favorites management stays on `/workspace/global-favorites`.
10. The live favorites rail keeps its scoped skeleton until the initial global
    favorites load has completed for both Xtream-backed and playlist-backed
    favorites. This avoids first-paint partial counts such as a single Stalker
    favorite appearing before M3U favorites finish resolving.

## Rail Contract

`DashboardRailComponent` is purely presentational:

1. Inputs: `label`, `items: DashboardRailCard[]`, optional `seeAllLink`,
   optional `aspectRatio` (default `'2 / 3'`), optional `layout`, optional
   `testId`.
2. Layouts (`DashboardRailLayout`): `cover` (2:3 poster), `landscape` (16:9
   still with `backdropUrl`/poster fallback, `episodeBadge` chip, progress and
   `remainingLabel`), `ranked` (poster plus the outlined `rank` numeral),
   `channel` (programme-first live card: logo + channel name / time range +
   LIVE chip, the current programme as the headline, progress bar) and
   `recommendation` (the poster card plus an accent reason caption under the
   title and two icon-only taste-feedback buttons).
3. Section headers are quiet: no rule under the title, the count renders as
   plain muted text and "See all" is a text link. The artwork, not the header,
   should draw the eye.
4. Behavior: native horizontal flex track. Continue Watching explicitly disables
   automatic rolling through the rail's `autoRoll` input: resuming a known title
   needs a stable target. Its native scrolling, arrows and keyboard paging remain.
   Other movie/series rows automatically roll
   at a constant 36 px/s in an endless forward loop. Angular renders a second
   pass and the scroll offset wraps by the measured distance between passes,
   preserving fractional overshoot with no visible reset. Repeated cards retain
   working links/actions but are hidden from assistive navigation and Tab order.
   Only overflowing movie/series rows render the second pass; resize and motion
   preference changes restore a single pass when rolling is unavailable.
   `RailAutoRollDirective` pauses on hover, keyboard focus, manual wheel/touch/key
   input (an eight-second grace), hidden/offscreen state and scene transitions.
   Each overflow row exposes Pause/Resume automatic scrolling. Reduced motion
   disables automatic rolling; Full overrides the OS preference. Automatic rows
   disable snapping even while paused, so interaction never snaps the artwork.
   Other rows retain `scroll-snap-type: x mandatory`. Scroll listeners and rolling
   frames run outside Angular; enrichment with unchanged card order preserves offset.
5. Chevron buttons fade in on hover (desktop only via `@media (hover: none)`).
6. Cards are keyboard-focusable router links; `scroll-snap-align: start`
   means arrow-key nav lands on card boundaries.
7. Image handling: `loading="lazy"`, `decoding="async"`, fallback icon tile
   when `imageUrl` is missing or `error` fires. A landscape card whose
   backdrop fails demotes to the contained-poster treatment before the icon.
8. Dashboard hero, rail containers, rail cards, and "Manage all" links expose
   stable `data-test-id` hooks (`<railTestId>-card`, `-card-actions`,
   `-card-remaining`, `-card-rank`, `-card-expiry`, `-manage-all`; hero:
   `dashboard-hero`, `dashboard-hero-cta`, `dashboard-hero-details`,
   `dashboard-hero-up-next`). Treat these as the supported Electron E2E
   selector surface; do not target internal CSS class names.

## Data Flow

1. `WorkspaceDashboardRailsComponent` injects `DashboardDataService`.
2. It derives the dashboard surface via `computed()`:
    1. `hero` — the featured one of the newest five `globalRecentItems()`
       (`heroCandidates` / `selectedHeroKey`, see Page Structure).
    2. `continueWatchingCards` — maps `globalRecentVodItems()` to movie/series
       cover cards. Portal playback positions are bulk-loaded per playlist so
       hero and cards can show progress, remaining time, and series season/
       episode badges. This includes Stalker VOD activity normalized to series
       through `is_series`. Series lookup uses keyed maps for both direct
       episode ids and parent series ids; card renders must not scan the full
       playback-position map. The badge uses saved `seasonNumber` /
       `episodeNumber` metadata and does not infer it from provider payloads;
       legacy rows without that metadata remain badge-less until replay.
       Dashboard-originated Xtream series clicks also carry that exact episode
       target through the global-recent inline-detail handoff. Once the series
       metadata and playback positions load, the detail player consumes the
       target once and resumes the saved episode. Opening the same item normally
       from the global recent grid remains a detail-only action.
    3. `liveFavoriteCardsEnriched` and `recentLiveCardsEnriched` — two
       independent rails (`dashboard-live-favorites-rail` and
       `dashboard-recent-live-rail`); there is no fallback from one to the
       other. M3U cards carry an `epg_lookup_key` using the app-wide XMLTV
       fallback order (`tvg-id` -> `tvg-name` -> channel name); EPG enrichment
       must use that key before falling back to the card title.
    4. `xtreamRecentlyAddedCards` — maps `xtreamRecentlyAddedItems()` to rail
       cards. Aggregates newly added VOD and series across _all_ Xtream
       playlists via `DashboardDataService.reloadXtreamRecentlyAddedItems()`,
       which calls `getGlobalRecentlyAdded('all', limit, 'xtream')` with the
       DB-level `playlists.type = 'xtream'` filter. The rail is Electron-only
       (PWA returns `[]`) and auto-hides when empty, so users without Xtream
       playlists never see it. Cards carry a `playlist_name · type` subtitle
       so users can tell which provider each item came from. Driven by an
       effect that re-runs whenever the Xtream playlist count changes, but the
       first run waits for `globalFavoritesLoaded()` so the slower
       recently-added DB query does not block the live favorites rail on
       startup.
    5. `recommendationCards` / `topTenCards` — the two TMDB rails. Both
       need the TMDB opt-in AND the Electron DB worker that answers
       `DB_MATCH_TITLES` (each is hidden in the PWA), and both load after
       `globalFavoritesLoaded()` so the batched title match never competes
       for the worker at startup. `recommendationCards` is seeded from
       recently watched movies/series and only shows titles present in an
       imported library, hiding itself below five matched cards; its rail
       label names the seed ("Because you watched X") when exactly one
       seed contributed. `topTenCards` shows TMDB's weekly trending as a
       numbered Top 10 of playable matches; `highRatedCards` is the ≥ 7.5
       remainder with the Top 10 titles removed.
       Contracts: `docs/architecture/tmdb-metadata-enrichment.md`
       ("Dashboard Integration").
       Recommendation and personalized genre rails use the shared rail's
       `recommendation` layout: the ordinary poster card with the taste
       explanation as an accent caption under the title (`.rail__reason`)
       and inline `More like this` / `Not for me` feedback as two icon-only
       buttons (`.rail__taste-action`, label kept in the DOM for assistive
       tech and as the native tooltip). The like button exposes its saved
       choice through `aria-pressed` and can undo that choice. Other rails
       retain their existing layouts and action menus. Colors resolve app
       tokens in both themes. The AI picks block renders as one `.ai-panel`:
       the taste-summary card (`dashboard-ai-taste-profile`) carrying the
       Refresh action, or a slim toolbar with Refresh when there is no
       summary, then the AI rail or the `dashboard-ai-status` empty-state
       card; persistence failures render as inline notices with their retry
       buttons. The test ids are the E2E contract and must not change.
       A responsive “Find your next watch” composer sits below the feature
       banner, ahead of the recommendation and activity rails. Desktop users
       with AI disabled get a link to `/workspace/settings/dashboard`; it never
       enables consent implicitly. Draft edits do not trigger inference. Submit
       and localized mood shortcuts compose a bounded, visit-specific request
       with saved preferences, preserving the history-learning opt-in. Clear
       restores ordinary taste-based recommendations. The request uses existing
       ranking IPC and verified-library matching; it is not a general chat.
       Renderer transient ranking bypasses profile/result persistence and prior
       summaries, including retry-save actions. Request generations isolate
       discovery hints and suppress stale ranked cards. Temporary requests do
       not update the durable taste profile; their disclosure names the AI
       gateway. New copy currently uses English fallbacks outside English.
       During a temporary request, broad discoveries feed ranking but do not
       render as a separate endorsed rail. A valid empty ranking still launches
       verified discovery, and an exhausted request shows an honest no-match
       message instead of an AI-unavailable error.
       AI captions containing unsupported upcoming/unreleased claims use the
       existing localized neutral taste label, including captions from cache.
       The dashboard hides dismissed identities immediately; the data-access
       service owns persistence and hybrid-ranking signals. Up to four
       personalized genre rails draw a bounded seed set round-robin from local
       recents, favorites and imported history so no larger source starves the
       others. Rails are resolved strongest-first and do not repeat the same
       catalog row across genres.
    6. `sourceCards` — maps `recentPlaylists()` to rail cards. `recentPlaylists()`
       ranks M3U, Xtream, and Stalker sources by their latest recent activity
       from `globalRecentItems()`, then falls back to playlist
       `updateDate` / `importDate` for sources that have never been used.
3. `DashboardDataService` is passive on construction. The dashboard feature
   owns the initial reloads for recent items, favorites, and Xtream recently
   added rows on page entry.
4. No dashboard-local `Layout` state, no localStorage keys, no migrations.
   Rail visibility and optional AI preferences live in the global settings
   store (`Settings.dashboardRails` / `Settings.aiRecommendations`), not in a
   dashboard-owned layout blob.
5. Navigation state + deep-link targets come from the existing
   `getRecentItemLink()` / `getGlobalFavoriteLink()` / `getPlaylistLink()`
   helpers on `DashboardDataService` and reuse the workspace navigation
   helpers in `@iptvnator/portal/shared/util`.
6. Xtream VOD and series detail pages opportunistically backfill
   `content.backdrop_url` when metadata exposes a backdrop, but that write
   must not refresh recently viewed ordering by itself.
7. The dashboard feature triggers a fresh reload of DB-backed recent/favorite
   rows on dashboard entry so newly backfilled backdrop data is visible as soon
   as the user returns from a detail page.
8. Playback-position reloads are keyed by the VOD/series recent set and should
   call `reloadPlaybackPositions()` through `untracked()` so live-only recent
   changes do not trigger unnecessary IPC round-trips.
9. Electron M3U dashboard favorites should use
   `PlaylistsService.getM3uFavoriteChannels()` first. That method checks the
   SQLite playlist migration flag and then calls
   `dbGetAppPlaylistFavoriteChannels(playlistId)`, letting the DB worker return
   only matched favorite channels instead of sending the full playlist payload
   back to the renderer. If the bridge method is missing or migration is
   incomplete, the dashboard falls back to the full playlist read.
10. Electron playlist summary loads should use
    `dbGetAppPlaylistMetas()` through `PlaylistsService.getAllPlaylists()`.
    This keeps dashboard/source/sidebar startup on a metadata-only SQLite path
    and avoids parsing full M3U `payload` blobs for surfaces that only need
    playlist title, type, counts, favorites, recent activity, and source
    connection fields. Workflows that need channel payloads still call
    `getPlaylistById()`.

## Watching Insights and shared taste

`/workspace/insights` is the workspace's **Your taste** destination. It remains
available when Dashboard is hidden and supports restore-last-view. The shell
classifies it explicitly, without borrowing an active portal's search/sidebar.
`WatchingInsightsComponent` lives beside the dashboard rails in
`workspace-dashboard-feature`; both screens consume dashboard data-access through
its public barrel. No new Nx project or persistence store is introduced.

The artwork-backed hero uses resolved TMDB backdrops/posters or stored source
artwork, with image-error and no-artwork fallbacks in both themes. Movie, series
and channel counts are a bounded snapshot of latest recorded source records, not
lifetime totals, sessions, unique cross-provider titles, episode counts or watch
duration. The combined dashboard input retains its existing 200-record cap and
provider-specific limits. Period filters inspect the latest activity timestamp;
they cannot reconstruct prior viewing. Source copies count separately, repeats
of the same source identity count once, and removed sources disappear immediately.
Imported viewing history contributes separately to taste and is labeled outside
these counters. Live channels never imply programme genres or VOD preferences.
M3U activations recognized by the existing opted-in movie gate now record their
movie category instead of being saved as live channels. Legacy records remain
unchanged until reopened; M3U items retain their normal playlist playback route.

`DashboardTasteProfileService` is the common, opt-in TMDB taste boundary for this
page and `DashboardGenreRecommendationsService`. It resolves up to 16 balanced
signals from active-source history/favorites, imported history, and explicit
positive feedback. Verified `(mediaType, tmdbId)` identities collapse provider
copies/episodes before scoring; genres use namespaced numeric IDs rather than
translated-name identity. All resolved genres are exposed to insights, while the
existing genre recommender discovers from its top four. Genre bars count sampled
titles, not percentages of the entire history; one title may have several genres.

Favorites and explicit positive votes strengthen affinity. Completion bands are
weak evidence, and ordinary playback ticks inside a band do not re-enrich titles.
Public TMDB ratings remain candidate-quality inputs, not personal taste evidence.
Not for me dismisses a title rather than disliking all its genres. The shared key
includes locale, current sources, feedback and the complete available exclusion
identities, including activity outside the 16-signal sample. Late resolutions and
genre discovery cannot restore a stale generation. Removed sources cannot seed
the profile even while retained dashboard snapshots await a reload.

Insight genre selection filters current verified playable candidates; content and
period filters do not rewrite the shared taste profile. The movie/series ring uses
the actual source-record ratio and is neutral when no such records exist. History
read failures expose a retry instead of successful zero totals. Feedback writes
use `RecommendationFeedbackService` and its existing queue/store; the page offers
persisted votes and undo. Candidate routes retain the existing title/year-gated
catalog matches, and removed sources/dismissed titles are filtered before display.

Metadata opt-out hides genre inference and cached personalized picks. PWA can show
its supported local history and metadata insights; verified cross-catalog picks
retain the existing desktop/imported-Xtream requirement. This feature adds no AI
requests, changes no AI consent, and measures no new playback sessions.
Browser history inference skips the optional Electron-only imported-history and
feedback persistence reads; their absence is a capability boundary, not a failed
history read.

## Optional AI Taste Ranking

Desktop Settings → Dashboard exposes AI ranking, model, history learning and
optional explicit taste overrides. AI is disabled by default; the default model
is `security`. New opt-ins offer history learning by default. Already-enabled
settings without a learning flag retain their original explicit-only mode until
the user enables learning, preserving the original sharing consent.
Enabling it ranks verified playable library titles and supplies short reasons.
The first response can suggest up to 12 titles and four movie/TV genre facets.
`DashboardAiDiscoveryService` matches suggested titles locally before enrichment,
discovers at most 100 public TMDB titles per facet, and retains up to 160 verified
playable matches. Watched, favourite, dismissed and removed-source titles are
excluded. Source pools are interleaved before the 40-candidate ranking budget.
The first nonempty discovery plan owns an evidence generation; expanded reranking
cannot recursively launch another discovery plan. AI picks, further discoveries,
watched recommendations and genre rows give each recommendation identity one row.
Existing local/TMDB ranking remains the fallback when the gateway is unavailable.
The web/PWA does not expose the desktop gateway bridge.

`DashboardAiRecommendationsService` owns asynchronous reranking and a bounded
eight-batch persistent cache in `app_state` at `recommendations:ai-results:v1`.
Entries expire after 24 hours and store public ranked identities/reasons, discovery
hints and summaries. Playback matches are reconstructed from the current verified
pool. Keys compare canonical public request metadata and meaningful taste signals;
provider object changes, card ordering and dashboard navigation do not cause scans.
Expiry is checked on the next refresh, without a background polling timer. Explicit
Refresh bypasses the cache. Settings, viewing signals and public candidate changes
invalidate the displayed ranking; late completions cannot restore stale results. Failed batches retain
the normal rails without automatic retries; the user can explicitly retry.

The main-process service calls only
`https://models.saravlabs.org/v1/chat/completions`, using
`User-Agent: SaravLabs-Model-Gateway/1.0`. Authentication is read solely from
`process.env.MODELS_AUTH_TOKEN`; no secret enters settings, the renderer, IPC
responses or debug traces. On Windows, setting the User environment variable
requires a fresh application process launched from an environment that has
inherited it. A running app or terminal does not acquire later environment
changes. Never paste tokens into preferences or save them in repository files.

With learning enabled, one model request builds a taste summary and ranks the
available candidates. It includes at most 50 recently watched movie/series titles
with completion bands, 50 favourite titles, and 100 recommendation votes with
public TMDB identity, optional title and genre ids. Completion is weak evidence;
starting or abandoning a title is not treated as a dislike. Favourites and
explicit votes carry stronger evidence. Written overrides take precedence.
For series, completion describes the latest saved episode, not the entire series.
Only meaningful signal changes invalidate ranking; per-second playback updates
within a completion band do not cause new model requests.

With learning disabled, only entered preferences and public candidate metadata
(TMDB identity, title, year, media type and numeric genre ids) are sent. Source
identities, provider URLs, credentials and exact viewing timestamps are never
serialized in either mode. The learned summary is shown on the dashboard and
kept locally in `app_state` at `recommendations:ai-taste-profile:v1` through the
existing application-state persistence boundary. With learning enabled, the latest
saved summary is context for subsequent inference, including after restart; current
votes and written preferences override it. It never crosses the gateway in
explicit-only mode. This is cumulative inference from saved context, not model
weight training. Prior context does not itself invalidate the result cache.

Only the current main window's main frame may invoke the bridge. Main validates
at most 40 candidates, 2,000 preference characters, 100 model characters and
300 title characters. The request has a 60-second timeout to accommodate
history-backed model inference, blocks redirects and reads at most 128 KiB of
response data. The model is asked to return fewer relevant picks instead of
padding with weak or conflicting matches, and to avoid unsupported claims that
library titles are unreleased. Returned JSON may contain an empty ranking when
no supplied title fits; valid discovery hints still proceed through library
matching and enrichment. Empty results are cached without automatic retries.
Nonempty rankings contain at most 20 unique known ids and reasons of at most
240 characters, plus a taste
summary of at most 1,000 characters when learning is requested; malformed
or invented identities reject the entire response. Provider errors become
allowlisted safe error codes (authentication, rate limit, timeout, network,
unavailable, invalid request/response or oversized response). No raw gateway
response is logged or exposed. No automatic network retry occurs.

## Empty State

The welcome state is rendered via the existing
`EmptyStateComponent` (`type="welcome-dashboard"`) from
`libs/playlist/shared/ui`:

1. Illustration + headline + description from the existing M3U welcome
   strings (`HOME.PLAYLISTS.WELCOME_*`).
2. Primary button emits `addPlaylistClicked`. The dashboard page wires this
   to `WORKSPACE_SHELL_ACTIONS.openAddPlaylistDialog()`.
3. Feature chips (M3U / Xtream / Stalker) are provided by the component.

## UX Rules

1. Rails represent content the user is likely to resume, not provider
   internals. Never surface raw API objects.
2. Each rail must auto-hide when its data source is empty.
3. Image assets must degrade to a typed icon fallback — never show broken
   images or empty tiles.
4. The page must never show "No widgets" style text. If there is no content
   and no playlists, render the welcome state; otherwise render whatever
   rails have data.
5. Navigation from a rail card must deep-link into the appropriate workspace
   route without switching the active playlist in the header switcher.
6. Xtream series hero/Continue Watching clicks with a saved episode position
   must resume that exact episode while preserving the collection-owned detail
   and Back behavior. Do not apply autoplay to ordinary collection-grid clicks.
7. `Recently Used Sources` reflects recent source usage across all provider
   types, not just recent imports.
8. The live rail title key must match the rendered source: favorites use
   `WORKSPACE.DASHBOARD.LIVE_FAVORITES`; the recently-watched-live rail uses
   `WORKSPACE.DASHBOARD.RECENTLY_WATCHED_LIVE_TV`
   (`liveRailTitleKeyForSource` in `rails/dashboard-rail.utils.ts`).

## Adding Or Changing Rails

Current workflow:

1. Add a new `computed()` signal for the card list in
   `WorkspaceDashboardRailsComponent`, mapping your source data to
   `DashboardRailCard`.
2. Drop a `<lib-dashboard-rail>` in the template, gated by
   `@if (cards.length > 0)`.
3. If the data source is new, extend `DashboardDataService` rather than
   reaching into DB services directly from the component.
4. Provide a `seeAllLink` only if there is a dedicated "manage all" route
   for that content type.

## Deferred Work

Intentionally out of scope:

1. Customizable layout (drag/drop, resize, freeform reordering). The rail
   order stays curated and opinionated. (Per-rail show/hide toggles have
   since shipped via `Settings.dashboardRails` — see Summary.)
2. Freeform widget grid with collision management.
3. External data rails such as RSS, sports, or news adapters.
4. Per-user A/B variants of rail ordering.

## Cinematic browsing and horizontal rails

The app-owned cinematic stylesheet expands the feature stage and gives history
its own horizontal deck. Global navigation has a measured sliding marker; poster
artwork follows the cursor with bounded 3D tilt and reflected light. These effects
follow Settings > General > Interface motion. Pointer frames run outside Angular
and touch/coarse pointers retain native scrolling. No player ancestor transforms.

Movie rails expose available left/right buttons at rest, reserve space around
lifted artwork, and retain a thin native scrollbar. Focus the track to page with
ArrowLeft/ArrowRight; card links retain native activation keys. Buttons disable at
the boundary and smooth paging respects the motion preference.
