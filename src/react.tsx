import { Fragment, useId, version } from "react";
import type { CSSProperties, ReactNode } from "react";
import { activeStoryStatuses, customerStoryStatuses, isActiveStatus, isDeliveredStatus, storyStatusLabels, storyStatuses, type StoryStatus, type StoryStatusFilter } from "./status.js";
import { releaseEstimatesText } from "./export.js";
import { jobStepGaps, withoutFinalPunctuation } from "./personas.js";
import { storyReadinessLabels, storyReadinessText } from "./readiness.js";
import { storyMapAnchorId, storyMapPermalink } from "./permalink.js";
import { filterStoryMapActions, countStoryMapActions, storyMapActionItemTypes, type StoryMapAction, type StoryMapActionFilter, type StoryMapActionGroup } from "./actions.js";
import type { ReleaseImpact, StoryMapJob } from "./schema.js";
import { analyticsWindow, storyMapAnalytics, type AnalyticsMeasure, type AnalyticsMilestone, type AnalyticsPeriod, type AnalyticsTotals } from "./analytics.js";
import { storyMapAuthor, storyMapCommit, storyMapLicense, storyMapRepositoryUrl, storyMapVersion } from "./version.js";
import { present } from "./present.js";
import type { InternalReleaseLabel, InternalStoryCard, PersonaJobLabel, PersonaLabel, ReleaseEstimates, StoryChangeEntry, StoryDependency, StoryHistoryEntry, StoryMapLabel, StoryMapRecentUpdates, StoryMapView, StoryTestLink } from "./view.js";

/** Windows offered by the “Changed in” filter, in days. Matches `changedWithinOptions`. */
const changedWithinChoices = [[1, "Last day"], [7, "Last 7 days"], [14, "Last 14 days"], [30, "Last 30 days"]] as const;

/**
 * Link templates for repositories that do not use GitHub's URLs, such as
 * `{ commit: "https://gitlab.com/g/p/-/commit/{commit}", pullRequest: "https://gitlab.com/g/p/-/merge_requests/{number}" }`.
 * `{commit}` is the full commit hash and `{number}` the pull request number.
 */
export interface StoryMapRepositoryLinks {
  commit?: string;
  pullRequest?: string;
}

/** A web agent that can open with an agent brief filled in, from the panel's **Share** menu. */
export type StoryMapWebAgent = "claude" | "claude-code" | "chatgpt";

/** What a web agent opens, and whether it can start in the host's repository. */
export interface StoryMapWebAgentInfo {
  name: string;
  /** The company the brief is sent to. */
  company: string;
  /** The address that takes the brief as `q`. */
  url: string;
  /** What the link opens, as the menu names it, such as "chat" or "session". */
  opens: string;
  /** True when the address also takes the repository as `repo=<owner>/<name>`. */
  repository?: boolean;
}

/**
 * The web agents the board can open, with the address that takes the brief as `q`.
 * Claude Code also takes `repo`, which the board fills in from a GitHub `repositoryUrl`.
 */
export const storyMapWebAgents: Readonly<Record<StoryMapWebAgent, StoryMapWebAgentInfo>> = {
  claude: { name: "Claude", company: "Anthropic", url: "https://claude.ai/new", opens: "chat" },
  "claude-code": { name: "Claude Code", company: "Anthropic", url: "https://claude.ai/code", opens: "session", repository: true },
  chatgpt: { name: "ChatGPT", company: "OpenAI", url: "https://chatgpt.com/", opens: "chat" },
};

/**
 * The longest **Open in** link that carries the brief. Past it, the link opens an empty
 * chat and board.js copies the brief first, because long addresses can fail to load.
 */
export const webAgentLinkMaxLength = 8000;

export interface StoryMapBoardProps {
  map: StoryMapView;
  /** Base URL for repository-relative sources, such as `https://github.com/org/repo/blob/main/`. */
  sourceBaseUrl?: string;
  /**
   * The repository's web address, such as `https://github.com/org/repo`. Internal
   * boards then link each history line, and the last update, to its commit at
   * `<repositoryUrl>/commit/<hash>` and its pull request at `<repositoryUrl>/pull/<number>`.
   */
  repositoryUrl?: string;
  /** Templates that replace the `repositoryUrl` links, for GitLab and other hosts. */
  repositoryLinks?: StoryMapRepositoryLinks;
  /**
   * The board page's URL or path, such as `https://example.com/story-map`, for the
   * **Copy link** permalinks in story and release panels. Set it when the board renders
   * behind a proxy or on another path. Without it, permalinks are relative to the page.
   */
  permalinkBase?: string;
  /** `light` by default. `auto` follows the viewer's colour scheme preference. */
  theme?: "light" | "dark" | "auto";
  /** Query parameters to keep when the filter form is submitted, such as a host's own page state. */
  preservedParams?: Readonly<Record<string, string>>;
  /** Locale for dates and relative times. Defaults to `en-GB`. */
  locale?: string;
  /** IANA time zone for dates, such as `Europe/London`. Defaults to the runtime’s zone. */
  timeZone?: string;
  /** Time to measure “3 days ago” from. Defaults to now. */
  now?: Date;
  /**
   * Shows the library version under the board, with links to its changelog and
   * repository on internal boards. On by default.
   */
  showVersion?: boolean;
  /**
   * The host's export route, such as `/story-map/export`. On internal boards the
   * header then links to it with `format=vsdx`, `format=csv` and `format=json`, and board.js adds
   * the lanes the viewer collapsed as `collapsed`. Never shown to customers.
   */
  exportHref?: string;
  /**
   * Web agents to offer in the **Share** menu of internal panels with an agent brief,
   * such as `["claude", "claude-code", "chatgpt"]`. Each opens a new chat or session with
   * the brief filled in, so it sends internal map content to that company. Claude Code
   * starts in the repository from `repositoryUrl` when that is a GitHub address. None by default.
   */
  webAgents?: readonly StoryMapWebAgent[];
  /**
   * Lets internal viewers edit personas, their context and job statements in place
   * on the Personas tab. `story-map preview` sets it, and a host gets it from
   * `createStoryMapEditServer`'s `read`. Each form posts the edit to `endpoint` with the
   * `token` header and the `revision` the page was rendered from. Leave it unset on hosted
   * boards, which stay read-only. Unset on a board opened from `localhost`, board.js notes
   * that editing is not set up; pass `false` when it is off on purpose, to skip the note.
   */
  personaEditing?: StoryMapPersonaEditing | false;
  /**
   * Lets internal viewers save the story panel's **Actions** menu, a new status, reason or
   * release, to the map file, through the same `endpoint`, `token` and `revision` as
   * `personaEditing`. `story-map preview` sets it unless it runs with `--read-only`. Without
   * it the menu only copies the matching `story-map edit` command, and saves nothing.
   */
  storyEditing?: StoryMapPersonaEditing | false;
}

/** Where the Personas tab and the story panels save edits, for `personaEditing` and `storyEditing`. */
export interface StoryMapPersonaEditing {
  /** The route that takes `{ revision, operations }` as JSON, such as `/api/story-map/edit`. */
  endpoint: string;
  /** Sent in the `x-story-map-token` header. */
  token: string;
  /** The hash of the map text the page was rendered from. */
  revision: string;
}

// The schema's limits, repeated here so the board does not load the schema.
const personaTitleMax = 120;
const personaSummaryMax = 500;
const jobPartMax = 200;
const contextLineMax = 200;
const successMax = 400;
const usesTodayMax = 60;
const usesTodayItems = 8;
const constraintsItems = 6;
const personaJobsMax = 8;
const personasMax = 12;

interface DateSettings {
  now: Date;
  /** The board's locale, or the default when the runtime does not recognise it. */
  locale: string;
  date: Intl.DateTimeFormat;
  dateTime: Intl.DateTimeFormat;
  relative: Intl.RelativeTimeFormat;
}

const defaultLocale = "en-GB";
const warned = new Set<string>();

/** Warns once per message, so a host that renders on every request does not fill its logs. */
function warnOnce(message: string) {
  if (warned.has(message)) return;
  warned.add(message);
  console.warn(`auto-story-map: ${message}`);
}

/** Whether `Intl` accepts the options. An unknown locale tag or time zone throws a RangeError. */
function accepted(locale: string, timeZone?: string) {
  try {
    new Intl.DateTimeFormat(locale, { timeZone });
    new Intl.RelativeTimeFormat(locale);
    return true;
  } catch {
    return false;
  }
}

/**
 * Builds the board's date formatters once per render. A locale or time zone
 * that `Intl` rejects falls back to `en-GB` or the runtime's zone, with a
 * warning, instead of failing the whole page.
 */
function dateFormatters(locale: string, timeZone: string | undefined, now: Date): DateSettings {
  if (!accepted(locale)) {
    warnOnce(`Unknown locale ${JSON.stringify(locale)}, so dates use ${defaultLocale}.`);
    locale = defaultLocale;
  }
  if (timeZone !== undefined && !accepted(locale, timeZone)) {
    warnOnce(`Unknown time zone ${JSON.stringify(timeZone)}, so dates use the server's time zone.`);
    timeZone = undefined;
  }
  return {
    now,
    locale,
    date: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone }),
    dateTime: new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone }),
    relative: new Intl.RelativeTimeFormat(locale, { numeric: "auto" }),
  };
}

function formatDate(at: string, settings: DateSettings, withTime = true) {
  return (withTime ? settings.dateTime : settings.date).format(new Date(at));
}

/** “5 hours ago”, “yesterday”, “12 days ago”, then the date after 30 days. */
function formatRelative(at: string, settings: DateSettings) {
  const minutes = Math.floor((settings.now.getTime() - Date.parse(at)) / 60_000);
  const relative = settings.relative;
  if (minutes < 1) return "just now";
  if (minutes < 60) return relative.format(-minutes, "minute");
  if (minutes < 24 * 60) return relative.format(-Math.floor(minutes / 60), "hour");
  const days = Math.floor(minutes / (24 * 60));
  if (days < 30) return relative.format(-days, "day");
  return formatDate(at, settings, false);
}

const shownReleases = 3;

function plural(count: number, one: string, many = `${one}s`) {
  return `${count} ${count === 1 ? one : many}`;
}

/**
 * “Last updated 4 hours ago by Sam. Recent changes focused on 0.6.0 (12 stories) and 0.5.0 (3 stories).”
 * Recent means the `days` up to the latest update, so a quiet map still shows what last moved.
 */
function RecentUpdates({ updates, settings }: { updates: StoryMapRecentUpdates; settings: DateSettings }) {
  const shown = updates.releases.slice(0, shownReleases);
  const others = updates.releases.length - shown.length;
  const parts: ReactNode[] = shown.map(release => (
    <Fragment key={release.id}><strong>{release.title}</strong> ({plural(release.stories, "story", "stories")})</Fragment>
  ));
  if (others > 0) parts.push(plural(others, "other release"));
  return (
    <p className="esm-goal esm-recent">
      Last updated <time dateTime={updates.at} title={formatDate(updates.at, settings)}>{formatRelative(updates.at, settings)}</time>
      {updates.by && ` by ${updates.by}`}.
      {parts.length > 0 && <>
        {" Recent changes focused on "}
        {parts.map((part, index) => (
          <Fragment key={index}>{index > 0 && (index === parts.length - 1 ? " and " : ", ")}{part}</Fragment>
        ))}.
      </>}
    </p>
  );
}

/** Cards are tight on space, so “5h ago” and “12 mins ago”; longer spans read as `formatRelative`. */
function formatCardRelative(at: string, settings: DateSettings) {
  const minutes = Math.floor((settings.now.getTime() - Date.parse(at)) / 60_000);
  if (minutes >= 1 && minutes < 60) return `${minutes} ${minutes === 1 ? "min" : "mins"} ago`;
  if (minutes >= 60 && minutes < 24 * 60) return `${Math.floor(minutes / 60)}h ago`;
  return formatRelative(at, settings);
}

function ChangedAt({ at, settings }: { at: string; settings: DateSettings }) {
  return (
    <time className="esm-changed" dateTime={at} title={formatDate(at, settings)}>
      {formatCardRelative(at, settings)}
    </time>
  );
}

const weekMs = 7 * 24 * 60 * 60 * 1000;

function weeks(count: number) {
  return `${count} ${count === 1 ? "week" : "weeks"}`;
}

/** Whole weeks since `at`, such as 6 for 45 days. */
function weeksSince(at: string, settings: DateSettings) {
  return Math.max(0, Math.floor((settings.now.getTime() - Date.parse(at)) / weekMs));
}

function WarningIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 2.2 14.2 13H1.8L8 2.2Z" />
      <path d="M8 6.5v2.8M8 11.2v.1" />
    </svg>
  );
}

/** Replaces the card’s “3 days ago” on a stalled story. */
function StalledLabel({ since, settings }: { since: string; settings: DateSettings }) {
  return (
    <span className="esm-stalled" title={`In progress since ${formatDate(since, settings)}`}>
      <WarningIcon />
      {`In progress for ${weeks(weeksSince(since, settings))}`}
    </span>
  );
}

interface RepositoryLinker {
  commit(hash: string): string | undefined;
  pullRequest(number: number): string | undefined;
  /** A search of the repository's pull requests, on GitHub only. */
  searchPullRequests(text: string): string | undefined;
}

/** Keeps a link only when it is an http(s) URL. */
function webLink(href: string) {
  try {
    const url = new URL(href);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : undefined;
  } catch {
    return undefined;
  }
}

/**
 * The `owner/name` of a GitHub `repositoryUrl`, such as `org/repo` for
 * `https://github.com/org/repo`, for Claude Code's `repo` parameter. Undefined for
 * other hosts and addresses that do not name a repository.
 */
function githubRepository(repositoryUrl?: string): string | undefined {
  const link = repositoryUrl && webLink(repositoryUrl);
  if (!link) return undefined;
  const url = new URL(link);
  if (url.hostname !== "github.com" && url.hostname !== "www.github.com") return undefined;
  const [owner, name] = url.pathname.split("/").filter(Boolean);
  const repo = name?.replace(/\.git$/, "");
  const part = /^[A-Za-z0-9._-]+$/;
  return owner && repo && part.test(owner) && part.test(repo) ? `${owner}/${repo}` : undefined;
}

/**
 * Builds commit and pull request links from `repositoryLinks` templates, or
 * else from `repositoryUrl`. Each link is dropped unless it is http(s).
 */
function repositoryLinker(repositoryUrl?: string, templates?: StoryMapRepositoryLinks): RepositoryLinker {
  const base = repositoryUrl && webLink(repositoryUrl)?.replace(/[?#].*$/, "").replace(/\/+$/, "");
  const build = (template: string | undefined, path: string, placeholder: RegExp, value: string) => {
    if (template) return webLink(template.replace(placeholder, encodeURIComponent(value)));
    return base ? webLink(`${base}/${path}/${encodeURIComponent(value)}`) : undefined;
  };
  return {
    commit: hash => build(templates?.commit, "commit", /\{commit\}/g, hash),
    pullRequest: number => build(templates?.pullRequest, "pull", /\{number\}/g, String(number)),
    searchPullRequests: text => base && !templates?.pullRequest && new URL(base).hostname === "github.com"
      ? webLink(`${base}/pulls?q=${encodeURIComponent(`is:pr ${text}`)}`)
      : undefined,
  };
}

const shortHash = (hash: string) => hash.slice(0, 7);

/** The pull request and commit behind a history line, as links. Nothing without a repository URL. */
function ChangeLinks({ entry, links }: { entry: { commit: string; pullRequest?: number }; links: RepositoryLinker }) {
  const pullRequest = entry.pullRequest ? links.pullRequest(entry.pullRequest) : undefined;
  const commit = links.commit(entry.commit);
  return (
    <>
      {pullRequest && <>
        {" · "}
        <a className="esm-history-link" href={pullRequest} {...newTab}>
          <span className="esm-visually-hidden">Pull request </span>#{entry.pullRequest}<NewTabHint />
        </a>
      </>}
      {commit && <>
        {" · "}
        <a className="esm-history-link" href={commit} title={entry.commit} {...newTab}>
          <span className="esm-visually-hidden">Commit </span><code className="esm-commit-hash">{shortHash(entry.commit)}</code><NewTabHint />
        </a>
      </>}
    </>
  );
}

function HistoryList({ entries, settings, labelledBy, links }: { entries: StoryHistoryEntry[]; settings: DateSettings; labelledBy: string; links: RepositoryLinker }) {
  return (
    <ol className="esm-history" aria-labelledby={labelledBy}>
      {entries.map((entry, index) => {
        const people = [
          entry.by && `by ${entry.by}`,
          entry.mergedBy && entry.mergedBy !== entry.by && `merged by ${entry.mergedBy}`,
        ].filter(Boolean).join(", ");
        return (
          <li key={index}>
            <span className="esm-history-change">
              {entry.type === "added" ? "Added as " : ""}
              <Status status={entry.to} />
            </span>
            <span className="esm-history-meta">
              <time dateTime={entry.at}>{formatDate(entry.at, settings)}</time>
              {people && ` · ${people}`}
              <ChangeLinks entry={entry} links={links} />
            </span>
            {entry.reason && <span className="esm-history-reason">{entry.reason}</span>}
          </li>
        );
      })}
    </ol>
  );
}

// React 19 knows the popover attributes by their camelCase names. React 18 passes
// them through only when they are spelled in lowercase.
const reactMajor = Number(version.split(".")[0]);
function popoverTarget(id: string, action?: "hide"): Record<string, string> {
  const [target, targetAction] = reactMajor >= 19
    ? ["popoverTarget", "popoverTargetAction"]
    : ["popovertarget", "popovertargetaction"];
  return action ? { [target]: id, [targetAction]: action } : { [target]: id };
}

interface SourceLink {
  label: string;
  href?: string;
  overview: boolean;
}

function resolveSources(sources: readonly string[] | undefined, sourceBaseUrl?: string): SourceLink[] {
  let overviewFound = false;
  return (sources ?? []).map(label => {
    if (/\s/.test(label)) return { label, overview: false };
    let url: URL;
    try {
      url = new URL(label, sourceBaseUrl);
    } catch {
      return { label, overview: false };
    }
    if (url.protocol !== "https:" && url.protocol !== "http:") return { label, overview: false };
    const overview = !overviewFound && url.pathname.toLowerCase().endsWith(".md") && !!url.hash;
    overviewFound ||= overview;
    return { label, href: url.href, overview };
  });
}

// Engineering links open in a new tab so the board stays where the reader left it.
const newTab = { target: "_blank", rel: "noopener noreferrer" } as const;

function NewTabHint() {
  return (
    <>
      <svg className="esm-icon esm-external" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="M9.5 2.5h4v4M13.5 2.5 7 9M11.5 9.5v3a1 1 0 0 1-1 1h-7a1 1 0 0 1-1-1v-7a1 1 0 0 1 1-1h3" />
      </svg>
      <span className="esm-visually-hidden"> (opens in a new tab)</span>
    </>
  );
}

/**
 * Links `<file>#L<line>` under `sourceBaseUrl`, the form GitHub, GitLab and
 * Bitbucket use for one line. Returns undefined without a base, or when the
 * link would not be an http(s) URL under it.
 */
function testHref(file: string, line: number, sourceBaseUrl?: string) {
  if (!sourceBaseUrl) return undefined;
  try {
    const base = new URL(sourceBaseUrl);
    const url = new URL(`${file.split("/").map(encodeURIComponent).join("/")}#L${line}`, base);
    if ((url.protocol !== "https:" && url.protocol !== "http:") || !url.href.startsWith(base.href.replace(/[?#].*$/, ""))) return undefined;
    return url.href;
  } catch {
    return undefined;
  }
}

/**
 * Drops a leading tag for the story followed by a separator, such as “ESM-702: ”
 * or “ESM-702 — ”, since the panel already shows the ID. A name that only starts
 * with the ID, such as “ESM-702 and ESM-703 …”, is left as written.
 */
function testName(name: string, storyId: string) {
  if (!name.startsWith(storyId)) return name;
  const separator = /^(?:\s*[:–—]|\s+-(?=\s))\s*/.exec(name.slice(storyId.length));
  return separator && name.length > storyId.length + separator[0].length ? name.slice(storyId.length + separator[0].length) : name;
}

function GroupIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4.5h11M2.5 8h11M2.5 11.5h11" />
    </svg>
  );
}

function FlaskIcon() {
  return (
    <svg className="esm-icon" width="13" height="13" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6 2.5h4M6.6 2.5v4.2L3.2 12.4a1 1 0 0 0 .9 1.6h7.8a1 1 0 0 0 .9-1.6L9.4 6.7V2.5" />
      <path d="M4.8 10.2h6.4" />
    </svg>
  );
}

/** Tagged tests for a story, including any the index counted but did not list. */
function testCount(story: InternalStoryCard) {
  return (story.tests?.length ?? 0) + (story.moreTests ?? []).reduce((sum, entry) => sum + entry.count, 0);
}

/** “· 7” with a flask between a card’s status and its last change, read as “7 tests”. Nothing when the story has none. */
function CardTests({ story }: { story: InternalStoryCard }) {
  const count = testCount(story);
  if (!count) return null;
  const label = `${count} ${count === 1 ? "test" : "tests"}`;
  return (
    <span className="esm-card-tests" title={label}>
      <FlaskIcon />
      <span aria-hidden="true">{count}</span>
      <span className="esm-visually-hidden">{label}</span>
    </span>
  );
}

function DependencyIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="4" cy="4" r="1.9" /><circle cx="12" cy="12" r="1.9" /><path d="M4 5.9v2.6A3.5 3.5 0 0 0 7.5 12h2.6" />
    </svg>
  );
}

/**
 * How many stories this one depends on, beside its status, read as “Depends on 2 stories: ESM-105, ESM-116”.
 * Nothing when it has none. Cards pass `outstanding` to count only the dependencies not yet merged or
 * shipped, so a card whose dependencies are all delivered shows no count. The panel counts them all.
 */
function DependencyCount({ story, outstanding = false }: { story: InternalStoryCard; outstanding?: boolean }) {
  const dependencies = (story.dependsOn ?? []).filter(dependency => !outstanding || !isDeliveredStatus(dependency.status));
  const count = dependencies.length;
  if (!count) return null;
  const delivered = count < (story.dependsOn?.length ?? 0) ? " not yet merged or shipped" : "";
  const label = `Depends on ${storyCount(count)}${delivered}: ${dependencies.map(dependency => dependency.id).join(", ")}`;
  return (
    <span className="esm-dependency-count" title={label}>
      <DependencyIcon />
      <span aria-hidden="true">{count}</span>
      <span className="esm-visually-hidden">{label}</span>
    </span>
  );
}

/**
 * True when the story records a dependency or another story depends on it. Its panel shows its
 * readiness only then, so a map that does not use `dependsOn` gets no “Ready to start” on every story.
 */
const hasDependencies = (story: InternalStoryCard) => !!story.dependsOn?.length || !!story.dependents?.length;

/** “Ready to start”, “Waiting” or “At risk” beside a story's status on its panel. */
function ReadinessLabel({ readiness }: { readiness: NonNullable<InternalStoryCard["readiness"]> }) {
  return <span className="esm-readiness" data-readiness={readiness.state}>{storyReadinessLabels[readiness.state]}</span>;
}

/**
 * The stories a story depends on and the stories waiting for it, after the story's readiness. A story on the board
 * opens its panel. One a filter hides is still listed, as text.
 */
function DependenciesSection({ story, panelId, storyPanelIds, releaseTitles }: {
  story: InternalStoryCard;
  panelId: string;
  storyPanelIds: ReadonlyMap<string, string>;
  releaseTitles: ReadonlyMap<string, string>;
}) {
  const headingId = `${panelId}-dependencies`;
  const list = (dependencies: StoryDependency[], suffix: string, title: string) => (
    <>
      <h5 className="esm-dependencies-heading" id={`${headingId}-${suffix}`}>{title}</h5>
      <ul className="esm-dependencies" aria-labelledby={`${headingId}-${suffix}`}>
        {dependencies.map(dependency => {
          const target = storyPanelIds.get(dependency.id);
          const name = <><span className="esm-card-id">{dependency.id}</span><span className="esm-dependency-title">{dependency.title}</span></>;
          return (
            <li key={dependency.id}>
              {target
                ? <button type="button" className="esm-dependency-link" aria-haspopup="dialog" {...popoverTarget(target)}>{name}</button>
                : <span className="esm-dependency-link">{name}</span>}
              <span className="esm-dependency-meta">
                <Status status={dependency.status} />
                <span className="esm-dependency-release">{releaseTitles.get(dependency.release) ?? dependency.release}</span>
              </span>
            </li>
          );
        })}
      </ul>
    </>
  );
  return (
    <section className="esm-detail-section" aria-labelledby={headingId}>
      <h4 id={headingId}>Dependencies</h4>
      {story.readiness && (
        <p className="esm-readiness-note" data-readiness={story.readiness.state}>
          {storyReadinessText(story.readiness, id => releaseTitles.get(id) ?? id)}
          {" "}<span className="esm-readiness-caveat">Only recorded dependencies are checked.</span>
        </p>
      )}
      {!!story.dependsOn?.length && list(story.dependsOn, "on", "Depends on")}
      {!!story.dependents?.length && list(story.dependents, "waiting", "Waiting for this story")}
    </section>
  );
}

function PullRequestIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="4" cy="3.5" r="1.5" /><circle cx="4" cy="12.5" r="1.5" /><circle cx="12" cy="12.5" r="1.5" />
      <path d="M4 5v6M12 11V6.5a2 2 0 0 0-2-2H7.5M9 3 7.5 4.5 9 6" />
    </svg>
  );
}

function CommitIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
      <circle cx="8" cy="8" r="2.5" /><path d="M1.5 8h4M10.5 8h4" />
    </svg>
  );
}

const commits = (count: number) => `${count} ${count === 1 ? "commit" : "commits"}`;

/** Pull requests and direct commits that name the story, newest first. Titles are untrusted and rendered as text. */
function ChangesSection({ story, panelId, settings, links }: { story: InternalStoryCard; panelId: string; settings: DateSettings; links: RepositoryLinker }) {
  const headingId = `${panelId}-changes`;
  const changes = story.changes ?? [];
  const more = story.moreChanges ?? 0;
  const search = more > 0 ? links.searchPullRequests(story.id) : undefined;
  return (
    <section className="esm-detail-section esm-changes" aria-labelledby={headingId}>
      <h4 id={headingId}>Changes</h4>
      {changes.length === 0 && more === 0 ? (
        <p className="esm-changes-empty">
          No pull requests or commits name {story.id} yet. Put the ID in a branch name, pull request title or commit message, such as <code>{`feat/${story.id.toLowerCase()}-…`}</code>.
        </p>
      ) : (
        <ul className="esm-change-list" aria-labelledby={headingId}>
          {changes.map(change => <ChangeItem key={change.commit} change={change} settings={settings} links={links} />)}
        </ul>
      )}
      {more > 0 && (
        <p className="esm-changes-more">
          {search ? <a href={search} {...newTab}>+{more} more<NewTabHint /></a> : `+${more} more`}
        </p>
      )}
    </section>
  );
}

function ChangeItem({ change, settings, links }: { change: StoryChangeEntry; settings: DateSettings; links: RepositoryLinker }) {
  const pullRequest = change.pullRequest;
  const href = (pullRequest !== undefined ? links.pullRequest(pullRequest) : undefined) ?? links.commit(change.commit);
  const label = pullRequest !== undefined ? `#${change.pullRequest}` : shortHash(change.commit);
  const title = <>
    {pullRequest ? <span className="esm-change-number">{label}</span> : <code className="esm-commit-hash">{label}</code>}
    {" "}
    <span className="esm-change-title">{change.title ?? (pullRequest ? "Pull request" : "Commit")}</span>
  </>;
  const date = <time dateTime={change.at}>{formatDate(change.at, settings)}</time>;
  const meta = pullRequest
    ? <>
      merged {date}{change.mergedBy && ` by ${change.mergedBy}`}
      {change.by && change.by !== change.mergedBy && ` · by ${change.by}`}
      {change.commitCount !== undefined && ` · ${commits(change.commitCount)}`}
    </>
    : <>
      {date}{change.by && ` · by ${change.by}`}
      {change.commitCount !== undefined && ` · ${commits(change.commitCount)}`}
    </>;
  return (
    <li className="esm-change" data-kind={pullRequest ? "pull-request" : "commit"}>
      {pullRequest ? <PullRequestIcon /> : <CommitIcon />}
      <span className="esm-change-body">
        {href
          ? <a className="esm-change-link" href={href} {...newTab}><span className="esm-visually-hidden">{pullRequest ? "Pull request " : "Commit "}</span>{title}<NewTabHint /></a>
          : <span><span className="esm-visually-hidden">{pullRequest ? "Pull request " : "Commit "}</span>{title}</span>}
        <span className="esm-change-meta">{meta}</span>
      </span>
    </li>
  );
}

function TestsSection({ story, panelId, sourceBaseUrl }: { story: InternalStoryCard; panelId: string; sourceBaseUrl?: string }) {
  const headingId = `${panelId}-tests`;
  const files = new Map<string, { tests: StoryTestLink[]; more: number }>();
  const fileEntry = (file: string) => {
    let entry = files.get(file);
    if (!entry) {
      entry = { tests: [], more: 0 };
      files.set(file, entry);
    }
    return entry;
  };
  for (const test of story.tests ?? []) fileEntry(test.file).tests.push(test);
  for (const { file, count } of story.moreTests ?? []) fileEntry(file).more += count;

  return (
    <section className="esm-detail-section esm-tests" aria-labelledby={headingId}>
      <h4 id={headingId}>Tests</h4>
      {files.size === 0 ? (
        <p className="esm-tests-empty">
          No tests are tagged {story.id} yet. Put the ID at the start of a test’s name, such as <code>{`test("${story.id}: …")`}</code>.
        </p>
      ) : [...files].map(([file, { tests, more }]) => (
        <div className="esm-tests-file" key={file}>
          <p className="esm-tests-path"><code>{file}</code></p>
          {tests.length > 0 && (
            <ul aria-label={`Tests in ${file}`}>
              {tests.map(test => {
                const href = testHref(test.file, test.line, sourceBaseUrl);
                const name = testName(test.name, story.id);
                const label = <>
                  {test.kind === "group" && <GroupIcon />}
                  <span className="esm-test-name">{name}</span>
                </>;
                return (
                  <li className="esm-test" key={`${test.line}:${test.name}`} data-kind={test.kind}>
                    {href ? <a href={href} {...newTab}>{label}<NewTabHint /></a> : <span>{label}</span>}
                    <span className="esm-test-line">
                      {test.kind === "group" && !test.inherited ? "All tests in this group · " : ""}
                      {test.inherited ? "Covered by its group · " : ""}line {test.line}
                    </span>
                  </li>
                );
              })}
            </ul>
          )}
          {more > 0 && <p className="esm-tests-more">+{more} more in this file</p>}
        </div>
      ))}
    </section>
  );
}

function StatusIcon({ status }: { status: StoryStatus }) {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === "planned"
        ? <circle cx="8" cy="8" r="6.2" strokeDasharray="2.4 2.2" />
        : <circle cx="8" cy="8" r="6.2" />}
      {status === "in-progress" && <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />}
      {status === "merged" && <path d="M8 8V4.2A3.8 3.8 0 1 1 4.2 8Z" fill="currentColor" stroke="none" />}
      {status === "shipped" && <path d="m5.3 8.2 1.8 1.8 3.6-3.7" />}
      {status === "blocked" && <path d="M5 8h6" />}
      {status === "cut" && <path d="M3.6 12.4 12.4 3.6" />}
    </svg>
  );
}

function Status({ status }: { status: StoryStatus }) {
  return (
    <span className="esm-status" data-status={status}>
      <StatusIcon status={status} />
      {storyStatusLabels[status]}
    </span>
  );
}

/** Most avatars a card or activity shows before “+N”. */
const maxAvatars = 3;

/** Joins names as “A”, “A and B” or “A, B and C”. */
function listNames(names: readonly string[]) {
  return names.length < 2 ? names.join("") : `${names.slice(0, -1).join(", ")} and ${names.at(-1)}`;
}

function PersonaAvatar({ persona }: { persona: PersonaLabel }) {
  return <span className="esm-avatar" data-persona={persona.colour} aria-hidden="true">{persona.initials}</span>;
}

/**
 * Up to three avatars, then “+N”. Screen readers hear the persona titles, such
 * as “For Product manager and Coding agent”, instead of the initials. With
 * `panelIds`, each avatar is a button that opens its persona's panel.
 */
function PersonaAvatars({ personas, panelIds }: { personas: readonly PersonaLabel[]; panelIds?: ReadonlyMap<string, string> }) {
  if (!personas.length) return null;
  const label = `For ${listNames(personas.map(persona => persona.title))}`;
  const shown = personas.slice(0, maxAvatars);
  const more = personas.length - shown.length;
  return (
    <span className="esm-avatars" title={label}>
      {shown.map(persona => {
        const panelId = panelIds?.get(persona.id);
        if (!panelId) return <PersonaAvatar persona={persona} key={persona.id} />;
        return (
          <button type="button" className="esm-avatar-button" aria-haspopup="dialog" aria-label={`${persona.title}: open persona`} key={persona.id} {...popoverTarget(panelId)}>
            <PersonaAvatar persona={persona} />
          </button>
        );
      })}
      {more > 0 && <span className="esm-avatar esm-avatar-more" aria-hidden="true">{`+${more}`}</span>}
      <span className="esm-visually-hidden">{label}</span>
    </span>
  );
}

/**
 * A job statement with its lead words in bold: “When …, I want …, so that ….”
 * With `breaks`, “I want” and “so that” each start a new line, spaced a little apart, as in the story panel.
 */
function JobStatement({ job, breaks = false }: { job: StoryMapJob; breaks?: boolean }) {
  const outcome = <><b>so that</b> {withoutFinalPunctuation(job.outcome)}.</>;
  if (breaks) return <><span className="esm-job-line"><b>When</b> {job.situation},</span><span className="esm-job-line"><b>I want</b> {job.motivation},</span>{outcome}</>;
  return <><b>When</b> {job.situation}, <b>I want</b> {job.motivation}, {outcome}</>;
}

/** Marks a persona's core job, the first in their list. */
function CoreJobLabel() {
  return <span className="esm-core-label">Core job</span>;
}

/**
 * Looks up the view's personas and jobs by ID. Empty for a view without personas.
 * Customer views have no avatars or jobs, so their personas go in `customer`.
 */
function personaLookup(view: StoryMapView) {
  const personas = new Map<string, PersonaLabel>();
  const jobs = new Map<string, { job: PersonaJobLabel; persona: PersonaLabel }>();
  const customer = new Map<string, StoryMapLabel>();
  if (view.audience === "internal") {
    for (const persona of view.personas ?? []) {
      personas.set(persona.id, persona);
      for (const job of persona.jobs) if (!jobs.has(job.id)) jobs.set(job.id, { job, persona });
    }
  } else {
    for (const persona of view.personas ?? []) customer.set(persona.id, persona);
  }
  return { personas, jobs, customer };
}
type PersonaLookup = ReturnType<typeof personaLookup>;

const labelsFor = (ids: readonly string[] | undefined, lookup: PersonaLookup) =>
  (ids ?? []).flatMap(id => lookup.personas.get(id) ?? []);

/** What a panel needs to list its item's actions. */
interface PanelActionsInfo {
  groups: readonly StoryMapActionGroup[];
  links: ActionLinks;
  /** The Actions tab narrowed to the item. Absent when the board has no tabs. */
  tabHref?: string;
}

function StoryDetail({ story, panelId, permalink, activityTitle, releaseTitle, internal, sourceBaseUrl, links, settings, stalledAfterWeeks, testsIndexed, changesIndexed, lookup, personaPanelIds, storyPanelIds, releaseTitles, webAgents, repository, editing, actions }: {
  story: InternalStoryCard;
  /** Where the **Actions** menu saves, when the board can save. */
  editing?: StoryMapPersonaEditing;
  actions?: PanelActionsInfo;
  webAgents?: readonly StoryMapWebAgent[];
  repository?: string;
  /** Each placed story's panel, by story ID, so the Dependencies section can open it. */
  storyPanelIds: ReadonlyMap<string, string>;
  releaseTitles: ReadonlyMap<string, string>;
  links: RepositoryLinker;
  permalink?: string;
  lookup: PersonaLookup;
  /** Each persona's panel, by persona ID, so the For row can open it. */
  personaPanelIds: ReadonlyMap<string, string>;
  panelId: string;
  activityTitle: string;
  releaseTitle: string;
  internal: boolean;
  sourceBaseUrl?: string;
  settings: DateSettings;
  stalledAfterWeeks?: number;
  /** True when the view has a tests index, so the empty state can show. */
  testsIndexed?: boolean;
  changesIndexed?: boolean;
}) {
  const titleId = `${panelId}-title`;
  const sources = internal ? resolveSources(story.sources, sourceBaseUrl) : [];
  const overview = sources.find(source => source.overview);
  const references = sources.filter(source => source !== overview);
  const hasEngineering = internal && !!(overview || story.notes || references.length);
  const personas = internal ? labelsFor(story.personas, lookup) : [];
  // Customers see the approved titles only, with no avatars.
  const customerPersonas = internal ? [] : (story.personas ?? []).flatMap(id => lookup.customer.get(id) ?? []);
  const jobs = internal ? (story.jobs ?? []).flatMap(id => lookup.jobs.get(id) ?? []) : [];

  return (
    <div className="esm-detail" id={panelId} popover="auto" role="dialog" aria-labelledby={titleId}>
      <div className="esm-detail-head">
        <div>
          {internal && <p className="esm-card-id">{story.id}</p>}
          <h3 id={titleId}>{story.title}</h3>
        </div>
        <div className="esm-detail-actions">
          {internal && <ChangeMenu story={story} panelId={panelId} releaseTitles={releaseTitles} editing={editing} />}
          <PanelActions
            href={permalink}
            label="this story"
            brief={internal ? story.brief : undefined}
            briefId={`${panelId}-brief`}
            copied={`Copied brief: ${story.id}`}
            webAgents={webAgents}
            repository={repository}
          />
          <CloseButton panelId={panelId} />
        </div>
      </div>
      <Status status={story.status} />
      {internal && <DependencyCount story={story} />}
      {internal && story.readiness && hasDependencies(story) && <ReadinessLabel readiness={story.readiness} />}
      {internal && story.statusReason && <p className="esm-status-reason">{story.statusReason}</p>}
      {internal && story.inProgressSince && (
        <p className="esm-progress-since">
          In progress since <time dateTime={story.inProgressSince}>{formatDate(story.inProgressSince, settings, false)}</time>
        </p>
      )}
      {internal && story.stalled && story.inProgressSince && (
        <p className="esm-stalled-note">
          <WarningIcon />
          <span>
            {`Stalled: in progress for ${weeks(weeksSince(story.inProgressSince, settings))}.`}
            {stalledAfterWeeks ? ` Stories are flagged after ${weeks(stalledAfterWeeks)}.` : ""}
          </span>
        </p>
      )}
      {story.summary && <DetailSummary text={story.summary} />}
      <dl className="esm-detail-context">
        {personas.length > 0 && <>
          <dt>For</dt>
          <dd className="esm-persona-row">
            {personas.map(persona => {
              const personaPanelId = personaPanelIds.get(persona.id);
              return personaPanelId
                ? (
                  <button type="button" className="esm-persona-chip" aria-haspopup="dialog" key={persona.id} {...popoverTarget(personaPanelId)}>
                    <PersonaAvatar persona={persona} />{persona.title}
                  </button>
                )
                : <span className="esm-persona-chip" key={persona.id}><PersonaAvatar persona={persona} />{persona.title}</span>;
            })}
          </dd>
        </>}
        {customerPersonas.length > 0 && <>
          <dt>For</dt>
          <dd>{listNames(customerPersonas.map(persona => persona.title))}</dd>
        </>}
        {jobs.length > 0 && <>
          <dt>Jobs</dt>
          <dd>
            <ul className="esm-story-jobs">
              {jobs.map(({ job, persona }) => (
                <li key={job.id}>
                  <JobStatement job={job} breaks /> <span className="esm-story-job-persona">· {persona.title}</span>{job.core && <> <CoreJobLabel /></>}
                  {job.draft && <> <DraftLabel /></>}
                </li>
              ))}
            </ul>
          </dd>
        </>}
        <dt>Activity</dt>
        <dd>{activityTitle}</dd>
        <dt>Release</dt>
        <dd>{releaseTitle}</dd>
        {internal && story.priority !== undefined && <><dt>Priority</dt><dd><Priority priority={story.priority} /> {priorityLabels[story.priority]}</dd></>}
        {internal && story.estimate !== undefined && <><dt>Estimate</dt><dd>{points(story.estimate)}</dd></>}
        {internal && story.tokens !== undefined && <><dt>Tokens used</dt><dd>{story.tokens.toLocaleString("en-US")}</dd></>}
        {internal && story.estimatedCostUsd !== undefined && <><dt>Estimated cost</dt><dd>{`$${story.estimatedCostUsd.toFixed(2)}`}</dd></>}
      </dl>
      {internal && actions && <ItemActions groups={actions.groups} type="story" id={story.id} panelId={panelId} links={actions.links} tabHref={actions.tabHref} />}
      {internal && hasDependencies(story) && (
        <DependenciesSection story={story} panelId={panelId} storyPanelIds={storyPanelIds} releaseTitles={releaseTitles} />
      )}
      {internal && !!story.history?.length && (
        <section className="esm-detail-section">
          <h4 id={`${panelId}-history`}>History</h4>
          <HistoryList entries={story.history} settings={settings} labelledBy={`${panelId}-history`} links={links} />
        </section>
      )}
      {internal && (changesIndexed || !!story.changes?.length || !!story.moreChanges) && (
        <ChangesSection story={story} panelId={panelId} settings={settings} links={links} />
      )}
      {internal && (testsIndexed || !!story.tests?.length || !!story.moreTests?.length) && (
        <TestsSection story={story} panelId={panelId} sourceBaseUrl={sourceBaseUrl} />
      )}
      {hasEngineering && (
        <section className="esm-detail-section" aria-labelledby={`${panelId}-engineering`}>
          <h4 id={`${panelId}-engineering`}>Engineering</h4>
          {overview && (
            <a className="esm-overview-link" href={overview.href} aria-label={`Engineering overview for ${story.title} (opens in a new tab)`} {...newTab}>
              Engineering overview<NewTabHint />
            </a>
          )}
          {story.notes && <p className="esm-notes">{story.notes}</p>}
          {references.length > 0 && (
            <ul className="esm-sources" aria-label="Sources">
              {references.map((source, index) => (
                <li key={index}>
                  {source.href
                    ? <a href={source.href} {...newTab}><code>{source.label}</code><NewTabHint /></a>
                    : <code>{source.label}</code>}
                </li>
              ))}
            </ul>
          )}
        </section>
      )}
      {internal && story.brief && (
        <AgentBrief brief={story.brief} panelId={panelId} />
      )}
      {internal && (story.lastEdit
        ? (
          <p className="esm-updater">
            Last updated <LastEditTime edit={story.lastEdit} settings={settings} links={links} />
            {story.lastEdit.by && ` by ${story.lastEdit.by}`}
          </p>
        )
        : story.updatedBy && <p className="esm-updater">Last updated by {story.updatedBy}</p>)}
    </div>
  );
}

/** The last edit's time, linked to its pull request, or its commit when there is none, when the board has a repository URL. */
function LastEditTime({ edit, settings, links }: { edit: { at: string; commit: string; pullRequest?: number }; settings: DateSettings; links: RepositoryLinker }) {
  const time = <time dateTime={edit.at} title={formatDate(edit.at, settings)}>{formatRelative(edit.at, settings)}</time>;
  const pullRequest = edit.pullRequest ? links.pullRequest(edit.pullRequest) : undefined;
  const href = pullRequest ?? links.commit(edit.commit);
  if (!href) return time;
  const label = pullRequest ? `Pull request ${edit.pullRequest}` : `Commit ${shortHash(edit.commit)}`;
  return <a className="esm-history-link" href={href} {...newTab}>{time}<span className="esm-visually-hidden">, {label}</span><NewTabHint /></a>;
}

function storyCount(count: number) {
  return `${count} ${count === 1 ? "story" : "stories"}`;
}

const points = (count: number, short = false) =>
  `${count} ${short ? (count === 1 ? "pt" : "pts") : (count === 1 ? "point" : "points")}`;

function Estimate({ estimate }: { estimate: number }) {
  return (
    <span className="esm-estimate" title={`Estimate: ${points(estimate)}`}>
      <span aria-hidden="true">{points(estimate, true)}</span>
      <span className="esm-visually-hidden">{`Estimate: ${points(estimate)}`}</span>
    </span>
  );
}

const priorityLabels = { must: "Must have", should: "Should have", could: "Could have" } as const;
const priorityTags = { must: "MH", should: "SH", could: "CH" } as const;

/** A MoSCoW tag, such as “MH”, with its full name for screen readers. */
function Priority({ priority }: { priority: keyof typeof priorityLabels }) {
  return (
    <span className={`esm-priority esm-priority-${priority}`} title={`Priority: ${priorityLabels[priority]}`}>
      <span aria-hidden="true">{priorityTags[priority]}</span>
      <span className="esm-visually-hidden">{`Priority: ${priorityLabels[priority]}`}</span>
    </span>
  );
}

/** The card's ID, with its persona avatars, priority and estimate to the right when it has them. */
function CardHead({ story, personas }: { story: InternalStoryCard; personas: readonly PersonaLabel[] }) {
  const id = <span className="esm-card-id">{story.id}</span>;
  if (!personas.length && story.estimate === undefined && story.priority === undefined) return id;
  const priority = story.priority !== undefined && <Priority priority={story.priority} />;
  const estimate = story.estimate !== undefined && <Estimate estimate={story.estimate} />;
  return (
    <span className="esm-card-head">
      {id}
      {personas.length || (priority && estimate)
        ? <span className="esm-card-tags">{personas.length > 0 && <PersonaAvatars personas={personas} />}{priority}{estimate}</span>
        : priority || estimate}
    </span>
  );
}

/** A release lane’s points and what is left, such as “21 pts · 5 merged · 8 left · 2 unestimated”. */
function ReleaseEstimate({ estimates }: { estimates: ReleaseEstimates }) {
  const { total, merged, left, unestimated } = estimates;
  const label = `Estimate: ${points(total)}${merged ? `, ${merged} merged` : ""}, ${left} left to do${unestimated ? `, ${storyCount(unestimated)} with no estimate` : ""}`;
  return (
    <span className="esm-release-estimate">
      <span aria-hidden="true">{releaseEstimatesText(estimates)}</span>
      <span className="esm-visually-hidden">{label}</span>
    </span>
  );
}

function releaseEstimateNote({ total, merged, left, unestimated }: ReleaseEstimates) {
  const waiting = merged ? `, ${merged} merged and waiting to ship` : "";
  const missing = unestimated ? ` ${storyCount(unestimated)} ${unestimated === 1 ? "has" : "have"} no estimate.` : "";
  return `${points(total)}${waiting}, ${left} left to do.${missing}`;
}

function LinkIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M6.8 9.2a2.8 2.8 0 0 0 4 0l2-2a2.8 2.8 0 0 0-4-4l-.7.7M9.2 6.8a2.8 2.8 0 0 0-4 0l-2 2a2.8 2.8 0 0 0 4 4l.7-.7" />
    </svg>
  );
}

/**
 * A permalink to the panel's story or release. Without board.js it is a plain link
 * to copy or open; board.js copies it instead and says “Link copied”.
 */
function CopyLink({ href, label }: { href?: string; label: string }) {
  if (!href) return null;
  return (
    <a className="esm-copy-link" href={href} data-esm-copy-link="" title={`Link to ${label}`}>
      <LinkIcon /><span data-esm-copy-label="">Copy link</span><span className="esm-visually-hidden"> to {label}</span>
    </a>
  );
}

/**
 * The panel's actions, top right. A panel with an agent brief gets a **Share** menu with
 * **Copy link**, **Copy brief** and an **Open in** link for each of `webAgents`. Any other
 * panel keeps the plain **Copy link**, rather than a menu with one item.
 *
 * The menu is a `<details>`, so it opens without JavaScript. **Copy brief** needs the
 * clipboard, so it stays hidden until board.js shows it. An **Open in** link carries the
 * brief in its address. When that would be longer than `webAgentLinkMaxLength`, the link
 * opens an empty chat instead and stays hidden until board.js can copy the brief first.
 * `copied` is what board.js says once it has copied the brief, such as “Copied brief: ESM-111”.
 */
function PanelActions({ href, label, brief, briefId, copied, webAgents = [], repository }: {
  href?: string;
  label: string;
  brief?: string;
  briefId: string;
  copied: string;
  webAgents?: readonly StoryMapWebAgent[];
  repository?: string;
}) {
  if (!brief) return <CopyLink href={href} label={label} />;
  const agents = [...new Set(webAgents)].filter(id => Object.hasOwn(storyMapWebAgents, id));
  const query = encodeURIComponent(brief);
  return (
    <details className="esm-menu esm-panel-menu">
      <summary className="esm-copy-link esm-menu-button">
        <ShareIcon /><span data-esm-copy-label="">Share</span><span className="esm-visually-hidden"> {label}</span>
        <svg className="esm-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3 5 4 4 4-4" />
        </svg>
      </summary>
      <ul className="esm-menu-panel">
        {href && (
          <li>
            <a className="esm-menu-item" href={href} data-esm-copy-link="">
              <LinkIcon /><span className="esm-menu-item-text"><span>Copy link<span className="esm-visually-hidden"> to {label}</span></span></span>
            </a>
          </li>
        )}
        <li>
          <button type="button" className="esm-menu-item" data-esm-copy-brief={briefId} data-esm-copied={copied} hidden>
            <BriefIcon />
            <span className="esm-menu-item-text"><span>Copy brief</span><span className="esm-menu-item-hint">A prompt for a coding agent</span></span>
          </button>
        </li>
        {agents.map(id => {
          const agent = storyMapWebAgents[id];
          const repo = agent.repository ? repository : undefined;
          const start = repo ? `${agent.url}?repo=${encodeURIComponent(repo)}` : agent.url;
          const full = `${start}${repo ? "&" : "?"}q=${query}`;
          const long = full.length > webAgentLinkMaxLength;
          return (
            <li key={id} className="esm-menu-agent" hidden={long || undefined}>
              <a
                className="esm-menu-item"
                href={long ? start : full}
                target="_blank"
                rel="noopener noreferrer"
                data-esm-web-agent={id}
                {...(long ? { "data-esm-brief-copy": briefId } : {})}
              >
                {agent.repository ? <CodeIcon /> : <ChatIcon />}
                <span className="esm-menu-item-text">
                  <span>Open in {agent.name}<NewTabHint /></span>
                  <span className="esm-menu-item-hint">
                    {long
                      ? `Copies the brief, then opens a new ${agent.opens}${repo ? ` in ${repo}` : ""}`
                      : `New ${agent.opens}${repo ? ` in ${repo}` : ""} with the brief, sent to ${agent.company}`}
                  </span>
                </span>
              </a>
            </li>
          );
        })}
      </ul>
    </details>
  );
}

function ShareIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M8 10V2.5M5 5.2 8 2.3l3 2.9M3.5 8.5v4a1 1 0 0 0 1 1h7a1 1 0 0 0 1-1v-4" />
    </svg>
  );
}

function BriefIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5 2h6v2H5zM4 3h-.5a1 1 0 0 0-1 1v9a1 1 0 0 0 1 1h9a1 1 0 0 0 1-1V4a1 1 0 0 0-1-1H12M5.5 7.5h5M5.5 10h3.5" />
    </svg>
  );
}

function CodeIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M5.5 4.5 2 8l3.5 3.5M10.5 4.5 14 8l-3.5 3.5M9 3 7 13" />
    </svg>
  );
}

function ChatIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M2.5 4A1.5 1.5 0 0 1 4 2.5h8A1.5 1.5 0 0 1 13.5 4v5.5A1.5 1.5 0 0 1 12 11H7l-3 2.5V11a1.5 1.5 0 0 1-1.5-1.5z" />
    </svg>
  );
}

/**
 * The panel's agent brief from `getStoryMapForViewer({ brief })`: a closed `<details>` with
 * the brief in a `<pre>`, to read before sending it anywhere and to copy by hand. The panel's
 * **Share** menu copies it, or opens it in a web agent.
 */
/**
 * The internal story panel's **Actions** menu, beside **Share**: status, reason and release
 * pickers to change the story. **Copy command** copies the matching `story-map edit`
 * command, to paste into a terminal or an agent's chat, without showing it. Copying changes
 * nothing. With `editing`, as on the local preview, **Save** writes the change to the map
 * file instead. The pickers need board.js to build the command and to save, so the menu
 * stays hidden until board.js shows it, and **Copy command** stays hidden without clipboard
 * access. The reason field is for blocked and cut only.
 */
function ChangeMenu({ story, panelId, releaseTitles, editing }: { story: InternalStoryCard; panelId: string; releaseTitles: ReadonlyMap<string, string>; editing?: StoryMapPersonaEditing }) {
  const errorId = `${panelId}-change-error`;
  const needsReason = story.status === "blocked" || story.status === "cut";
  return (
    <details className="esm-menu esm-panel-menu esm-change-menu" hidden>
      <summary className="esm-copy-link esm-menu-button">
        <EditIcon /><span data-esm-copy-label="">Actions</span><span className="esm-visually-hidden"> for this story</span>
        <svg className="esm-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3 5 4 4 4-4" />
        </svg>
      </summary>
      <div className="esm-menu-panel esm-change-panel">
        <form
          className="esm-change-form"
          aria-label={`Change ${story.id}`}
          data-esm-change={story.id}
          data-esm-status={story.status}
          data-esm-release={story.release}
          data-esm-reason={story.statusReason ?? ""}
          {...(editing ? { "data-esm-edit-endpoint": editing.endpoint, "data-esm-edit-token": editing.token, "data-esm-edit-revision": editing.revision } : {})}
        >
          <label className="esm-change-field">
            <span>Status</span>
            <select className="esm-select" name="status" defaultValue={story.status}>
              {storyStatuses.map(status => <option value={status} key={status}>{storyStatusLabels[status]}</option>)}
            </select>
          </label>
          <label className="esm-change-field esm-change-reason" data-esm-change-reason="" hidden={!needsReason || undefined}>
            <span>Reason</span>
            <input className="esm-change-input" name="reason" defaultValue={story.statusReason ?? ""} placeholder="Why it is blocked or cut" autoComplete="off" />
          </label>
          <label className="esm-change-field">
            <span>Release</span>
            <select className="esm-select" name="release" defaultValue={story.release}>
              {[...releaseTitles].map(([id, title]) => <option value={id} key={id}>{title}</option>)}
            </select>
          </label>
          {editing && <p className="esm-form-error esm-change-error" id={errorId} role="alert" hidden></p>}
          <div className="esm-change-actions">
            {editing && <button type="submit" className="esm-save esm-change-save" data-esm-change-save="" aria-describedby={errorId} disabled>Save</button>}
            <button type="button" className="esm-change-copy" data-esm-change-copy="" disabled hidden>
              <BriefIcon /><span>Copy command</span>
            </button>
          </div>
          {!editing && <p className="esm-change-note">This board does not save. Paste the command into a terminal or an agent's chat.</p>}
        </form>
      </div>
    </details>
  );
}

function EditIcon() {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d="M10.5 2.5a1.4 1.4 0 0 1 2 2L5 12l-2.5.5L3 10z" />
    </svg>
  );
}

function AgentBrief({ brief, panelId }: { brief: string; panelId: string }) {
  const briefId = `${panelId}-brief`;
  return (
    <section className="esm-detail-section esm-brief" aria-labelledby={`${panelId}-brief-heading`}>
      <h4 id={`${panelId}-brief-heading`}>Agent brief</h4>
      <p className="esm-brief-intro">A prompt to start a coding agent on this work, with the plan, scope and the repository's rules. Copy it from <b>Share</b> at the top of this panel.</p>
      <details className="esm-brief-details">
        <summary>Show the brief</summary>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the brief scrolls, so keyboard users need to focus it to scroll it. */}
        <pre className="esm-brief-text" id={briefId} tabIndex={0}>{brief}</pre>
      </details>
    </section>
  );
}

/** “0.7.5” from “0.7.5: Evidence and claims for agents”, or the whole title when it has no version. */
function releaseShortName(title: string) {
  return /^\s*(v?\d+(?:\.\d+)*)\s*:/i.exec(title)?.[1] ?? title;
}

function CloseButton({ panelId }: { panelId: string }) {
  return (
    // biome-ignore lint/a11y/noAutofocus: opening a panel moves focus into it, as a dialog does, so Escape and Tab work from there.
    <button type="button" className="esm-close" aria-label="Close" autoFocus {...popoverTarget(panelId, "hide")}>
      <svg className="esm-icon" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
        <path d="m4 4 8 8M12 4l-8 8" />
      </svg>
    </button>
  );
}

function DraftLabel() {
  return <span className="esm-draft" title="Drafted by an agent and not yet confirmed">Draft</span>;
}

/** The first impact item, in one line under the release title. */
function ImpactLine({ impact }: { impact: ReleaseImpact[] }) {
  const [first] = impact;
  return (
    <span className="esm-release-impact">
      <span className="esm-impact-text">{`${first.metric}: ${first.expected}`}</span>
      {first.draft && <DraftLabel />}
      {impact.length > 1 && <span className="esm-impact-more">{`+${impact.length - 1} more`}</span>}
    </span>
  );
}

/** “3 of 5 stories shipped, 1 merged, 1 cut.” Cut stories have left the release, so they are not in the total. */
function releaseProgress(counts: Record<StoryStatus, number>) {
  const total = Object.values(counts).reduce((sum, count) => sum + count, 0);
  if (total === 0) return "No stories yet.";
  const kept = total - counts.cut;
  if (kept === 0) return `${storyCount(total)}, all cut.`;
  const parts = [
    `${counts.shipped} of ${storyCount(kept)} shipped`,
    counts.merged && `${counts.merged} merged`,
    counts.blocked && `${counts.blocked} blocked`,
    counts.cut && `${counts.cut} cut`,
  ];
  return `${parts.filter(Boolean).join(", ")}.`;
}

/**
 * A panel's summary. Each line of a summary written over several lines, as
 * Write a story summary asks, is its own block with a little space above it,
 * and a one-line summary is plain text as before.
 */
function DetailSummary({ text }: { text: string }) {
  const lines = text.split("\n").map(line => line.trim()).filter(Boolean);
  if (lines.length < 2) return <p className="esm-detail-summary">{text}</p>;
  return <p className="esm-detail-summary">{lines.map((line, index) => <span className="esm-detail-summary-line" key={index}>{line}</span>)}</p>;
}

function paragraphs(text: string) {
  return text.split(/\n[ \t]*\n/).map(paragraph => paragraph.trim()).filter(Boolean);
}

function ReleaseDetail({ release, panelId, permalink, stories, storyPanelIds, filtered, webAgents, repository, actions }: {
  release: InternalReleaseLabel;
  actions?: PanelActionsInfo;
  webAgents?: readonly StoryMapWebAgent[];
  repository?: string;
  panelId: string;
  permalink?: string;
  /** The release’s stories that are on the board. */
  stories: InternalStoryCard[];
  storyPanelIds: Map<InternalStoryCard, string>;
  filtered: boolean;
}) {
  const titleId = `${panelId}-title`;
  const total = Object.values(release.storyCounts).reduce((sum, count) => sum + count, 0);
  const hidden = total - stories.length;
  const groups = storyStatuses.flatMap(status => {
    const matching = stories.filter(story => story.status === status);
    return matching.length ? [{ status, stories: matching }] : [];
  });

  return (
    <div className="esm-detail esm-release-detail" id={panelId} popover="auto" role="dialog" aria-labelledby={titleId}>
      <div className="esm-detail-head">
        <div>
          <p className="esm-card-id">Release</p>
          <h3 id={titleId}>{release.title}</h3>
        </div>
        <div className="esm-detail-actions">
          <PanelActions
            href={permalink}
            label="this release"
            brief={release.brief}
            briefId={`${panelId}-brief`}
            copied={`Copied brief: ${releaseShortName(release.title)}, ${plural(release.storyCounts.planned + release.storyCounts["in-progress"], "story", "stories")}`}
            webAgents={webAgents}
            repository={repository}
          />
          <CloseButton panelId={panelId} />
        </div>
      </div>
      {release.summary && <DetailSummary text={release.summary} />}
      {actions && <ItemActions groups={actions.groups} type="release" id={release.id} panelId={panelId} links={actions.links} tabHref={actions.tabHref} />}
      {release.notes && (
        <section className="esm-detail-section" aria-labelledby={`${panelId}-notes`}>
          <h4 id={`${panelId}-notes`}>Release notes</h4>
          {paragraphs(release.notes).map((paragraph, index) => <p className="esm-notes" key={index}>{paragraph}</p>)}
        </section>
      )}
      {!!release.impact?.length && (
        <section className="esm-detail-section" aria-labelledby={`${panelId}-impact`}>
          <h4 id={`${panelId}-impact`}>Expected impact</h4>
          <ul className="esm-impact">
            {release.impact.map((item, index) => (
              <li key={index}>
                <p className="esm-impact-metric">{item.metric}{item.draft && <DraftLabel />}</p>
                <dl className="esm-detail-context">
                  <dt>Expected</dt>
                  <dd>{item.expected}</dd>
                  {item.actual && <><dt>Actual</dt><dd>{item.actual}</dd></>}
                  {item.solves && <><dt>Solves</dt><dd>{item.solves}</dd></>}
                </dl>
              </li>
            ))}
          </ul>
        </section>
      )}
      <section className="esm-detail-section" aria-labelledby={`${panelId}-stories`}>
        <h4 id={`${panelId}-stories`}>Stories</h4>
        <p className="esm-release-progress">{releaseProgress(release.storyCounts)}</p>
        {release.estimates && <p className="esm-release-estimate-note">{releaseEstimateNote(release.estimates)}</p>}
        {groups.map(group => (
          <div className="esm-release-group" key={group.status}>
            <h5><Status status={group.status} /></h5>
            <ul className="esm-release-stories">
              {group.stories.map(story => (
                <li key={story.id}>
                  <button type="button" className="esm-release-story" aria-haspopup="dialog" {...popoverTarget(present(storyPanelIds.get(story), `the panel of story ${story.id}`))}>
                    <span className="esm-card-id">{story.id}</span>
                    <span>{story.title}</span>
                  </button>
                </li>
              ))}
            </ul>
          </div>
        ))}
        {filtered && hidden > 0 && <p className="esm-release-hidden">{`${hidden} more hidden by the current filters.`}</p>}
      </section>
      {release.brief && (
        <AgentBrief brief={release.brief} panelId={panelId} />
      )}
    </div>
  );
}

/** Active statuses in the order a job's bar draws them, done first. */
const coverageStatuses = ["shipped", "merged", "in-progress", "planned"] as const satisfies readonly StoryStatus[];

/**
 * “4 stories: 3 shipped, 1 in progress”, or “3 stories shipped” when they share a status.
 * Counts active stories only: blocked and cut ones are noted apart. Null when there are none.
 */
function jobCoverage(counts: Record<StoryStatus, number>) {
  const parts = coverageStatuses.filter(status => counts[status] > 0);
  if (!parts.length) return null;
  const total = parts.reduce((sum, status) => sum + counts[status], 0);
  const label = (status: StoryStatus) => storyStatusLabels[status].toLowerCase();
  return parts.length === 1
    ? `${storyCount(total)} ${label(parts[0])}`
    : `${storyCount(total)}: ${parts.map(status => `${counts[status]} ${label(status)}`).join(", ")}`;
}

/** The job's active stories as a bar, one segment per status. The text beside it says the same, so it is hidden from screen readers. */
function CoverageBar({ counts }: { counts: Record<StoryStatus, number> }) {
  const total = coverageStatuses.reduce((sum, status) => sum + counts[status], 0);
  return (
    <span className="esm-bar" aria-hidden="true">
      {coverageStatuses.filter(status => counts[status] > 0).map(status => (
        <span key={status} data-status={status} style={{ width: `${(counts[status] / total) * 100}%` }} />
      ))}
    </span>
  );
}

/** One job in the persona panel: its statement, its stories by status and, with filters, a link to them. The core job is labelled and set apart. */
function PersonaJob({ job, statementId, base }: { job: PersonaJobLabel; statementId: string; base?: URLSearchParams }) {
  const coverage = jobCoverage(job.storyCounts);
  const left = hiddenSummary(job.storyCounts);
  // Only the core job's gaps show here; the Personas tab shows every step.
  const gaps = job.core && coverage ? jobStepGaps(job) : 0;
  const stepCount = job.steps?.length ?? 0;
  return (
    <li className={job.core ? "esm-job esm-job-core" : "esm-job"}>
      {job.core && <CoreJobLabel />}
      <p className="esm-job-statement" id={statementId}>
        <JobStatement job={job} />
        {job.draft && <> <DraftLabel /></>}
      </p>
      <p className="esm-job-meta">
        {coverage
          ? <>
            <CoverageBar counts={job.storyCounts} />
            <span>{coverage}</span>
            {base && <a href={withIds(base, "job", [job.id])} aria-describedby={statementId}>Show stories</a>}
          </>
          : <span className="esm-job-gap">No stories yet</span>}
        {left && <span className="esm-job-left">{`${left} not counted`}</span>}
        {gaps > 0 && <span className="esm-job-gap">{`${gaps} of ${stepCount} ${stepCount === 1 ? "step" : "steps"} ${gaps === 1 ? "has" : "have"} no stories`}</span>}
      </p>
    </li>
  );
}

/**
 * A persona's summary and jobs to be done, each with its stories by status
 * and, when the host reads filters, a link to them. Counts come from the whole
 * map, so they do not change with the filters. A popover, so it works without JavaScript.
 * With `openHref`, the Personas tab holds the full persona, so the panel is a quick
 * look: the core job, how many other jobs there are and an **Open persona** link.
 */
function PersonaDetail({ persona, panelId, filter, preservedParams, openHref }: {
  persona: PersonaLabel;
  panelId: string;
  /** The view's filters. Without them, the panel has no filter links. */
  filter?: StoryMapView["filter"];
  preservedParams?: Readonly<Record<string, string>>;
  /** The persona's page on the Personas tab. */
  openHref?: string;
}) {
  const titleId = `${panelId}-title`;
  const base = filter && filterParams(filter, preservedParams);
  const [core, ...others] = persona.jobs;
  return (
    <div className="esm-detail esm-persona-detail" id={panelId} popover="auto" role="dialog" aria-labelledby={titleId}>
      <div className="esm-detail-head">
        <div className="esm-persona-head">
          <span className="esm-avatar esm-avatar-lg" data-persona={persona.colour} aria-hidden="true">{persona.initials}</span>
          <div>
            <p className="esm-card-id">Persona</p>
            <h3 id={titleId}>{persona.title}</h3>
          </div>
        </div>
        <CloseButton panelId={panelId} />
      </div>
      {persona.summary && <DetailSummary text={persona.summary} />}
      {openHref
        ? <>
          {core
            ? <ul className="esm-jobs" aria-label="Core job"><PersonaJob job={core} statementId={`${panelId}-job-0`} base={base} /></ul>
            : <p className="esm-release-hidden">No jobs to be done yet.</p>}
          <p className="esm-popover-foot">
            <span>{others.length ? `${plural(others.length, "other job")}` : core ? "No other jobs" : ""}</span>
            <a className="esm-open-persona" href={openHref}>Open persona<span aria-hidden="true"> →</span></a>
          </p>
        </>
        : (
          <section className="esm-detail-section" aria-labelledby={`${panelId}-jobs`}>
            <h4 id={`${panelId}-jobs`}>Jobs to be done</h4>
            {core
              ? <>
                <ul className="esm-jobs">
                  <PersonaJob job={core} statementId={`${panelId}-job-0`} base={base} />
                </ul>
                {others.length > 0 && <>
                  <h5 className="esm-jobs-subhead" id={`${panelId}-other-jobs`}>Other jobs</h5>
                  <ul className="esm-jobs" aria-labelledby={`${panelId}-other-jobs`}>
                    {others.map((job, index) => <PersonaJob key={job.id} job={job} statementId={`${panelId}-job-${index + 1}`} base={base} />)}
                  </ul>
                </>}
              </>
              : <p className="esm-release-hidden">No jobs to be done yet.</p>}
            {base && <p className="esm-release-hidden"><a href={withIds(base, "persona", [persona.id])}>Show only this persona’s stories</a></p>}
          </section>
        )}
    </div>
  );
}

/** How many of a persona's steps, across all their jobs, have an activity but no stories. */
function personaGaps(persona: PersonaLabel) {
  return persona.jobs.reduce((sum, job) => sum + jobStepGaps(job), 0);
}

/** A job statement with each part on its own line on the Personas tab: When, I want, so that. */
function EditButton({ label, form, text = "Edit" }: { label: string; form: string; text?: string }) {
  // Hidden until board.js runs, because the form needs it to save.
  return <button type="button" className="esm-edit-button" data-esm-edit-open={form} aria-label={label} aria-expanded="false" aria-controls={form} hidden>{text}</button>;
}

/**
 * Text that becomes editable where it is when its Edit button is pressed, so it keeps
 * its look and shows all its text as it grows. board.js makes it editable and saves it.
 */
function InlineText({ as: Tag = "span", editor, field, label, max, required, multiline, placeholder, className, id, children }: {
  as?: "span" | "p" | "h3";
  editor: string;
  field: string;
  label: string;
  max: number;
  required?: boolean;
  /** Enter adds a line, and Ctrl or Cmd with Enter saves. */
  multiline?: boolean;
  placeholder?: string;
  className?: string;
  id?: string;
  children?: ReactNode;
}) {
  return (
    <Tag className={className} id={id} data-esm-editor={editor} data-esm-edit-field={field} data-esm-label={label} data-esm-max={max} data-esm-required={required ? "" : undefined} data-esm-multiline={multiline ? "" : undefined} data-esm-placeholder={placeholder}>
      {children}
    </Tag>
  );
}

/** Save and Cancel under text being edited in place, with its character count and any error. */
function InlineBar({ id, op, target, label, hint, remove }: {
  id: string;
  op: "set-persona" | "set-persona-context" | "set-job";
  target: { persona: string } | { job: string };
  label: string;
  hint: ReactNode;
  /** A Delete button before Cancel, which board.js confirms before it posts `delete-job`. */
  remove?: { label: string; what: string; consequence: string };
}) {
  return (
    <div className="esm-inline-bar" id={id} role="group" aria-label={label} data-esm-edit={op} data-esm-inline="" data-esm-persona={"persona" in target ? target.persona : undefined} data-esm-job={"job" in target ? target.job : undefined} hidden>
      <p className="esm-form-error" role="alert" hidden />
      <div className="esm-form-foot">
        {remove && <button type="button" className="esm-delete" data-esm-delete={remove.what} data-esm-delete-consequence={remove.consequence}>{remove.label}</button>}
        <span className="esm-form-hint">{hint}<span className="esm-field-count" data-esm-live-count="" /></span>
        <button type="button" className="esm-cancel" data-esm-edit-cancel="">Cancel</button>
        <button type="button" className="esm-save" data-esm-edit-save="">Save</button>
      </div>
    </div>
  );
}

/**
 * One input per entry, with Add and remove, for a context list such as Uses today.
 * Add copies a row already there rather than a `<template>`, because React puts a
 * template's children in the DOM, not its content, when a host renders it in the browser.
 */
function ListField({ label, name, values, max, items }: { label: string; name: string; values?: readonly string[]; max: number; items: number }) {
  const row = (value: string, key: number) => (
    <div className="esm-field-row" key={key}>
      <input name={name} maxLength={max} defaultValue={value} aria-label={label} />
      <button type="button" className="esm-remove" data-esm-remove-row="" aria-label="Remove">✕</button>
    </div>
  );
  return (
    <fieldset className="esm-field esm-list-field" data-esm-list={name} data-esm-max-items={items}>
      <legend className="esm-visually-hidden">{label}</legend>
      <p className="esm-field-count">{`Up to ${items}, ${max} characters each`}</p>
      {(values?.length ? values : [""]).map(row)}
      <button type="button" className="esm-add-row" data-esm-add-row="">+ Add</button>
    </fieldset>
  );
}

/**
 * A form that replaces the text it edits, hidden until its Edit button opens it.
 * board.js posts its fields as one persona edit operation and reloads the tab.
 */
function EditForm({ id, op, target, label, hint, children }: {
  id: string;
  op: "set-persona" | "set-persona-context" | "set-job" | "create-job" | "create-persona";
  /** The persona or job it changes. A new persona has none. */
  target?: { persona: string } | { job: string };
  label: string;
  hint: ReactNode;
  children: ReactNode;
}) {
  return (
    <form className="esm-inline-form" id={id} data-esm-edit={op} data-esm-persona={target && "persona" in target ? target.persona : undefined} data-esm-job={target && "job" in target ? target.job : undefined} aria-label={label} hidden>
      {children}
      <p className="esm-form-error" role="alert" hidden />
      <div className="esm-form-foot">
        <span className="esm-form-hint">{hint}</span>
        <button type="button" className="esm-cancel" data-esm-edit-cancel="">Cancel</button>
        <button type="submit" className="esm-save">Save</button>
      </div>
    </form>
  );
}

function draftHint(draft: boolean | undefined) {
  return draft ? <>Stays a draft until a person confirms it.</> : null;
}

function JobStatementLines({ job, id, editor }: { job: StoryMapJob; id: string; editor?: string }) {
  if (editor) {
    const part = (field: "situation" | "motivation" | "outcome", label: string, text: string) => (
      <InlineText editor={editor} field={field} label={label} max={jobPartMax} required>{text}</InlineText>
    );
    return (
      <p className="esm-job-statement esm-job-lines" id={id}>
        <b>When</b> <span>{part("situation", "When", job.situation)},</span> <b>I want</b> <span>{part("motivation", "I want", job.motivation)},</span> <b>so that</b> <span>{part("outcome", "so that", withoutFinalPunctuation(job.outcome))}.</span>
      </p>
    );
  }
  return (
    <p className="esm-job-statement esm-job-lines" id={id}>
      <b>When</b> <span>{job.situation},</span> <b>I want</b> <span>{job.motivation},</span> <b>so that</b> <span>{withoutFinalPunctuation(job.outcome)}.</span>
    </p>
  );
}

/**
 * One job on the Personas tab: its statement across the lane, its stories, and
 * its steps below in order, each with its stories. A checkbox collapses the lane
 * to one line, like a release lane: CSS does it with :has(), so it needs no JavaScript,
 * and browsers without :has() keep every lane open. board.js remembers it.
 */
function JobLane({ job, laneId, base, editing }: { job: PersonaJobLabel; laneId: string; base?: URLSearchParams; editing?: boolean }) {
  const statementId = `${laneId}-statement`;
  const formId = `${laneId}-edit`;
  const coverage = jobCoverage(job.storyCounts);
  const left = hiddenSummary(job.storyCounts);
  const steps = job.steps ?? [];
  return (
    <li className="esm-job-lane" data-core={job.core ? "" : undefined} aria-labelledby={statementId}>
      <div className="esm-job-cell">
        <label className="esm-job-collapse">
          <input type="checkbox" className="esm-job-collapse-input" value={job.id} aria-label={job.core ? "Collapse the core job" : "Collapse this job"} aria-describedby={statementId} />
          <svg className="esm-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
            <path d="m4 6 4 4 4-4" />
          </svg>
        </label>
        {(job.core || job.draft || editing) && (
          <p className="esm-job-labels">
            {job.core && <CoreJobLabel />}
            {job.draft && <DraftLabel />}
            {editing && <EditButton label={job.core ? "Edit the core job" : "Edit this job"} form={formId} />}
          </p>
        )}
        <JobStatementLines job={job} id={statementId} editor={editing ? formId : undefined} />
        {editing && <InlineBar id={formId} op="set-job" target={{ job: job.id }} label={`Edit job ${job.id}`} hint={draftHint(job.draft)} remove={{ label: "Delete job", what: job.core ? "the core job" : "this job", consequence: deleteJobConsequence(job) }} />}
        <p className="esm-job-meta">
          {coverage
            ? <>
              <CoverageBar counts={job.storyCounts} />
              {base ? <a href={withIds(base, "job", [job.id])} aria-describedby={statementId}>{coverage}</a> : <span>{coverage}</span>}
            </>
            : <span className="esm-job-gap">No stories yet</span>}
          {left && <span className="esm-job-left">{`${left} not counted`}</span>}
          {steps.length > 0 && <span className="esm-job-step-count">{plural(steps.length, "step")}</span>}
        </p>
      </div>
      {steps.length > 0 && (
        <ol className="esm-job-steps" aria-label="Steps">
          {steps.map((step, index) => {
            const { activity, activeStories } = step;
            const gap = activity !== undefined && !activeStories;
            const stepParams = base && activity !== undefined ? new URLSearchParams([...base, ["job", job.id], ["activity", activity]]) : undefined;
            return (
              <li className="esm-step-card" data-gap={gap ? "" : undefined} key={index}>
                <span className="esm-step-title"><span className="esm-step-num" aria-hidden="true">{index + 1}</span>{step.title}</span>
                {step.summary && <span className="esm-step-text">{step.summary}</span>}
                {activity !== undefined && (
                  <span className="esm-step-cov">
                    {!activeStories
                      ? <span className="esm-job-gap">No stories yet</span>
                      : stepParams
                        ? <a href={`?${stepParams}`}>{storyCount(activeStories)}</a>
                        : <span>{storyCount(activeStories)}</span>}
                  </span>
                )}
              </li>
            );
          })}
        </ol>
      )}
    </li>
  );
}

/** What deleting a job also changes, for the confirmation: its steps, the stories that lose its tag and the next core job. */
function deleteJobConsequence(job: PersonaJobLabel) {
  const stories = Object.values(job.storyCounts).reduce((sum, count) => sum + count, 0);
  const steps = job.steps?.length ?? 0;
  return [
    steps ? `Its ${plural(steps, "step")} ${steps === 1 ? "goes" : "go"} with it.` : "",
    stories ? `${plural(stories, "story", "stories")} that ${stories === 1 ? "serves" : "serve"} it ${stories === 1 ? "loses" : "lose"} the tag, and ${stories === 1 ? "stays" : "stay"} on the map.` : "No stories serve it.",
    job.core ? "The next job becomes the core job." : "",
  ].filter(Boolean).join(" ");
}

/** A form for a new job, with each part of its statement. It goes after the other jobs, so the core job stays the same. */
function AddJob({ persona, formId }: { persona: PersonaLabel; formId: string }) {
  const part = (name: "situation" | "motivation" | "outcome", label: string, placeholder: string) => (
    <label className="esm-field">
      <span className="esm-field-label">{label}<span className="esm-field-count">{`Up to ${jobPartMax} characters`}</span></span>
      <textarea name={name} rows={2} maxLength={jobPartMax} required placeholder={placeholder} />
    </label>
  );
  return (
    <div className="esm-add-job">
      <EditButton label={`Add a job for ${persona.title}`} form={formId} text="+ Add job" />
      <EditForm id={formId} op="create-job" target={{ persona: persona.id }} label={`Add a job for ${persona.title}`} hint={<>It goes after the other jobs.</>}>
        {part("situation", "When", "the trigger, and what makes it hard")}
        {part("motivation", "I want", "to …, in their words")}
        {part("outcome", "so that", "what gets better, and what is at stake")}
      </EditForm>
    </div>
  );
}

/** Opens the form for a new persona. Hidden until board.js runs, like Edit. */
function AddPersonaButton({ formId }: { formId: string }) {
  return <EditButton label="Add a persona" form={formId} text="+ Add persona" />;
}

/**
 * The form for a new persona: a title and an optional summary. The persona goes after
 * the others, so everyone keeps their colour, and the tab opens it so jobs can be added.
 */
function AddPersonaForm({ formId }: { formId: string }) {
  return (
    <EditForm id={formId} op="create-persona" label="Add a persona" hint={<>It goes after the other personas. Add their jobs next.</>}>
      <label className="esm-field">
        <span className="esm-field-label">Title<span className="esm-field-count">{`Up to ${personaTitleMax} characters`}</span></span>
        <input name="title" maxLength={personaTitleMax} required placeholder="Who they are, such as Product manager" />
      </label>
      <label className="esm-field">
        <span className="esm-field-label">Summary<span className="esm-field-count">{`Optional, up to ${personaSummaryMax} characters`}</span></span>
        <textarea name="summary" rows={3} maxLength={personaSummaryMax} placeholder="What they own and decide" />
      </label>
    </EditForm>
  );
}

/** What the persona is judged on, what they use today and their constraints, side by side. */
function PersonaContext({ persona, baseId, editing }: { persona: PersonaLabel; baseId: string; editing?: boolean }) {
  const context = persona.context;
  if (!context && !editing) return null;
  const empty = <p className="esm-release-hidden">Not set yet.</p>;
  const successEditor = `${baseId}-success-edit`;
  const parts = [
    (context?.success || editing) && {
      key: "success",
      title: "Success means",
      body: editing
        ? <InlineText as="p" editor={successEditor} field="success" label="Success means" max={successMax} multiline placeholder="Not set yet.">{context?.success ?? ""}</InlineText>
        : <p>{present(context, `the context of persona ${persona.id}`).success}</p>,
    },
    (context?.usesToday?.length || editing) && {
      key: "uses",
      title: "Uses today",
      body: context?.usesToday?.length ? <ul className="esm-uses">{context.usesToday.map((item, index) => <li key={index}>{item}</li>)}</ul> : empty,
      fields: <ListField label="Uses today" name="usesToday" values={context?.usesToday} max={usesTodayMax} items={usesTodayItems} />,
    },
    (context?.constraints?.length || editing) && {
      key: "constraints",
      title: "Constraints",
      body: context?.constraints?.length ? <ul>{context.constraints.map((item, index) => <li key={index}>{item}</li>)}</ul> : empty,
      fields: <ListField label="Constraints" name="constraints" values={context?.constraints} max={contextLineMax} items={constraintsItems} />,
    },
  ].filter(part => !!part) as { key: string; title: string; body: ReactNode; fields?: ReactNode }[];
  return (
    <div className="esm-context-band">
      {parts.map((part, index) => {
        const formId = part.fields ? `${baseId}-${part.key}-edit` : successEditor;
        const label = `Edit ${part.title.toLowerCase()} for ${persona.title}`;
        return (
          <section className="esm-context-card" key={part.key} aria-labelledby={`${baseId}-${part.key}`}>
            {editing
              ? (
                <div className="esm-context-head">
                  <h4 id={`${baseId}-${part.key}`}>{part.title}{index === 0 && context?.draft && <DraftLabel />}</h4>
                  <EditButton label={`Edit ${part.title.toLowerCase()}`} form={formId} />
                </div>
              )
              : <h4 id={`${baseId}-${part.key}`}>{part.title}{index === 0 && context?.draft && <DraftLabel />}</h4>}
            {editing && part.fields ? <div data-esm-edit-view={formId}>{part.body}</div> : part.body}
            {editing && (part.fields
              ? <EditForm id={formId} op="set-persona-context" target={{ persona: persona.id }} label={label} hint={draftHint(context?.draft)}>{part.fields}</EditForm>
              : <InlineBar id={formId} op="set-persona-context" target={{ persona: persona.id }} label={label} hint={draftHint(context?.draft)} />)}
          </section>
        );
      })}
    </div>
  );
}

/** The parameters every board link keeps: the host's, then the search, status, “changed in”, persona, job and activity filters. */
function boardParams(filter: NonNullable<StoryMapView["filter"]>, preservedParams?: Readonly<Record<string, string>>, { persona = filter.persona ?? [] } = {}) {
  const params = filterParams(filter, preservedParams);
  for (const id of persona) params.append("persona", id);
  for (const id of filter.job ?? []) params.append("job", id);
  for (const id of filter.activity ?? []) params.append("activity", id);
  return params;
}

/** The link to a persona's page on the Personas tab, keeping the other filters. */
function personaPageHref(filter: NonNullable<StoryMapView["filter"]>, personaId: string, preservedParams?: Readonly<Record<string, string>>) {
  const params = boardParams(filter, preservedParams, { persona: [personaId] });
  params.set("view", "personas");
  return `?${params}`;
}

/**
 * The Story map, Personas and Analytics tabs, as links, so they work without JavaScript.
 * Each keeps the viewer's filters, so going back to the map keeps them.
 */
function BoardTabs({ current, filter, preservedParams, stories, personas, actions }: {
  current: "map" | "personas" | "actions" | "analytics";
  filter: NonNullable<StoryMapView["filter"]>;
  preservedParams?: Readonly<Record<string, string>>;
  stories: number;
  personas: number;
  actions: number;
}) {
  const params = boardParams(filter, preservedParams);
  const pageHref = (page: "personas" | "analytics") => {
    const copy = new URLSearchParams(params);
    copy.set("view", page);
    return `?${copy}`;
  };
  const tab = (page: "map" | "personas" | "actions" | "analytics", href: string, label: string, count?: number, counted?: string) => (
    <a className="esm-tab" href={href} aria-current={current === page ? "page" : undefined}>
      {label}
      {count !== undefined && <span className="esm-tab-count"><span aria-hidden="true">{count}</span><span className="esm-visually-hidden">{`, ${counted}`}</span></span>}
    </a>
  );
  return (
    <nav className="esm-tabs" aria-label="Board views">
      {tab("map", `?${params}`, "Story map", stories, storyCount(stories))}
      {tab("personas", pageHref("personas"), "Personas", personas, plural(personas, "persona"))}
      {tab("actions", actionsHref(filter, preservedParams), "Actions", actions, plural(actions, "action"))}
      {tab("analytics", pageHref("analytics"), "Analytics")}
      <span className="esm-tabs-end">Internal only. Customers see the story map.</span>
    </nav>
  );
}

const analyticsPeriodChoices: readonly [AnalyticsPeriod, string][] = [["day", "Day"], ["week", "Week"], ["month", "Month"]];
const analyticsMilestoneChoices: readonly [AnalyticsMilestone, string][] = [["merged", "Merged"], ["shipped", "Shipped"]];
const analyticsMeasureChoices: readonly [AnalyticsMeasure, string][] = [["stories", "Chart stories"], ["points", "Chart points"], ["tokens", "Chart tokens"], ["spend", "Chart spend"]];
const analyticsWindowText: Readonly<Record<AnalyticsPeriod, string>> = {
  day: `last ${analyticsWindow.day} days`,
  week: `last ${analyticsWindow.week} weeks`,
  month: `last ${analyticsWindow.month} months`,
};
const analyticsPeriodHeading: Readonly<Record<AnalyticsPeriod, string>> = { day: "Day (UTC)", week: "Week (UTC)", month: "Month (UTC)" };

/** Number formats for the Analytics tab: points, compact tokens such as “109.7M”, and US dollars. */
function analyticsFormats(locale: string) {
  const points = new Intl.NumberFormat(locale, { maximumFractionDigits: 0 });
  const tokens = new Intl.NumberFormat(locale, { notation: "compact", maximumFractionDigits: 1 });
  const spend = new Intl.NumberFormat(locale, { style: "currency", currency: "USD", currencyDisplay: "narrowSymbol" });
  // Each period is a UTC day, week or month, so its labels are in UTC whatever the board's time zone.
  const weekday = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", timeZone: "UTC" });
  const dayMonth = new Intl.DateTimeFormat(locale, { day: "numeric", month: "short", timeZone: "UTC" });
  const fullDay = new Intl.DateTimeFormat(locale, { weekday: "short", day: "numeric", month: "short", timeZone: "UTC" });
  const shortMonth = new Intl.DateTimeFormat(locale, { month: "short", timeZone: "UTC" });
  const longMonth = new Intl.DateTimeFormat(locale, { month: "long", year: "numeric", timeZone: "UTC" });
  // The history's dates are in UTC too, so they agree with the rows.
  const date = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeZone: "UTC" });
  const dateTime = new Intl.DateTimeFormat(locale, { dateStyle: "medium", timeStyle: "short", timeZone: "UTC" });
  return {
    date: (at: string) => date.format(new Date(at)),
    dateTime: (at: string) => dateTime.format(new Date(at)),
    points: (value: number) => points.format(value),
    tokens: (value: number) => tokens.format(value),
    spend: (value: number) => spend.format(value),
    /** The bar chart's axis label, such as “Fri 20”, “23 Nov” or “Nov”. */
    axis: (start: string, period: AnalyticsPeriod) => {
      const date = new Date(start);
      return period === "day" ? weekday.format(date) : period === "week" ? dayMonth.format(date) : shortMonth.format(date);
    },
    /** The table's row heading, such as “Fri 20 Nov”, “Week of 23 Nov” or “November 2026”. */
    row: (start: string, period: AnalyticsPeriod) => {
      const date = new Date(start);
      return period === "day" ? fullDay.format(date) : period === "week" ? `Week of ${dayMonth.format(date)}` : longMonth.format(date);
    },
  };
}

type AnalyticsFormats = ReturnType<typeof analyticsFormats>;

/** The value of one measure, or undefined when stories were completed but none has it recorded. */
function analyticsValue(totals: AnalyticsTotals, measure: AnalyticsMeasure) {
  if (measure === "stories") return totals.stories;
  const [value, recorded] = measure === "points"
    ? [totals.points, totals.estimated]
    : measure === "tokens" ? [totals.tokens, totals.tokensRecorded] : [totals.spendUsd, totals.spendRecorded];
  return totals.stories > 0 && recorded === 0 ? undefined : value;
}

function formatAnalyticsValue(value: number | undefined, measure: AnalyticsMeasure, formats: AnalyticsFormats) {
  if (value === undefined) return "—";
  return measure === "stories" ? String(value) : formats[measure](value);
}

/**
 * One measure in the Analytics table: its total, or a dash when no story has it, with how many
 * stories have it when that is not all of them. Missing values are never counted as zero.
 * `coverage` false leaves out the count, for spend when tokens already show it.
 */
function AnalyticsCell({ totals, measure, formats, coverage = true }: { totals: AnalyticsTotals; measure: Exclude<AnalyticsMeasure, "stories">; formats: AnalyticsFormats; coverage?: boolean }) {
  const recorded = measure === "points" ? totals.estimated : measure === "tokens" ? totals.tokensRecorded : totals.spendRecorded;
  const value = analyticsValue(totals, measure);
  const word = measure === "points" ? "estimated" : "recorded";
  return (
    <td>
      {value === undefined
        ? <><span aria-hidden="true">—</span>{!coverage && <span className="esm-visually-hidden">None recorded</span>}</>
        : formatAnalyticsValue(value, measure, formats)}
      {coverage && recorded < totals.stories && <span className="esm-analytics-cov">{`${recorded} of ${totals.stories} ${word}`}</span>}
    </td>
  );
}

/** The guide's section on the Analytics tab. */
const analyticsGuide = `${storyMapRepositoryUrl}/blob/main/docs/story-map.md#see-delivery-totals`;

/** The Analytics tab without a history file: how to add one, and nothing else. */
function AnalyticsSetup({ baseId }: { baseId: string }) {
  const titleId = `${baseId}-analytics-setup`;
  return (
    <article className="esm-persona-setup esm-analytics-setup" aria-labelledby={titleId}>
      <h3 id={titleId}>No history yet</h3>
      <p>The Analytics tab counts the stories, points, tokens and spend completed each day, week or month. It needs the map’s status history, which comes from Git, so there is nothing extra to record.</p>
      <ol>
        <li>
          When the product is built, with the full Git history, run:
          <pre><code>npx --no-install story-map history --out build/story-map-history.json</code></pre>
        </li>
        <li>Pass the file to the board: <code>story-map preview --history build/story-map-history.json</code>, or the <code>history</code> option of <code>getStoryMapPage</code> in your app.</li>
      </ol>
      <p><a href={analyticsGuide} {...newTab}>Read the guide to the Analytics tab<NewTabHint /></a></p>
    </article>
  );
}

/** The link to the Actions tab, keeping the board's filters, narrowed by `actions`. */
function actionsHref(filter: NonNullable<StoryMapView["filter"]>, preservedParams?: Readonly<Record<string, string>>, actions: StoryMapActionFilter = {}) {
  const params = boardParams(filter, preservedParams);
  params.set("view", "actions");
  if (actions.kind) params.set("action-kind", actions.kind);
  if (actions.itemType) params.set("action-item-type", actions.itemType);
  if (actions.release) params.set("action-release", actions.release);
  if (actions.item) params.set("action-item", actions.item);
  if (actions.needsPerson) params.set("needs-person", "1");
  return `?${params}`;
}

/** Where an action's item opens: a story's or release's permalink, or a persona's page. */
interface ActionLinks {
  item(action: StoryMapAction): { href?: string; label: string } | undefined;
  /** The action's line in the map file, under `sourceBaseUrl`. */
  line(action: StoryMapAction): string | undefined;
}

function WhoActs({ needsPerson }: { needsPerson: boolean }) {
  return needsPerson
    ? <span className="esm-action-who" data-person=""><PersonIcon />Needs a person</span>
    : <span className="esm-action-who"><AgentIcon />Person or agent</span>;
}

function PersonIcon() {
  return (
    <svg className="esm-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <circle cx="8" cy="5" r="2.75" /><path d="M2.75 14c.6-2.9 2.6-4.5 5.25-4.5s4.65 1.6 5.25 4.5" />
    </svg>
  );
}

function AgentIcon() {
  return (
    <svg className="esm-icon" width="12" height="12" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <rect x="2.75" y="4.5" width="10.5" height="8.5" rx="2" /><path d="M8 2v2.5M6 8.5h.01M10 8.5h.01" />
    </svg>
  );
}

/**
 * The Analytics tab: the stories, points, tokens and spend completed in each UTC day, week or
 * month, with totals for the window, a bar chart of one measure and the table as its accessible
 * data. Its options are a form, so they work without JavaScript, and board.js applies them as soon
 * as they change. Internal viewers only.
 */
function AnalyticsPage({ map, filter, preservedParams, settings, baseId }: {
  map: Extract<StoryMapView, { audience: "internal" }>;
  filter: NonNullable<StoryMapView["filter"]>;
  preservedParams?: Readonly<Record<string, string>>;
  settings: DateSettings;
  baseId: string;
}) {
  const hintId = `${baseId}-analytics-hint`;
  const { period, completed, chart } = filter.analytics ?? { period: "day", completed: "merged", chart: "stories" };
  // The form keeps the board's other parameters, so the tabs still lead back to the same map.
  const params = boardParams(filter, preservedParams);
  params.set("view", "analytics");
  const select = (name: string, label: string, value: string, choices: readonly (readonly [string, string])[]) => (
    <select className="esm-select" name={name} aria-label={label} aria-describedby={hintId} defaultValue={value}>
      {choices.map(([choice, text]) => <option key={choice} value={choice}>{text}</option>)}
    </select>
  );
  const toolbar = (
    <div className="esm-toolbar esm-analytics-toolbar">
      <p className="esm-toolbar-label">Delivered<span className="esm-toolbar-count">{analyticsWindowText[period]}</span></p>
      <form className="esm-filters" method="get" aria-label="Analytics options">
        {[...params].map(([name, value], index) => <input key={`${name}-${index}`} type="hidden" name={name} value={value} />)}
        <span className="esm-visually-hidden" id={hintId} data-esm-filter-hint="" />
        {select("period", "Period", period, analyticsPeriodChoices)}
        {select("completed", "Completed when", completed, analyticsMilestoneChoices)}
        {select("chart", "Chart", chart, analyticsMeasureChoices)}
        <button type="submit" className="esm-button esm-apply">Apply</button>
      </form>
    </div>
  );
  if (!map.history) return <>{toolbar}<AnalyticsSetup baseId={baseId} /></>;

  const analytics = storyMapAnalytics({ stories: map.stories, history: map.history }, { period, milestone: completed, now: settings.now });
  const formats = analyticsFormats(settings.locale);
  const { totals, buckets } = analytics;
  const values = buckets.map(bucket => analyticsValue(bucket, chart));
  const highest = Math.max(0, ...values.map(value => value ?? 0));
  const milestoneText = completed === "merged" ? "merged or shipped" : "shipped";
  const known = analytics.knownFrom
    ? `History known from ${formats.date(analytics.knownFrom)}${analytics.complete ? "" : ", from a shallow clone, so earlier changes are missing"}, up to ${formats.dateTime(analytics.generatedAt)} UTC. `
    : "The history has no changes yet. ";
  const undated = analytics.undated
    ? ` ${plural(analytics.undated, "story", "stories")} ${milestoneText} ${analytics.undated === 1 ? "is" : "are"} not counted, because the history does not say when: ${analytics.undated === 1 ? "it was" : "they were"} complete before it starts, or became complete after it was made or in a version it could not read.`
    : "";
  // The spend column only counts its own coverage when it differs from the tokens column beside it.
  const spendCoverage = (item: AnalyticsTotals) => item.spendDiffers > 0;
  const partial = (recorded: number) => totals.stories > 0 && recorded < totals.stories;
  const row = (item: AnalyticsTotals) => (
    <>
      <td>{item.stories}</td>
      <AnalyticsCell totals={item} measure="points" formats={formats} />
      <AnalyticsCell totals={item} measure="tokens" formats={formats} />
      <AnalyticsCell totals={item} measure="spend" formats={formats} coverage={spendCoverage(item)} />
    </>
  );

  return (
    <>
      {toolbar}
      <div className="esm-analytics">
        <p className="esm-analytics-coverage">
          {known}Points, tokens and spend are each story’s values today, not when it was completed. Stories without an estimate or recorded tokens are left out of those totals, not counted as zero.{undated}
        </p>
        <dl className="esm-analytics-totals">
          <div className="esm-analytics-total"><dt>Stories</dt><dd>{totals.stories}<small>{milestoneText}</small></dd></div>
          <div className="esm-analytics-total">
            <dt>Points</dt>
            <dd>{formatAnalyticsValue(analyticsValue(totals, "points"), "points", formats)}{partial(totals.estimated) && <small>{`${totals.estimated} of ${storyCount(totals.stories)} estimated`}</small>}</dd>
          </div>
          <div className="esm-analytics-total">
            <dt>Tokens</dt>
            <dd>{formatAnalyticsValue(analyticsValue(totals, "tokens"), "tokens", formats)}{partial(totals.tokensRecorded) && <small>{`recorded for ${totals.tokensRecorded} of ${totals.stories}`}</small>}</dd>
          </div>
          <div className="esm-analytics-total">
            <dt>Spend</dt>
            <dd>{formatAnalyticsValue(analyticsValue(totals, "spend"), "spend", formats)}<small>{partial(totals.spendRecorded) ? `estimated, recorded for ${totals.spendRecorded} of ${totals.stories}` : "estimated, at API list prices"}</small></dd>
          </div>
        </dl>
        {/* The table below holds the same numbers, so screen readers skip the chart. */}
        <div className="esm-analytics-chart" aria-hidden="true" style={{ "--esm-analytics-columns": buckets.length } as CSSProperties}>
          {buckets.map((bucket, index) => (
            <div className="esm-analytics-bar" key={bucket.start}>
              <span>{formatAnalyticsValue(values[index], chart, formats)}</span>
              <span style={{ height: highest ? `${((values[index] ?? 0) / highest) * 100}%` : 0 }} />
            </div>
          ))}
        </div>
        <div className="esm-analytics-axis" aria-hidden="true" style={{ "--esm-analytics-columns": buckets.length } as CSSProperties}>
          {buckets.map(bucket => <span key={bucket.start}>{formats.axis(bucket.start, period)}</span>)}
        </div>
        {/* biome-ignore lint/a11y/noNoninteractiveTabindex: the table scrolls sideways, so keyboard users need to focus it to scroll it. */}
        <div className="esm-analytics-scroll" role="region" tabIndex={0} aria-labelledby={`${baseId}-analytics-caption`}>
          <table className="esm-analytics-table">
            <caption className="esm-visually-hidden" id={`${baseId}-analytics-caption`}>{`Stories, points, tokens and spend ${milestoneText} each ${period}, ${analyticsWindowText[period]}`}</caption>
            <thead><tr><th scope="col">{analyticsPeriodHeading[period]}</th><th scope="col">Stories</th><th scope="col">Points</th><th scope="col">Tokens</th><th scope="col">Spend</th></tr></thead>
            <tbody>
              {buckets.map(bucket => (
                <tr key={bucket.start} className={bucket.stories ? undefined : "esm-empty"}>
                  <th scope="row">{formats.row(bucket.start, period)}</th>
                  {row(bucket)}
                </tr>
              ))}
            </tbody>
            <tfoot><tr><th scope="row">{`${buckets.length} ${period}s`}</th>{row(totals)}</tr></tfoot>
          </table>
        </div>
      </div>
    </>
  );
}

/**
 * Copies one action's command. The command is not shown: it travels in `data-esm-command`,
 * and board.js shows the button once it can copy. `label` names the item for screen readers.
 */
function CopyCommandButton({ command, label }: { command: string; label: string }) {
  return (
    <button type="button" className="esm-change-copy esm-action-copy" data-esm-copy-command={command} title={command} hidden>
      <BriefIcon /><span data-esm-copy-label="">Copy</span><span className="esm-visually-hidden">{` the command for ${label}`}</span>
    </button>
  );
}

/** The cell that links to an action's line in the map, or names it. */
function ActionLine({ action, links }: { action: StoryMapAction; links: ActionLinks }) {
  if (action.line === undefined) return null;
  const href = links.line(action);
  return href
    ? <a href={href} {...newTab}>{action.line}<NewTabHint /></a>
    : action.line;
}

/** An action's type, coloured by its category, so the table can be scanned by kind. */
function ActionKindBadge({ group }: { group: StoryMapActionGroup }) {
  return <span className="esm-kind" data-category={group.category} title={`${group.title}. ${group.why}`}>{group.label}</span>;
}

/** What the Category column calls each kind of item. */
const itemTypeLabels: Record<StoryMapAction["item"]["type"], string> = { persona: "Persona", story: "Story", release: "Release", map: "Map" };
const itemTypePlurals: Record<StoryMapAction["item"]["type"], string> = { persona: "Personas", story: "Stories", release: "Releases", map: "Whole map" };

/** One row of the Actions table: an action and the kind it belongs to. */
interface ActionRow {
  group: StoryMapActionGroup;
  action: StoryMapAction;
}

/**
 * Every shown action in one table: its type, who can act, the item, its release, the problem,
 * its line and, where a command fixes it, a **Copy** button. Rows with a command get a checkbox,
 * and **Copy commands** above copies the chosen rows' commands, one per line. board.js shows the
 * checkboxes and buttons once it can copy, so without it the table only reads.
 */
function ActionTable({ rows, links, releaseTitles, tableId }: {
  rows: readonly ActionRow[];
  links: ActionLinks;
  releaseTitles: ReadonlyMap<string, string>;
  tableId: string;
}) {
  const commands = rows.filter(({ action }) => action.command).length;
  const showLine = rows.some(({ action }) => action.line !== undefined);
  return (
    <div className="esm-action-table-wrap" data-esm-action-table={commands ? "" : undefined}>
      {commands > 1 && (
        <div className="esm-action-bulk" hidden>
          <button type="button" className="esm-action-bulk-copy" data-esm-copy-selected={tableId} disabled>
            <BriefIcon /><span data-esm-copy-label="">Copy commands</span>
          </button>
          <span className="esm-action-bulk-note" data-esm-selected-note="">Tick rows to copy their commands at once, one per line, for a terminal or an agent.</span>
        </div>
      )}
      <div className="esm-action-scroll">
        <table className="esm-action-table" id={tableId}>
          <caption className="esm-visually-hidden">Actions on the map</caption>
          <thead>
            <tr>
              {commands > 1 && (
                <th scope="col" className="esm-action-select">
                  <input type="checkbox" data-esm-select-all="" aria-label="Choose every row with a command" />
                </th>
              )}
              <th scope="col" className="esm-action-type">Category</th>
              <th scope="col">Item</th>
              <th scope="col" className="esm-action-message">Problem</th>
              <th scope="col" className="esm-action-kind">Action</th>
              {showLine && <th scope="col" className="esm-action-line">Line</th>}
              {commands > 0 && <th scope="col" className="esm-action-copy-cell"><span className="esm-visually-hidden">Copy command</span></th>}
            </tr>
          </thead>
          <tbody>
            {rows.map(({ group, action }, index) => {
              const item = links.item(action);
              const release = action.item.type === "story" && action.release ? releaseTitles.get(action.release) ?? action.release : undefined;
              return (
                <tr key={index} data-category={group.category} data-kind={group.kind}>
                  {commands > 1 && (
                    <td className="esm-action-select">
                      {action.command && <input type="checkbox" data-esm-select={action.command} aria-label={`Choose ${group.title}: ${item?.label ?? ""}`} />}
                    </td>
                  )}
                  <td className="esm-action-type"><span className="esm-item-type" data-item-type={action.item.type}>{itemTypeLabels[action.item.type]}</span></td>
                  <th scope="row" className="esm-action-item">
                    {item && (item.href ? <a href={item.href}>{item.label}</a> : <span>{item.label}</span>)}
                    {release && <span className="esm-action-release">{release}</span>}
                  </th>
                  <td className="esm-action-message">
                    {action.message}
                    <a className="esm-action-rule" href={group.help} title="How to fix this, in the story map guide">{group.rule}</a>
                  </td>
                  <td className="esm-action-kind">
                    <div className="esm-action-kind-stack">
                      <ActionKindBadge group={group} />
                      <WhoActs needsPerson={action.needsPerson} />
                    </div>
                  </td>
                  {showLine && <td className="esm-action-line"><ActionLine action={action} links={links} /></td>}
                  {commands > 0 && <td className="esm-action-copy-cell">{action.command && <CopyCommandButton command={action.command} label={`${group.title}, ${item?.label ?? ""}`} />}</td>}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </div>
  );
}

/** A filter link in the Actions tab: a plain link, marked current when chosen. */
interface ActionFilterOption {
  label: string;
  href: string;
  current: boolean;
  /** How many actions the choice keeps. */
  count?: number;
  /** An action category, for the option's coloured dot. */
  category?: string;
  /** Shown as the option's tooltip. */
  hint?: string;
}

/** A filter on the Actions tab as a dropdown menu of links, so it works without JavaScript. */
function ActionFilterMenu({ label, chosen, options }: { label: string; chosen?: ActionFilterOption; options: ActionFilterOption[] }) {
  return (
    <details className="esm-menu esm-action-filter">
      <summary className="esm-select esm-menu-button" data-category={chosen?.category}>
        <span className="esm-visually-hidden">{label}: </span>
        {chosen?.category && <span className="esm-kind-dot" aria-hidden="true" />}
        {chosen?.label ?? `All ${label.toLowerCase()}s`}
      </summary>
      <ul className="esm-menu-panel">
        {options.map(option => (
          <li key={option.href}>
            <a href={option.href} aria-current={option.current ? "true" : undefined} data-category={option.category} title={option.hint}>
              {option.category ? <span className="esm-kind-dot" aria-hidden="true" /> : <span className="esm-kind-dot esm-kind-dot-none" aria-hidden="true" />}
              <span className="esm-action-filter-label">{option.label}</span>
              {option.count !== undefined && <span className="esm-kind-chip-count">{option.count}</span>}
            </a>
          </li>
        ))}
      </ul>
    </details>
  );
}

/**
 * The Actions tab: what validate warns about, grouped by kind, each with a link to its item,
 * who can act, its line in the map and the command that fixes it. Counts come from the whole
 * map, so they do not change with the board's filters. The tab's own filters are links, so
 * they work without JavaScript.
 */
function ActionsPage({ groups, filter, preservedParams, releases, links, checkedAt, settings, baseId }: {
  groups: readonly StoryMapActionGroup[];
  filter: NonNullable<StoryMapView["filter"]>;
  preservedParams?: Readonly<Record<string, string>>;
  releases: readonly StoryMapLabel[];
  links: ActionLinks;
  checkedAt: string;
  settings: DateSettings;
  baseId: string;
}) {
  const chosen = filter.actions ?? {};
  const shown = filterStoryMapActions(groups, chosen);
  const total = countStoryMapActions(groups);
  const shownCount = countStoryMapActions(shown);
  const forPeople = countStoryMapActions(groups.filter(group => group.needsPerson));
  const href = (change: StoryMapActionFilter) => actionsHref(filter, preservedParams, { ...chosen, ...change });
  const without = (key: keyof StoryMapActionFilter) => {
    const next = { ...chosen };
    delete next[key];
    return actionsHref(filter, preservedParams, next);
  };
  // Each menu offers only choices that still match the other filters, so a choice never empties the list.
  const otherThan = (key: keyof StoryMapActionFilter) => {
    const rest = { ...chosen };
    delete rest[key];
    return filterStoryMapActions(groups, rest);
  };
  const kindGroups = otherThan("kind");
  const actionOptions: ActionFilterOption[] = [
    { label: "All actions", href: without("kind"), current: !chosen.kind, count: countStoryMapActions(kindGroups) },
    ...kindGroups.map(group => ({ label: group.label, href: href({ kind: group.kind }), current: chosen.kind === group.kind, count: group.actions.length, category: group.category, hint: group.why })),
  ];
  const typeGroups = otherThan("itemType");
  const releaseIds = new Set(otherThan("release").flatMap(group => group.actions.flatMap(action => action.release ? [action.release] : [])));
  const releaseTitles = new Map(releases.map(release => [release.id, release.title]));
  const releaseTitle = (id: string) => releaseTitles.get(id) ?? id;
  const itemLabel = chosen.item;
  const filtering = Object.keys(chosen).length > 0;
  return (
    <div className="esm-actions">
      <div className="esm-actions-intro">
        <div>
          <h3 className="esm-actions-title">{total ? `${plural(total, "action")} waiting on the map` : "Nothing is waiting on the map."}</h3>
          <p>
            {total ? "From what validate warns about. Each goes away when the map changes. " : ""}
            <span className="esm-actions-checked">Checked <time dateTime={checkedAt}>{formatDate(checkedAt, settings)}</time>.</span>
          </p>
        </div>
        {total > 0 && (
          <p className="esm-actions-split">
            <span data-person=""><PersonIcon /><b>{forPeople}</b> need a person</span>
            <span><AgentIcon /><b>{total - forPeople}</b> a person or an agent can do</span>
          </p>
        )}
      </div>
      {total > 0 && (
        <nav className="esm-actions-filters" aria-label="Filter actions">
          <div className="esm-actions-filter-row">
            <span className="esm-visually-hidden" id={`${baseId}-category-label`}>Category</span>
            <ul className="esm-segments" aria-labelledby={`${baseId}-category-label`}>
              <li><a className="esm-segment" href={without("itemType")} aria-current={!chosen.itemType ? "true" : undefined}>All <span className="esm-kind-chip-count">{countStoryMapActions(typeGroups)}</span></a></li>
              {storyMapActionItemTypes.flatMap(type => {
                const count = typeGroups.reduce((sum, group) => sum + group.actions.filter(action => action.item.type === type).length, 0);
                return count || chosen.itemType === type
                  ? [<li key={type}><a className="esm-segment" data-item-type={type} href={href({ itemType: type })} aria-current={chosen.itemType === type ? "true" : undefined}>{itemTypePlurals[type]} <span className="esm-kind-chip-count">{count}</span></a></li>]
                  : [];
              })}
            </ul>
            <ActionFilterMenu
              label="Action"
              chosen={actionOptions.find(option => option.current && option.category)}
              options={actionOptions}
            />
            {releaseIds.size > 0 && (
              <ActionFilterMenu
                label="Release"
                chosen={chosen.release ? { label: releaseTitle(chosen.release), href: "", current: true } : undefined}
                options={[
                  { label: "All releases", href: without("release"), current: !chosen.release },
                  ...releases.filter(release => releaseIds.has(release.id)).map(release => ({ label: release.title, href: href({ release: release.id }), current: chosen.release === release.id })),
                ]}
              />
            )}
            <a className="esm-action-toggle" href={chosen.needsPerson ? without("needsPerson") : href({ needsPerson: true })} aria-current={chosen.needsPerson ? "true" : undefined}>
              <PersonIcon />Needs a person
            </a>
            {itemLabel && <span className="esm-action-chip">{`Only ${itemLabel}`} <a href={without("item")} aria-label={`Show actions for every item, not only ${itemLabel}`}>×</a></span>}
            {filtering && <a className="esm-clear" href={actionsHref(filter, preservedParams)}>Clear filters</a>}
            <span className="esm-results">{filtering ? `${shownCount} of ${plural(total, "action")}` : plural(total, "action")}</span>
          </div>
        </nav>
      )}
      {total > 0 && !shown.length && <p className="esm-release-hidden">No actions match these filters.</p>}
      {shown.length > 0 && (
        <ActionTable
          rows={shown.flatMap(group => group.actions.map(action => ({ group, action })))}
          links={links}
          releaseTitles={releaseTitles}
          tableId={`${baseId}-action-table`}
        />
      )}
    </div>
  );
}

/** A story's or release's own actions, in its panel, with a link to the tab narrowed to it. */
function ItemActions({ groups, type, id, panelId, links, tabHref }: {
  groups: readonly StoryMapActionGroup[];
  type: "story" | "release";
  id: string;
  panelId: string;
  links: ActionLinks;
  tabHref?: string;
}) {
  // IDs are only unique within their list, so match the type too.
  const mine = filterStoryMapActions(groups, { item: id })
    .map(group => ({ ...group, actions: group.actions.filter(action => action.item.type === type) }))
    .filter(group => group.actions.length);
  if (!mine.length) return null;
  const headingId = `${panelId}-actions`;
  return (
    <section className="esm-detail-section esm-item-actions" aria-labelledby={headingId}>
      <h4 id={headingId}>Actions</h4>
      <ul className="esm-action-list">
        {mine.flatMap(group => group.actions.map((action, index) => (
          <li className="esm-action" key={`${group.kind}-${index}`}>
            <div className="esm-action-text">
              <p className="esm-action-head">
                <span className="esm-action-item">{group.label}</span>
                <WhoActs needsPerson={action.needsPerson} />
                {action.line !== undefined && <span className="esm-action-line">Line <ActionLine action={action} links={links} /></span>}
              </p>
              <p className="esm-action-message">{action.message}</p>
            </div>
            {action.command && <CopyCommandButton command={action.command} label={group.title} />}
          </li>
        )))}
      </ul>
      {tabHref && <p className="esm-item-actions-link"><a href={tabHref}>See them on the Actions tab<span aria-hidden="true"> →</span></a></p>}
    </section>
  );
}

/** A persona's link in the Personas tab's list: avatar, title, active stories and gaps. */
function PersonaLink({ persona, href, current }: { persona: PersonaLabel; href: string; current: boolean }) {
  const gaps = personaGaps(persona);
  return (
    <a className="esm-persona-link" href={href} aria-current={current ? "page" : undefined}>
      <PersonaAvatar persona={persona} />
      <span className="esm-persona-link-title">{persona.title}</span>
      <span className="esm-persona-link-meta">
        {storyCount(persona.activeStories)}
        {" · "}
        {gaps ? <span className="esm-job-gap">{plural(gaps, "gap")}</span> : "no gaps"}
      </span>
    </a>
  );
}

/**
 * The Personas tab: a list of personas beside the chosen persona's page, with
 * their context and their jobs as lanes, core job first, each with its steps in order.
 * Counts come from the whole map, so they do not change with the filters.
 */
function PersonasPage({ personas, filter, preservedParams, baseId, editing }: {
  personas: readonly PersonaLabel[];
  filter: NonNullable<StoryMapView["filter"]>;
  preservedParams?: Readonly<Record<string, string>>;
  baseId: string;
  editing?: StoryMapPersonaEditing | false;
}) {
  if (!personas.length) return <PersonasSetup baseId={baseId} editing={editing} />;
  const off = editing === false;
  editing = editing || undefined;
  const persona = personas.find(item => item.id === filter.persona?.[0]) ?? personas[0];
  const base = filterParams(filter, preservedParams);
  const titleId = `${baseId}-persona-title`;
  const jobsId = `${baseId}-persona-jobs`;
  const links = personas.map(item => ({ item, href: personaPageHref(filter, item.id, preservedParams) }));
  const addPersona = editing && personas.length < personasMax ? `${baseId}-add-persona` : undefined;
  return (
    <div className="esm-persona-page" {...editingAttributes(editing, off)}>
      <details className="esm-menu esm-persona-picker">
        <summary className="esm-select esm-menu-button">
          <span className="esm-visually-hidden">Persona: </span><PersonaAvatar persona={persona} />{persona.title}
        </summary>
        <ul className="esm-menu-panel">
          {links.map(({ item, href }) => <li key={item.id}><PersonaLink persona={item} href={href} current={item === persona} /></li>)}
          {addPersona && <li className="esm-add-persona"><AddPersonaButton formId={addPersona} /></li>}
        </ul>
      </details>
      <nav className="esm-persona-list" aria-labelledby={`${baseId}-persona-list`}>
        <p className="esm-persona-list-label" id={`${baseId}-persona-list`}>Personas</p>
        <ul>
          {links.map(({ item, href }) => <li key={item.id}><PersonaLink persona={item} href={href} current={item === persona} /></li>)}
        </ul>
        {addPersona && <p className="esm-add-persona"><AddPersonaButton formId={addPersona} /></p>}
      </nav>
      <article className="esm-persona-main" aria-labelledby={titleId}>
        {addPersona && <AddPersonaForm formId={addPersona} />}
        <div className="esm-persona-title">
          <span className="esm-avatar esm-avatar-lg" data-persona={persona.colour} aria-hidden="true">{persona.initials}</span>
          <div className="esm-persona-title-text">
            {editing
              ? <>
                <div className="esm-persona-heading">
                  <InlineText as="h3" id={titleId} editor={`${baseId}-persona-edit`} field="title" label="Title" max={personaTitleMax} required>{persona.title}</InlineText>
                  <EditButton label={`Edit ${persona.title}`} form={`${baseId}-persona-edit`} />
                </div>
                <InlineText as="p" className="esm-optional" editor={`${baseId}-persona-edit`} field="summary" label="Summary" max={personaSummaryMax} multiline placeholder="Add a summary">{persona.summary ?? ""}</InlineText>
                <InlineBar id={`${baseId}-persona-edit`} op="set-persona" target={{ persona: persona.id }} label={`Edit ${persona.title}`} hint={<>ID <code>{persona.id}</code> stays the same.</>} />
              </>
              : <>
                <h3 id={titleId}>{persona.title}</h3>
                {persona.summary && <p>{persona.summary}</p>}
              </>}
          </div>
          <p className="esm-persona-title-end">
            <a href={withIds(base, "persona", [persona.id])}>Show their stories on the map<span aria-hidden="true"> →</span></a>
            <span>{`${plural(persona.jobs.length, "job")} · ${plural(persona.activeStories, "active story", "active stories")}`}</span>
          </p>
        </div>
        <PersonaContext persona={persona} baseId={`${baseId}-context`} editing={!!editing} />
        <section className="esm-persona-jobs" aria-labelledby={jobsId}>
          <h4 className="esm-section-title" id={jobsId}>Jobs to be done {persona.jobs.length > 0 && <span>Core job first, each with its steps in order</span>}</h4>
          {persona.jobs.length
            ? (
              <ul className="esm-job-lanes">
                {persona.jobs.map((job, index) => <JobLane key={job.id} job={job} laneId={`${baseId}-job-${index}`} base={base} editing={!!editing} />)}
              </ul>
            )
            : <p className="esm-release-hidden">No jobs to be done yet.</p>}
          {editing && persona.jobs.length < personaJobsMax && <AddJob persona={persona} formId={`${baseId}-add-job`} />}
        </section>
      </article>
    </div>
  );
}

/** The YAML the Personas tab suggests for a map with no personas. */
const personasExample = `personas:
  - id: pm
    title: Product manager
    summary: Owns the roadmap and decides what goes in each release.
    jobs:
      - id: plan-release      # the first job is the core job
        situation: a release is being planned and its scope is spread across tickets
        motivation: to agree its scope in the PR that changes the map
        outcome: engineers and product start from the same list`;

/**
 * The Personas tab of a map with no personas: how to add them, so the tab is
 * where the team finds out about personas rather than a feature they never see.
 */
/**
 * Marks the internal Personas page for board.js: where edits save to, or, without
 * that, `data-esm-internal` so it can note on `localhost` that editing is not set up,
 * unless `off` says it is turned off on purpose.
 */
function editingAttributes(editing: StoryMapPersonaEditing | undefined, off: boolean) {
  return editing
    ? { "data-esm-edit-endpoint": editing.endpoint, "data-esm-edit-token": editing.token, "data-esm-edit-revision": editing.revision }
    : { "data-esm-internal": "", "data-esm-read-only": off ? "" : undefined };
}

function PersonasSetup({ baseId, editing: given }: { baseId: string; editing?: StoryMapPersonaEditing | false }) {
  const editing = given || undefined;
  const titleId = `${baseId}-persona-setup`;
  const guide = `${storyMapRepositoryUrl}/blob/main/docs/story-map.md#personas-and-jobs-to-be-done`;
  const formId = `${baseId}-add-persona`;
  return (
    <article className="esm-persona-setup" aria-labelledby={titleId} {...editingAttributes(editing, given === false)}>
      <h3 id={titleId}>No personas yet</h3>
      <p>Personas name the people the product serves and the jobs each of them is trying to get done. Tag stories with those jobs to see who each story is for, and which needs have no stories yet.</p>
      {editing && <div className="esm-add-persona"><AddPersonaButton formId={formId} /><AddPersonaForm formId={formId} /><p>Or add them to the map file:</p></div>}
      <ol>
        <li>
          Add a <code>personas</code> list to <code>product/story-map.yaml</code>, each with an <code>id</code>, a <code>title</code> and their jobs to be done. The first job is the persona’s core job.
          <pre><code>{personasExample}</code></pre>
        </li>
        <li>Tag the stories that serve each job, with <code>story-map edit &lt;ID&gt; --add-job &lt;job ID&gt;</code>, or <code>--add-persona &lt;persona ID&gt;</code> for a story that helps a persona without serving one of their jobs.</li>
        <li>Run <code>story-map validate</code>, then open this tab again to see each persona’s jobs and gaps.</li>
      </ol>
      <p>A coding agent can draft personas and jobs from the product’s docs, issues and research. Ask it to mark each job <code>draft: true</code> until someone on the team confirms it.</p>
      <p><a href={guide} {...newTab}>Read the guide to personas and jobs to be done<NewTabHint /></a></p>
    </article>
  );
}

/**
 * Collapses a release lane to its header. CSS does the collapsing with :has(), so it works
 * without JavaScript; browsers without :has() never show the toggle. The value is the
 * release ID, which board.js uses to remember the choice.
 */
function ReleaseCollapse({ releaseId, title }: { releaseId: string; title: string }) {
  return (
    <label className="esm-collapse">
      <input type="checkbox" className="esm-collapse-input" value={releaseId} aria-label={`Collapse ${title}`} />
      <svg className="esm-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
        <path d="m4 6 4 4 4-4" />
      </svg>
    </label>
  );
}

/**
 * The Released lane's collapse value and anchor. Release IDs cannot hold a colon, so the value
 * never matches a real release, and the anchor does not start with a release lane's `esm-release-`.
 */
const releasedLaneValue = ":released";
const releasedLaneAnchor = "esm-released";

/**
 * The release lanes to draw. A filter hides the lanes it empties. With shipped stories in the
 * Released lane, a release whose stories all moved there is hidden too, and a release that has
 * no stories at all stays, as it does without the Released lane.
 */
function laneReleases<Release extends { id: string }>(
  releases: readonly Release[],
  placed: readonly InternalStoryCard[],
  laneCounts: ReadonlyMap<string, number>,
  filtering: boolean,
  combineShipped: boolean,
): readonly Release[] {
  if (!combineShipped) return filtering ? releases.filter(release => laneCounts.has(release.id)) : releases;
  const withStories = new Set(placed.map(story => story.release));
  return releases.filter(release => laneCounts.has(release.id) || (!filtering && !withStories.has(release.id)));
}

/** The Released lane's story count and summary, or nothing when no shipped story is shown. */
function releasedLane(stories: readonly InternalStoryCard[]) {
  if (!stories.length) return undefined;
  const releases = new Set(stories.map(story => story.release)).size;
  return { count: stories.length, summary: `Shipped stories from ${plural(releases, "release")}.` };
}

/**
 * The Shipped as Released switch: a checkbox in the filter form with the switch role, so it
 * submits with Apply without JavaScript, and board.js applies it as soon as it changes.
 */
function ReleasedSwitch({ on, hintId }: { on: boolean; hintId: string }) {
  return (
    <label className="esm-released-switch">
      Shipped as Released
      {/* biome-ignore lint/a11y/useAriaPropsForRole: a native checkbox gives the switch its checked state, and a fixed aria-checked would go stale when it flips. HTML-ARIA says not to set it on a checkbox. */}
      <input type="checkbox" role="switch" name="released" value="1" defaultChecked={on} aria-describedby={hintId} />
    </label>
  );
}

/** Adds a query parameter to a URL that may be relative, keeping any fragment. */
function withParam(href: string, name: string, value: string) {
  const hash = href.indexOf("#");
  const [path, fragment] = hash === -1 ? [href, ""] : [href.slice(0, hash), href.slice(hash)];
  return `${path}${path.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(value)}${fragment}`;
}

/** The guide to building a Spreo board from the map through Spreo's MCP server, from ChatGPT, Claude or Claude Code. */
const spreoGuideUrl = `${storyMapRepositoryUrl}/blob/main/docs/integrations.md#spreo`;

/**
 * An Export button that opens a menu of links to the host's export route, then a link to the Spreo guide. A
 * `<details>` element opens it, so it works without JavaScript. board.js keeps
 * `collapsed` in step with the lanes, and closes the menu on Escape or a click elsewhere.
 */
function ExportMenu({ href }: { href: string }) {
  const formats = [["vsdx", "Visio (.vsdx), for Lucidchart or Miro"], ["csv", "CSV"], ["json", "JSON, for agents and scripts"]] as const;
  return (
    <details className="esm-menu esm-export">
      <summary className="esm-button esm-menu-button">
        Export
        <svg className="esm-icon" width="14" height="14" viewBox="0 0 14 14" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
          <path d="m3 5 4 4 4-4" />
        </svg>
      </summary>
      <ul className="esm-menu-panel">
        {formats.map(([format, label]) => {
          const target = withParam(href, "format", format);
          return <li key={format}><a className="esm-export-link" href={target} data-esm-export={target} download>{label}</a></li>;
        })}
        <li className="esm-export-guide"><a className="esm-export-link" href={spreoGuideUrl} {...newTab}>Spreo, guide to an interactive board<NewTabHint /></a></li>
      </ul>
    </details>
  );
}

/** GitHub’s anchor for a changelog heading such as `## 0.4.1`. */
function changelogAnchor(version: string) {
  return version.toLowerCase().replace(/[^a-z0-9 _-]/g, "").replace(/ /g, "-");
}

/** The running version and its commit, licence and author. Internal viewers also get links. */
function VersionFooter({ internal }: { internal: boolean }) {
  const licenseUrl = `${storyMapRepositoryUrl}/blob/main/LICENSE`;
  return (
    <footer className="esm-footer">
      <span className="esm-version">
        Auto Story Map {storyMapVersion}
        {storyMapCommit && <>
          {" "}
          {internal
            ? <a className="esm-commit" href={`${storyMapRepositoryUrl}/commit/${storyMapCommit}`} title="The commit this build came from" {...newTab}>{storyMapCommit}<NewTabHint /></a>
            : <span className="esm-commit" title="The commit this build came from">{storyMapCommit}</span>}
        </>}
      </span>
      <span className="esm-author">
        {"By "}
        {internal && storyMapAuthor.url
          ? <a href={storyMapAuthor.url} {...newTab}>{storyMapAuthor.name}<NewTabHint /></a>
          : storyMapAuthor.name}
      </span>
      <span className="esm-license">
        {internal ? <a href={licenseUrl} {...newTab}>{storyMapLicense} licence<NewTabHint /></a> : `${storyMapLicense} licence`}
      </span>
      {internal && <>
        <span><a href={`${storyMapRepositoryUrl}/blob/main/CHANGELOG.md#${changelogAnchor(storyMapVersion)}`} {...newTab}>Changelog<NewTabHint /></a></span>
        <span><a href={storyMapRepositoryUrl} {...newTab}>Source code<NewTabHint /></a></span>
      </>}
    </footer>
  );
}

/** True when a filter narrows the board. Choosing every status shows every story, so it does not count. */
function isFiltering(filter: StoryMapView["filter"]) {
  const statuses = filter?.status;
  const narrowsStatus = !!statuses && !storyStatuses.every(choice => statuses.includes(choice));
  return !!(filter && (filter.query || narrowsStatus || filter.changedWithinDays || filter.persona?.length || filter.job?.length || filter.activity?.length));
}

/** The host's parameters, the search, status and “changed in” filters and Shipped as Released, for links that change only the persona or job. */
function filterParams(filter: NonNullable<StoryMapView["filter"]>, preservedParams?: Readonly<Record<string, string>>) {
  const params = new URLSearchParams(preservedParams ?? {});
  if (filter.query) params.set("q", filter.query);
  for (const status of filter.status ?? []) params.append("status", status);
  if (filter.changedWithinDays) params.set("changed", `${filter.changedWithinDays}d`);
  if (filter.released) params.set("released", "1");
  return params;
}

function withIds(params: URLSearchParams, name: string, ids: readonly string[]) {
  const copy = new URLSearchParams(params);
  for (const id of ids) copy.append(name, id);
  return `?${copy}`;
}

/** What the persona button says: “Everyone” by default or with every persona chosen, one or two titles, or a count. */
function personaSummary(chosen: readonly StoryMapLabel[], total: number) {
  if (!chosen.length || chosen.length === total) return "Everyone";
  if (chosen.length <= 2) return chosen.map(persona => persona.title).join(", ");
  return `${chosen.length} personas`;
}

/**
 * The persona filter, built like the status menu, with every persona ticked by default, which
 * shows everyone. Unticking a persona narrows the board to the others. board.js applies the
 * choice when the menu closes. Customer personas have no avatars, so their options show the title alone.
 */
function PersonaMenu({ personas, chosen, hintId }: { personas: readonly (PersonaLabel | StoryMapLabel)[]; chosen: readonly string[]; hintId: string }) {
  const picked = new Set(chosen.length ? chosen : personas.map(persona => persona.id));
  return (
    <details className="esm-menu esm-persona-menu">
      <summary className="esm-select esm-menu-button" data-esm-focus="persona" aria-describedby={hintId}>
        <span className="esm-visually-hidden">For: </span>{personaSummary(personas.filter(persona => chosen.includes(persona.id)), personas.length)}
      </summary>
      <fieldset className="esm-menu-panel">
        <legend className="esm-visually-hidden">Show stories for these personas</legend>
        {personas.map(persona => (
          <label key={persona.id} className="esm-menu-option">
            <input type="checkbox" name="persona" value={persona.id} defaultChecked={picked.has(persona.id)} />
            {"initials" in persona && <PersonaAvatar persona={persona} />}
            {persona.title}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

const statusFilterLabels: Record<StoryStatusFilter, string> = { ...storyStatusLabels, stalled: "Stalled" };

/** What the status button says: “Active” by default, “All statuses”, one or two names, or a count. */
function statusSummary(status: readonly StoryStatusFilter[] | undefined, internal: boolean) {
  if (!status) return internal ? "Active" : "All statuses";
  if (storyStatuses.every(choice => status.includes(choice))) return "All statuses";
  if (status.length <= 2) return status.map(choice => statusFilterLabels[choice]).join(", ");
  return `${status.length} statuses`;
}

/**
 * The status filter: a button that opens a list of checkboxes, one per status, plus
 * Stalled when the view flags stalled stories. A `<details>` element opens it, so it
 * works without JavaScript, and the form's Apply button submits it. board.js applies
 * the choice when the menu closes.
 */
function StatusMenu({ status, internal, stalled, hintId }: {
  status: readonly StoryStatusFilter[] | undefined;
  internal: boolean;
  stalled: boolean;
  hintId: string;
}) {
  const choices: readonly StoryStatusFilter[] = internal ? [...storyStatuses, ...(stalled ? ["stalled" as const] : [])] : customerStoryStatuses;
  const chosen = new Set<StoryStatusFilter>(status ?? (internal ? activeStoryStatuses : customerStoryStatuses));
  return (
    <details className="esm-menu esm-status-menu">
      <summary className="esm-select esm-menu-button" data-esm-focus="status" aria-describedby={hintId}>
        <span className="esm-visually-hidden">Status: </span>{statusSummary(status, internal)}
      </summary>
      <fieldset className="esm-menu-panel">
        <legend className="esm-visually-hidden">Show stories with these statuses</legend>
        {choices.map(choice => (
          <label key={choice} className="esm-menu-option">
            <input type="checkbox" name="status" value={choice} defaultChecked={chosen.has(choice)} />
            {statusFilterLabels[choice]}
          </label>
        ))}
      </fieldset>
    </details>
  );
}

function hiddenSummary({ blocked, cut }: { blocked: number; cut: number }) {
  return [blocked && `${blocked} blocked`, cut && `${cut} cut`].filter(Boolean).join(" and ");
}

function FilterToolbar({ filter, shown, preservedParams, showChanged, internal, stalledAfterWeeks, exportHref, personas, customerPersonas, activities }: {
  filter: NonNullable<StoryMapView["filter"]>;
  /** The view's activities, to name the chosen ones. */
  activities: readonly StoryMapLabel[];
  /** The internal view's personas. The persona filter shows when there are any. */
  personas: readonly PersonaLabel[];
  /** The customer view's personas. The persona filter shows when there are two or more. */
  customerPersonas: readonly StoryMapLabel[];
  shown: number;
  preservedParams?: Readonly<Record<string, string>>;
  showChanged: boolean;
  internal: boolean;
  stalledAfterWeeks?: number;
  /** Only passed for internal views. */
  exportHref?: string;
}) {
  const filtering = isFiltering(filter);
  const clearHref = `?${new URLSearchParams(preservedParams ?? {})}`;
  const jobs = personas.flatMap(persona => persona.jobs.map(job => ({ job, persona })));
  const chosenJobs = jobs.filter(({ job }) => filter.job?.includes(job.id));
  const withoutJob = `?${boardParams({ ...filter, job: undefined }, preservedParams)}`;
  const chosenActivities = activities.filter(activity => filter.activity?.includes(activity.id));
  const withoutActivity = `?${boardParams({ ...filter, activity: undefined }, preservedParams)}`;
  // Empty unless the optional board.js script runs: it explains that the filters apply as soon as they change.
  const hintId = `${useId()}-filter-hint`;
  return (
    <>
      <div className="esm-toolbar">
        <p className="esm-toolbar-label">
          Journey map <span className="esm-toolbar-count">{storyCount(filter.total)}</span>
        </p>
        <form className="esm-filters" method="get" role="search" aria-label="Filter stories">
          {Object.entries(preservedParams ?? {}).map(([name, value]) => (
            <input key={name} type="hidden" name={name} value={value} />
          ))}
          <label className="esm-search">
            <svg className="esm-icon" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
              <circle cx="7" cy="7" r="4.6" />
              <path d="m10.5 10.5 3.5 3.5" />
            </svg>
            <input type="search" name="q" placeholder="Search stories" aria-label="Search stories" maxLength={100} defaultValue={filter.query ?? ""} />
          </label>
          <span className="esm-visually-hidden" id={hintId} data-esm-filter-hint="" />
          {/* The job filter has no control of its own: the persona panel's links set it, and the form keeps it. */}
          {(filter.job ?? []).map(job => <input key={job} type="hidden" name="job" value={job} />)}
          {/* Nor does the activity filter: the Personas tab's step links set it with the job. */}
          {(filter.activity ?? []).map(activity => <input key={activity} type="hidden" name="activity" value={activity} />)}
          <StatusMenu status={filter.status} internal={internal} stalled={!!stalledAfterWeeks} hintId={hintId} />
          {personas.length > 0 && <PersonaMenu personas={personas} chosen={filter.persona ?? []} hintId={hintId} />}
          {customerPersonas.length > 1 && <PersonaMenu personas={customerPersonas} chosen={filter.persona ?? []} hintId={hintId} />}
          {showChanged && (
            <select
              className="esm-select"
              name="changed"
              aria-label="Filter by when stories were added or changed status"
              aria-describedby={hintId}
              defaultValue={filter.changedWithinDays ? `${filter.changedWithinDays}d` : ""}
            >
              <option value="">All time</option>
              {changedWithinChoices.map(([days, label]) => <option key={days} value={`${days}d`}>{label}</option>)}
            </select>
          )}
          {internal && <ReleasedSwitch on={!!filter.released} hintId={hintId} />}
          <button type="submit" className="esm-button esm-apply">Apply</button>
          {exportHref && <ExportMenu href={exportHref} />}
        </form>
      </div>
      {/* Blocked and cut stories hidden by the default status filter go unmentioned: the status menu shows them. */}
      {filtering && (
        <p className="esm-filter-results" role="status">
          {shown === 0 ? "No stories match these filters." : `Showing ${shown} of ${storyCount(filter.total)}.`}{" "}
          {chosenJobs.length > 0 && <>
            {chosenJobs.length === 1 ? "Stories serving the job " : "Stories serving the jobs "}
            {chosenJobs.map(({ job, persona }, index) => (
              <Fragment key={job.id}>
                {index > 0 && (index === chosenJobs.length - 1 ? " or " : ", ")}
                “<JobStatement job={job} />” <span className="esm-story-job-persona">({persona.title})</span>
              </Fragment>
            ))}
            {". "}
            <a href={withoutJob}>Show every job</a>{" · "}
          </>}
          {chosenActivities.length > 0 && <>
            {`Stories in ${listNames(chosenActivities.map(activity => activity.title))}. `}
            <a href={withoutActivity}>Show every activity</a>{" · "}
          </>}
          <a href={clearHref}>Clear filters</a>
        </p>
      )}
    </>
  );
}

export function StoryMapBoard({
  map,
  sourceBaseUrl,
  repositoryUrl,
  repositoryLinks,
  permalinkBase,
  theme = "light",
  preservedParams,
  locale = defaultLocale,
  timeZone,
  now,
  showVersion = true,
  exportHref,
  webAgents,
  personaEditing,
  storyEditing,
}: StoryMapBoardProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const internal = map.audience === "internal";
  const stalledAfterWeeks = map.audience === "internal" ? map.stalledAfterWeeks : undefined;
  const testsIndexed = map.audience === "internal" && map.testsIndexed === true;
  const changesIndexed = map.audience === "internal" && map.changesIndexed === true;
  const filtering = isFiltering(map.filter);
  const settings = dateFormatters(locale, timeZone, now ?? new Date());
  const links = repositoryLinker(repositoryUrl, repositoryLinks);
  const repository = githubRepository(repositoryUrl);
  const permalink = (target: { story: string } | { release: string }) => storyMapPermalink(target, { base: permalinkBase, preservedParams });

  const activityTitles = new Map(map.activities.map(activity => [activity.id, activity.title]));
  const releaseTitles = new Map(map.releases.map(release => [release.id, release.title]));
  const placed = (map.stories as InternalStoryCard[]).filter(story =>
    activityTitles.has(story.activity) && releaseTitles.has(story.release)
  );
  const panelIds = new Map(placed.map((story, index) => [story, `${baseId}-story-${index}`]));
  const panelIdsByStory = new Map(placed.map((story, index) => [story.id, `${baseId}-story-${index}`]));
  const panelIdOf = (story: InternalStoryCard) => present(panelIds.get(story), `the panel of story ${story.id}`);
  const internalReleases = map.audience === "internal" ? new Map(map.releases.map(release => [release.id, release])) : undefined;
  const impactLine = (id: string) => {
    const impact = internalReleases?.get(id)?.impact;
    return impact?.length ? <ImpactLine impact={impact} /> : null;
  };
  const estimateLine = (id: string) => {
    const estimates = internalReleases?.get(id)?.estimates;
    return estimates ? <ReleaseEstimate estimates={estimates} /> : null;
  };
  const lookup = personaLookup(map);
  const personaPanelIds = new Map([...lookup.personas.keys()].map((id, index) => [id, `${baseId}-persona-${index}`]));
  // Who each step of the journey serves, from the personas of its active stories, in map order.
  const activityPersonas = new Map<string, PersonaLabel[]>();
  if (lookup.personas.size) {
    for (const activity of map.activities) {
      const ids = new Set(placed.filter(story => story.activity === activity.id && isActiveStatus(story.status)).flatMap(story => story.personas ?? []));
      activityPersonas.set(activity.id, [...lookup.personas.values()].filter(persona => ids.has(persona.id)));
    }
  }

  // With Shipped as Released on, shipped stories leave their release's lane for one Released lane.
  // Each story keeps its release, so its panel, permalink and brief do not change.
  const combineShipped = internal && map.filter?.released === true;
  const laneOf = (story: InternalStoryCard) => combineShipped && story.status === "shipped" ? releasedLaneValue : story.release;
  const cells = new Map<string, InternalStoryCard[]>();
  const releaseCounts = new Map<string, number>();
  for (const story of placed) {
    const lane = laneOf(story);
    const key = `${lane}:${story.activity}`;
    const cell = cells.get(key);
    if (cell) cell.push(story);
    else cells.set(key, [story]);
    releaseCounts.set(lane, (releaseCounts.get(lane) ?? 0) + 1);
  }
  const releases = laneReleases(map.releases, placed, releaseCounts, filtering, combineShipped);
  const released = combineShipped ? releasedLane(placed.filter(story => laneOf(story) === releasedLaneValue)) : undefined;

  // Without filterStoryMapView, the board hides blocked and cut stories itself and offers a
  // checkbox to show them. CSS does the hiding, so it works without JavaScript and without
  // the host reading a query parameter. Browsers without :has() show every story.
  const inactive = { blocked: 0, cut: 0 };
  const activeCounts = new Map<string, number>();
  for (const story of placed) {
    if (isActiveStatus(story.status)) activeCounts.set(laneOf(story), (activeCounts.get(laneOf(story)) ?? 0) + 1);
    else inactive[story.status as keyof typeof inactive]++;
  }
  const hideInactive = !map.filter && (inactive.blocked > 0 || inactive.cut > 0);
  const toggleId = `${baseId}-show-inactive`;
  const showGrid = (releases.length > 0 || !!released) && (placed.length > 0 || (internal && !filtering));
  // The Personas tab needs the host to read the board's parameters, and is for internal viewers.
  // A map without personas still gets it, showing how to add them.
  const personaList = [...lookup.personas.values()];
  const tabs = internal && map.filter ? map.filter : undefined;
  const personasTab = tabs !== undefined && tabs.view === "personas";
  const analyticsTab = tabs !== undefined && tabs.view === "analytics";
  const actionsTab = tabs !== undefined && tabs.view === "actions";
  // Hand-built views from before the Actions tab may have no actions.
  const actionGroups = map.audience === "internal" ? map.actions ?? [] : [];
  const mapPath = map.audience === "internal" ? map.mapPath : undefined;
  const actionLinks: ActionLinks = {
    item(action) {
      if (action.item.type === "map") return { label: "The whole map" };
      const { type, id, title } = action.item;
      if (type === "story") return { href: permalink({ story: id }), label: `${id} ${title}` };
      if (type === "release") return { href: permalink({ release: id }), label: title };
      return { href: tabs && personaPageHref(tabs, id, preservedParams), label: title };
    },
    line: action => mapPath && action.line ? testHref(mapPath, action.line, sourceBaseUrl) : undefined,
  };
  const itemActionsHref = (id: string) => tabs && actionsHref(tabs, preservedParams, { item: id });
  // The story map's own parts are hidden on the other tabs.
  const otherTab = personasTab || actionsTab || analyticsTab;
  // The panel a permalink opens, which board.js shows on load. Customers have no release panels, so their release links only scroll.
  const linkedStoryId = map.filter?.story;
  const linkedReleaseId = map.filter?.release;
  const linkedStory = !otherTab && linkedStoryId ? placed.find(story => story.id === linkedStoryId) : undefined;
  const linkedReleaseIndex = !otherTab && internalReleases && showGrid && linkedReleaseId ? releases.findIndex(release => release.id === linkedReleaseId) : -1;
  const openPanel = linkedStory ? panelIds.get(linkedStory) : linkedReleaseIndex >= 0 ? `${baseId}-release-${linkedReleaseIndex}` : undefined;
  // The cards in one lane, a cell for each activity.
  const laneCells = (lane: string) => map.activities.map(activity => {
    const stories = cells.get(`${lane}:${activity.id}`) ?? [];
    return (
      <div
        className="esm-cell"
        role="cell"
        data-empty={stories.length ? undefined : ""}
        data-inactive-only={stories.length && stories.every(story => !isActiveStatus(story.status)) ? "" : undefined}
        key={activity.id}
      >
        <span className="esm-cell-label" aria-hidden="true">{activity.title}</span>
        {stories.map(story => (
          <button
            type="button"
            className="esm-card"
            id={storyMapAnchorId({ story: story.id })}
            aria-haspopup="dialog"
            data-inactive={isActiveStatus(story.status) ? undefined : ""}
            key={story.id}
            {...popoverTarget(panelIdOf(story))}
          >
            {internal && <CardHead story={story} personas={labelsFor(story.personas, lookup)} />}
            <span className="esm-card-title">{story.title}</span>
            <span className="esm-card-meta">
              <Status status={story.status} />
              {internal && <DependencyCount story={story} outstanding />}
              {internal && <CardTests story={story} />}
              {internal && (story.stalled && story.inProgressSince
                ? <StalledLabel since={story.inProgressSince} settings={settings} />
                : story.lastChangedAt && <ChangedAt at={story.lastChangedAt} settings={settings} />)}
            </span>
          </button>
        ))}
      </div>
    );
  });

  return (
    <section className="esm-board" data-theme={theme} data-hide-inactive={hideInactive ? "" : undefined} data-esm-open={openPanel} aria-labelledby={headingId}>
      <p className="esm-visually-hidden" role="status" data-esm-copy-status="" />
      <header className="esm-header">
        <p className="esm-eyebrow">{internal ? "User story map" : "Roadmap"}</p>
        <h2 id={headingId}>{map.title}</h2>
        {map.audience === "internal" && map.recentUpdates
          ? <RecentUpdates updates={map.recentUpdates} settings={settings} />
          : map.summary && <p className="esm-goal">{map.summary}</p>}
        {/* Without the filter toolbar, the Export button goes in the header. */}
        {internal && exportHref && !map.filter && <ExportMenu href={exportHref} />}
      </header>
      <div className="esm-frame">
        {tabs && (
          <BoardTabs
            current={personasTab ? "personas" : actionsTab ? "actions" : analyticsTab ? "analytics" : "map"}
            filter={tabs}
            preservedParams={preservedParams}
            stories={tabs.total}
            personas={personaList.length}
            actions={countStoryMapActions(actionGroups)}
          />
        )}
        {personasTab && <PersonasPage personas={personaList} filter={tabs} preservedParams={preservedParams} baseId={baseId} editing={personaEditing} />}
        {analyticsTab && map.audience === "internal" && <AnalyticsPage map={map} filter={tabs} preservedParams={preservedParams} settings={settings} baseId={baseId} />}
        {actionsTab && map.audience === "internal" && (
          <ActionsPage
            groups={actionGroups}
            filter={tabs}
            preservedParams={preservedParams}
            releases={map.releases}
            links={actionLinks}
            checkedAt={map.actionsCheckedAt ?? settings.now.toISOString()}
            settings={settings}
            baseId={baseId}
          />
        )}
        {!otherTab && map.filter && (
          <FilterToolbar
            filter={map.filter}
            shown={placed.length}
            preservedParams={preservedParams}
            showChanged={internal && !!map.history}
            internal={internal}
            stalledAfterWeeks={stalledAfterWeeks}
            exportHref={internal ? exportHref : undefined}
            personas={[...lookup.personas.values()]}
            customerPersonas={[...lookup.customer.values()]}
            activities={map.activities}
          />
        )}
        {!otherTab && hideInactive && (
          <p className="esm-inactive-toggle">
            <input type="checkbox" className="esm-inactive-input" id={toggleId} />
            <label htmlFor={toggleId}>Show blocked and cut stories ({hiddenSummary(inactive)})</label>
          </p>
        )}
        {otherTab ? null : showGrid ? (
          // biome-ignore lint/a11y/noNoninteractiveTabindex: the grid scrolls sideways, so keyboard users need to focus it to scroll it.
          <div className="esm-scroll" role="region" tabIndex={0} aria-label="Story map by release and activity">
            <div
              className="esm-grid"
              role="table"
              aria-label={`${map.title} by release and activity`}
              style={{ "--esm-columns": map.activities.length } as CSSProperties}
            >
              <div className="esm-row esm-activities" role="row">
                <div className="esm-corner" role="columnheader">Activities</div>
                {map.activities.map((activity, index) => (
                  <div className="esm-activity" role="columnheader" key={activity.id}>
                    <span className="esm-activity-title">{activity.title}</span>
                    {activity.summary && <span className="esm-activity-summary">{activity.summary}</span>}
                    <PersonaAvatars personas={activityPersonas.get(activity.id) ?? []} panelIds={personaPanelIds} />
                    {index < map.activities.length - 1 && (
                      <svg className="esm-icon esm-step" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m6 3.5 4.5 4.5L6 12.5" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
              {released && (
                <div className="esm-row esm-lane esm-released-lane" role="row" id={releasedLaneAnchor} data-lane={0}>
                  <div className="esm-release" role="rowheader">
                    <div className="esm-release-heading">
                      <ReleaseCollapse releaseId={releasedLaneValue} title="Released" />
                      <span className="esm-release-name">
                        <span className="esm-release-dot" aria-hidden="true" />
                        Released
                      </span>
                    </div>
                    <span className="esm-release-summary">{released.summary}</span>
                    <span className="esm-release-count">{storyCount(released.count)}</span>
                  </div>
                  {laneCells(releasedLaneValue)}
                </div>
              )}
              {releases.map((release, laneIndex) => (
                <div className="esm-row esm-lane" role="row" id={storyMapAnchorId({ release: release.id })} data-lane={(laneIndex + (released ? 1 : 0)) % 3} key={release.id}>
                  <div className="esm-release" role="rowheader">
                    <div className="esm-release-heading">
                      <ReleaseCollapse releaseId={release.id} title={release.title} />
                      <span className="esm-release-name">
                        <span className="esm-release-dot" aria-hidden="true" />
                        {internalReleases
                          ? <button type="button" className="esm-release-button" aria-haspopup="dialog" {...popoverTarget(`${baseId}-release-${laneIndex}`)}>{release.title}</button>
                          : release.title}
                      </span>
                    </div>
                    {release.summary && <span className="esm-release-summary">{release.summary}</span>}
                    {impactLine(release.id)}
                    {hideInactive && (activeCounts.get(release.id) ?? 0) !== (releaseCounts.get(release.id) ?? 0) ? <>
                      <span className="esm-release-count esm-count-active">{storyCount(activeCounts.get(release.id) ?? 0)}</span>
                      <span className="esm-release-count esm-count-all">{storyCount(releaseCounts.get(release.id) ?? 0)}</span>
                    </> : <span className="esm-release-count">{storyCount(releaseCounts.get(release.id) ?? 0)}</span>}
                    {estimateLine(release.id)}
                  </div>
                  {laneCells(release.id)}
                </div>
              ))}
            </div>
          </div>
        ) : !filtering && <p className="esm-empty">There are no stories to show yet.</p>}
      </div>
      {showVersion && <VersionFooter internal={internal} />}
      {!otherTab && placed.map(story => (
        <StoryDetail
          key={story.id}
          story={story}
          panelId={panelIdOf(story)}
          permalink={permalink({ story: story.id })}
          activityTitle={present(activityTitles.get(story.activity), `the activity of story ${story.id}`)}
          releaseTitle={present(releaseTitles.get(story.release), `the release of story ${story.id}`)}
          internal={internal}
          sourceBaseUrl={sourceBaseUrl}
          links={links}
          settings={settings}
          stalledAfterWeeks={stalledAfterWeeks}
          testsIndexed={testsIndexed}
          changesIndexed={changesIndexed}
          lookup={lookup}
          personaPanelIds={personaPanelIds}
          storyPanelIds={panelIdsByStory}
          releaseTitles={releaseTitles}
          webAgents={webAgents}
          repository={repository}
          editing={internal ? storyEditing || undefined : undefined}
          actions={internal ? { groups: actionGroups, links: actionLinks, tabHref: itemActionsHref(story.id) } : undefined}
        />
      ))}
      {!otherTab && personaList.map(persona => (
        <PersonaDetail
          key={persona.id}
          persona={persona}
          panelId={present(personaPanelIds.get(persona.id), `the panel of persona ${persona.id}`)}
          filter={map.filter}
          preservedParams={preservedParams}
          openHref={tabs && personaPageHref(tabs, persona.id, preservedParams)}
        />
      ))}
      {!otherTab && internalReleases && showGrid && releases.map((release, index) => (
        <ReleaseDetail
          key={release.id}
          release={present(internalReleases.get(release.id), `release ${release.id}`)}
          panelId={`${baseId}-release-${index}`}
          permalink={permalink({ release: release.id })}
          stories={placed.filter(story => story.release === release.id)}
          storyPanelIds={panelIds}
          filtered={!!map.filter}
          webAgents={webAgents}
          repository={repository}
          actions={{ groups: actionGroups, links: actionLinks, tabHref: itemActionsHref(release.id) }}
        />
      ))}
    </section>
  );
}
