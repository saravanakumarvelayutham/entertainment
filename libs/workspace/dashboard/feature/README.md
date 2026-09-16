# Workspace Dashboard Feature

This library owns the workspace dashboard rails UI. The dashboard is a
read-only surface over existing playlist, recent, favorites, EPG, and Xtream
catalog data; it should not introduce Electron IPC, SQLite schema, or route
contracts on its own.

## Dashboard Surfaces

The dashboard renders a surface only when the matching setting is enabled. Data
rails also require the underlying data slice to have at least one item.

- `hero` shows the large top banner for the most recent global item. When that
  item is a live TV channel, the hero looks up the current XMLTV programme and
  displays the programme title, time range, and EPG progress bar when data is
  available.
- `continueWatching` shows recent movies and series from
  `DashboardDataService.globalRecentVodItems()` using cover cards with playback
  progress when a saved resume position is available.
- `liveFavorites` shows favorited live TV channels from
  `DashboardDataService.globalFavoriteLiveItems()` using the channel layout
  with EPG title, time range, and progress when XMLTV data is available.
- `recentlyWatchedLive` shows recently watched live TV channels from
  `DashboardDataService.globalRecentLiveItems()` using the same channel layout.
- `favoriteMoviesAndSeries` shows favorited movies and series from
  `DashboardDataService.globalFavoriteItems()`, excluding live favorites, using
  cover cards.
- `recentSources` shows recently used playlist/source entries.
- `xtreamRecentlyAdded` shows recently added Xtream catalog items. Obvious
  CAM/telesync releases are omitted from this broad feed, and entries that
  differ only by a release-quality tag collapse to the strongest labelled
  copy. This is presentation-only; provider rows are never deleted.
- `tmdbRecommendations` shows "Because you watched X" — TMDB
  recommendations seeded from recently watched movies/series, kept to
  titles that exist in an imported Xtream library. Needs the TMDB opt-in
  and the Electron DB worker (hidden in the PWA), and hides itself below
  five matched cards. Data:
  `DashboardRecommendationsService` in `workspace/dashboard/data-access`.
- The `tmdbRecommendations` setting also enables up to four "Your Genre"
  rails. Genre affinity is ranked locally from recent activity, playback
  completion, favorites, imported history and the TMDB rating of each seed.
  Seed selection rotates across recent activity, favorites and imported
  history, so a large source cannot consume the complete bounded seed budget.
  TMDB Discover supplies candidates, then the local hybrid recommender weighs
  taste overlap, source relevance, rating confidence, popularity and freshness
  before applying bounded media/era/interest diversity. Earlier rails claim
  their catalog rows so later rails backfill with different titles. The catalog
  matcher then removes watched, favorited and unavailable titles. Pure ranking lives in
  `@iptvnator/recommendations/util`; orchestration remains in
  `DashboardGenreRecommendationsService`.
- `tmdbTrending` shows TMDB's weekly trending titles, matched against the
  imported Xtream libraries. Unmatched titles stay off the dashboard, and a
  separate High Rated rail projects matched entries rated 7.5 or higher.
  Data: `DashboardTrendingService`.

## Settings

Per-surface visibility lives on `Settings.dashboardRails` as a
`DashboardRailsSettings` object. Every surface defaults to enabled. Stored
settings are deep-merged with `DEFAULT_DASHBOARD_RAILS_SETTINGS` by
`SettingsStore`, so existing users and older partial settings keep newly added
surfaces visible unless they explicitly turn them off.

The global `showDashboard` flag remains a top-level `Settings` property because
workspace startup and route guards already depend on that contract. The Settings
UI groups `showDashboard` and the per-surface checkboxes in the Dashboard
section. When `showDashboard` is off, the per-surface checkboxes are disabled
because the dashboard route itself is hidden.

## Navigation

Rail cards use the navigation state provided by `DashboardDataService` for the
underlying item. Rail "See all" links may also pass router state:

- live rails open the relevant collection on Live TV.
- cover rails for movies/series open Global Recent or Global Favorites on
  Movies when movie items are present, otherwise on Series.

This keeps the global collection pages from defaulting to Live TV when a
dashboard rail is clearly about movies or series.

## External watch history

Settings → Dashboard can import a user-selected Netflix `ViewingActivity.csv`.
The settings row keeps the last successful import count and time visible,
reports cancellation or failure explicitly, and recalculates Your Picks as soon
as a new file is saved. The result names the genres produced, or explains when
TMDB/library matching could not produce a new rail.
SaravTV parses it locally and stores only title/date entries in its local app
database. These are preference seeds for the TMDB-backed **Your Genre Picks**
rails; they never create playback positions or appear in **Continue Watching**.
On startup, every dashboard caller awaits the same persisted-history read. The
rail stays in its loading state while picks are rebuilt, and a failed database
read remains retryable instead of making the saved import look empty for the
rest of the session.
Desktop TMDB settings are restored from an OS-encrypted, SQLite-backed mirror
before recommendation work begins. The dashboard effects also track TMDB
availability, so restoring or enabling metadata retriggers Trending and Your
Picks without another restart.
The importer does not access Netflix accounts, cookies, or a Downloads folder.
