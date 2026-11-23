import { Fragment, useId, version } from "react";
import type { CSSProperties, ReactNode } from "react";
import { activeStoryStatuses, customerStoryStatuses, isActiveStatus, storyStatusLabels, storyStatuses, type StoryStatus, type StoryStatusFilter } from "./status.js";
import { releaseEstimatesText } from "./export.js";
import { jobStepGaps, withoutFinalPunctuation } from "./personas.js";
import { storyMapAnchorId, storyMapPermalink } from "./permalink.js";
import type { ReleaseImpact, StoryMapJob } from "./schema.js";
import { storyMapAuthor, storyMapCommit, storyMapLicense, storyMapRepositoryUrl, storyMapVersion } from "./version.js";
import type { InternalReleaseLabel, InternalStoryCard, PersonaJobLabel, PersonaLabel, ReleaseEstimates, StoryChangeEntry, StoryHistoryEntry, StoryMapLabel, StoryMapRecentUpdates, StoryMapView, StoryTestLink } from "./view.js";

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
}

interface DateSettings {
  now: Date;
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
  const pullRequest = change.pullRequest !== undefined;
  const href = (pullRequest ? links.pullRequest(change.pullRequest!) : undefined) ?? links.commit(change.commit);
  const label = pullRequest ? `#${change.pullRequest}` : shortHash(change.commit);
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
    if (!entry) files.set(file, entry = { tests: [], more: 0 });
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
                      {test.kind === "group" ? "All tests in this group · " : ""}line {test.line}
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

function StoryDetail({ story, panelId, permalink, activityTitle, releaseTitle, internal, sourceBaseUrl, links, settings, stalledAfterWeeks, testsIndexed, changesIndexed, lookup, personaPanelIds }: {
  story: InternalStoryCard;
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
          <CopyLink href={permalink} label="this story" />
          <CloseButton panelId={panelId} />
        </div>
      </div>
      <Status status={story.status} />
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
      {story.summary && <p className="esm-detail-summary">{story.summary}</p>}
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
        {internal && story.estimate !== undefined && <><dt>Estimate</dt><dd>{points(story.estimate)}</dd></>}
      </dl>
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

/** The card's ID, with its persona avatars and estimate to the right when it has them. */
function CardHead({ story, personas }: { story: InternalStoryCard; personas: readonly PersonaLabel[] }) {
  const id = <span className="esm-card-id">{story.id}</span>;
  if (!personas.length && story.estimate === undefined) return id;
  const estimate = story.estimate !== undefined && <Estimate estimate={story.estimate} />;
  return (
    <span className="esm-card-head">
      {id}
      {personas.length ? <span className="esm-card-tags"><PersonaAvatars personas={personas} />{estimate}</span> : estimate}
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

function CloseButton({ panelId }: { panelId: string }) {
  return (
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
  return [
    `${counts.shipped} of ${storyCount(kept)} shipped`,
    counts.merged && `${counts.merged} merged`,
    counts.blocked && `${counts.blocked} blocked`,
    counts.cut && `${counts.cut} cut`,
  ].filter(Boolean).join(", ") + ".";
}

function paragraphs(text: string) {
  return text.split(/\n[ \t]*\n/).map(paragraph => paragraph.trim()).filter(Boolean);
}

function ReleaseDetail({ release, panelId, permalink, stories, storyPanelIds, filtered }: {
  release: InternalReleaseLabel;
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
          <CopyLink href={permalink} label="this release" />
          <CloseButton panelId={panelId} />
        </div>
      </div>
      {release.summary && <p className="esm-detail-summary">{release.summary}</p>}
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
                  <button type="button" className="esm-release-story" aria-haspopup="dialog" {...popoverTarget(storyPanelIds.get(story)!)}>
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
        {gaps > 0 && <span className="esm-job-gap">{`${gaps} of ${job.steps!.length} ${job.steps!.length === 1 ? "step" : "steps"} ${gaps === 1 ? "has" : "have"} no stories`}</span>}
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
      {persona.summary && <p className="esm-detail-summary">{persona.summary}</p>}
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
function JobStatementLines({ job, id }: { job: StoryMapJob; id: string }) {
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
function JobLane({ job, laneId, base }: { job: PersonaJobLabel; laneId: string; base?: URLSearchParams }) {
  const statementId = `${laneId}-statement`;
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
        {(job.core || job.draft) && (
          <p className="esm-job-labels">
            {job.core && <CoreJobLabel />}
            {job.draft && <DraftLabel />}
          </p>
        )}
        <JobStatementLines job={job} id={statementId} />
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
            const gap = step.activity !== undefined && !step.activeStories;
            const stepParams = base && step.activity !== undefined ? new URLSearchParams(base) : undefined;
            stepParams?.append("job", job.id);
            stepParams?.append("activity", step.activity!);
            return (
              <li className="esm-step-card" data-gap={gap ? "" : undefined} key={index}>
                <span className="esm-step-title"><span className="esm-step-num" aria-hidden="true">{index + 1}</span>{step.title}</span>
                {step.summary && <span className="esm-step-text">{step.summary}</span>}
                {step.activity !== undefined && (
                  <span className="esm-step-cov">
                    {gap
                      ? <span className="esm-job-gap">No stories yet</span>
                      : stepParams
                        ? <a href={`?${stepParams}`}>{storyCount(step.activeStories!)}</a>
                        : <span>{storyCount(step.activeStories!)}</span>}
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

/** What the persona is judged on, what they use today and their constraints, side by side. */
function PersonaContext({ persona, baseId }: { persona: PersonaLabel; baseId: string }) {
  const context = persona.context;
  if (!context) return null;
  const parts = [
    context.success && { key: "success", title: "Success means", body: <p>{context.success}</p> },
    context.usesToday?.length && { key: "uses", title: "Uses today", body: <ul className="esm-uses">{context.usesToday.map((item, index) => <li key={index}>{item}</li>)}</ul> },
    context.constraints?.length && { key: "constraints", title: "Constraints", body: <ul>{context.constraints.map((item, index) => <li key={index}>{item}</li>)}</ul> },
  ].filter(part => !!part) as { key: string; title: string; body: ReactNode }[];
  return (
    <div className="esm-context-band">
      {parts.map((part, index) => (
        <section className="esm-context-card" key={part.key} aria-labelledby={`${baseId}-${part.key}`}>
          <h4 id={`${baseId}-${part.key}`}>{part.title}{index === 0 && context.draft && <DraftLabel />}</h4>
          {part.body}
        </section>
      ))}
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
 * The Story map and Personas tabs, as links, so they work without JavaScript.
 * Each keeps the viewer's filters, so going back to the map keeps them.
 */
function BoardTabs({ current, filter, preservedParams, stories, personas }: {
  current: "map" | "personas";
  filter: NonNullable<StoryMapView["filter"]>;
  preservedParams?: Readonly<Record<string, string>>;
  stories: number;
  personas: number;
}) {
  const params = boardParams(filter, preservedParams);
  const personasParams = new URLSearchParams(params);
  personasParams.set("view", "personas");
  const tab = (page: "map" | "personas", href: string, label: string, count: number, counted: string) => (
    <a className="esm-tab" href={href} aria-current={current === page ? "page" : undefined}>
      {label}
      <span className="esm-tab-count"><span aria-hidden="true">{count}</span><span className="esm-visually-hidden">{`, ${counted}`}</span></span>
    </a>
  );
  return (
    <nav className="esm-tabs" aria-label="Board views">
      {tab("map", `?${params}`, "Story map", stories, storyCount(stories))}
      {tab("personas", `?${personasParams}`, "Personas", personas, plural(personas, "persona"))}
      <span className="esm-tabs-end">Internal only. Customers see the story map.</span>
    </nav>
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
function PersonasPage({ personas, filter, preservedParams, baseId }: {
  personas: readonly PersonaLabel[];
  filter: NonNullable<StoryMapView["filter"]>;
  preservedParams?: Readonly<Record<string, string>>;
  baseId: string;
}) {
  const persona = personas.find(item => item.id === filter.persona?.[0]) ?? personas[0];
  const base = filterParams(filter, preservedParams);
  const titleId = `${baseId}-persona-title`;
  const jobsId = `${baseId}-persona-jobs`;
  const links = personas.map(item => ({ item, href: personaPageHref(filter, item.id, preservedParams) }));
  return (
    <div className="esm-persona-page">
      <details className="esm-menu esm-persona-picker">
        <summary className="esm-select esm-menu-button">
          <span className="esm-visually-hidden">Persona: </span><PersonaAvatar persona={persona} />{persona.title}
        </summary>
        <ul className="esm-menu-panel">
          {links.map(({ item, href }) => <li key={item.id}><PersonaLink persona={item} href={href} current={item === persona} /></li>)}
        </ul>
      </details>
      <nav className="esm-persona-list" aria-labelledby={`${baseId}-persona-list`}>
        <p className="esm-persona-list-label" id={`${baseId}-persona-list`}>Personas</p>
        <ul>
          {links.map(({ item, href }) => <li key={item.id}><PersonaLink persona={item} href={href} current={item === persona} /></li>)}
        </ul>
      </nav>
      <article className="esm-persona-main" aria-labelledby={titleId}>
        <div className="esm-persona-title">
          <span className="esm-avatar esm-avatar-lg" data-persona={persona.colour} aria-hidden="true">{persona.initials}</span>
          <div className="esm-persona-title-text">
            <h3 id={titleId}>{persona.title}</h3>
            {persona.summary && <p>{persona.summary}</p>}
          </div>
          <p className="esm-persona-title-end">
            <a href={withIds(base, "persona", [persona.id])}>Show their stories on the map<span aria-hidden="true"> →</span></a>
            <span>{`${plural(persona.jobs.length, "job")} · ${plural(persona.activeStories, "active story", "active stories")}`}</span>
          </p>
        </div>
        <PersonaContext persona={persona} baseId={`${baseId}-context`} />
        <section className="esm-persona-jobs" aria-labelledby={jobsId}>
          <h4 className="esm-section-title" id={jobsId}>Jobs to be done {persona.jobs.length > 0 && <span>Core job first, each with its steps in order</span>}</h4>
          {persona.jobs.length
            ? (
              <ul className="esm-job-lanes">
                {persona.jobs.map((job, index) => <JobLane key={job.id} job={job} laneId={`${baseId}-job-${index}`} base={base} />)}
              </ul>
            )
            : <p className="esm-release-hidden">No jobs to be done yet.</p>}
        </section>
      </article>
    </div>
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

/** Adds a query parameter to a URL that may be relative, keeping any fragment. */
function withParam(href: string, name: string, value: string) {
  const hash = href.indexOf("#");
  const [path, fragment] = hash === -1 ? [href, ""] : [href.slice(0, hash), href.slice(hash)];
  return `${path}${path.includes("?") ? "&" : "?"}${name}=${encodeURIComponent(value)}${fragment}`;
}

/**
 * An Export button that opens a menu of links to the host's export route. A
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
  const narrowsStatus = !!filter?.status && !storyStatuses.every(choice => filter.status!.includes(choice));
  return !!(filter && (filter.query || narrowsStatus || filter.changedWithinDays || filter.persona?.length || filter.job?.length || filter.activity?.length));
}

/** The host's parameters and the search, status and “changed in” filters, for links that change only the persona or job. */
function filterParams(filter: NonNullable<StoryMapView["filter"]>, preservedParams?: Readonly<Record<string, string>>) {
  const params = new URLSearchParams(preservedParams ?? {});
  if (filter.query) params.set("q", filter.query);
  for (const status of filter.status ?? []) params.append("status", status);
  if (filter.changedWithinDays) params.set("changed", `${filter.changedWithinDays}d`);
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
  const permalink = (target: { story: string } | { release: string }) => storyMapPermalink(target, { base: permalinkBase, preservedParams });

  const activityTitles = new Map(map.activities.map(activity => [activity.id, activity.title]));
  const releaseTitles = new Map(map.releases.map(release => [release.id, release.title]));
  const placed = (map.stories as InternalStoryCard[]).filter(story =>
    activityTitles.has(story.activity) && releaseTitles.has(story.release)
  );
  const panelIds = new Map(placed.map((story, index) => [story, `${baseId}-story-${index}`]));
  const internalReleases = map.audience === "internal" ? new Map(map.releases.map(release => [release.id, release])) : undefined;
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

  const cells = new Map<string, InternalStoryCard[]>();
  const releaseCounts = new Map<string, number>();
  for (const story of placed) {
    const key = `${story.release}:${story.activity}`;
    const cell = cells.get(key);
    if (cell) cell.push(story);
    else cells.set(key, [story]);
    releaseCounts.set(story.release, (releaseCounts.get(story.release) ?? 0) + 1);
  }
  const releases = filtering ? map.releases.filter(release => releaseCounts.has(release.id)) : map.releases;

  // Without filterStoryMapView, the board hides blocked and cut stories itself and offers a
  // checkbox to show them. CSS does the hiding, so it works without JavaScript and without
  // the host reading a query parameter. Browsers without :has() show every story.
  const inactive = { blocked: 0, cut: 0 };
  const activeCounts = new Map<string, number>();
  for (const story of placed) {
    if (isActiveStatus(story.status)) activeCounts.set(story.release, (activeCounts.get(story.release) ?? 0) + 1);
    else inactive[story.status as keyof typeof inactive]++;
  }
  const hideInactive = !map.filter && (inactive.blocked > 0 || inactive.cut > 0);
  const toggleId = `${baseId}-show-inactive`;
  const showGrid = releases.length > 0 && (placed.length > 0 || (internal && !filtering));
  // The Personas tab needs the host to read the board's parameters, and is for internal viewers of maps with personas.
  const personaList = [...lookup.personas.values()];
  const tabs = internal && map.filter && personaList.length > 0 ? map.filter : undefined;
  const personasTab = !!tabs && tabs.view === "personas";
  // The panel a permalink opens, which board.js shows on load. Customers have no release panels, so their release links only scroll.
  const linkedStory = !personasTab && map.filter?.story ? placed.find(story => story.id === map.filter!.story) : undefined;
  const linkedReleaseIndex = !personasTab && internalReleases && showGrid && map.filter?.release ? releases.findIndex(release => release.id === map.filter!.release) : -1;
  const openPanel = linkedStory ? panelIds.get(linkedStory) : linkedReleaseIndex >= 0 ? `${baseId}-release-${linkedReleaseIndex}` : undefined;

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
            current={personasTab ? "personas" : "map"}
            filter={tabs}
            preservedParams={preservedParams}
            stories={tabs.total}
            personas={personaList.length}
          />
        )}
        {personasTab && <PersonasPage personas={personaList} filter={tabs!} preservedParams={preservedParams} baseId={baseId} />}
        {!personasTab && map.filter && (
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
        {!personasTab && hideInactive && (
          <p className="esm-inactive-toggle">
            <input type="checkbox" className="esm-inactive-input" id={toggleId} />
            <label htmlFor={toggleId}>Show blocked and cut stories ({hiddenSummary(inactive)})</label>
          </p>
        )}
        {personasTab ? null : showGrid ? (
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
              {releases.map((release, laneIndex) => (
                <div className="esm-row esm-lane" role="row" id={storyMapAnchorId({ release: release.id })} data-lane={laneIndex % 3} key={release.id}>
                  <div className="esm-release" role="rowheader">
                    <ReleaseCollapse releaseId={release.id} title={release.title} />
                    <span className="esm-release-name">
                      <span className="esm-release-dot" aria-hidden="true" />
                      {internalReleases
                        ? <button type="button" className="esm-release-button" aria-haspopup="dialog" {...popoverTarget(`${baseId}-release-${laneIndex}`)}>{release.title}</button>
                        : release.title}
                    </span>
                    {release.summary && <span className="esm-release-summary">{release.summary}</span>}
                    {!!internalReleases?.get(release.id)?.impact?.length && <ImpactLine impact={internalReleases.get(release.id)!.impact!} />}
                    {hideInactive && (activeCounts.get(release.id) ?? 0) !== (releaseCounts.get(release.id) ?? 0) ? <>
                      <span className="esm-release-count esm-count-active">{storyCount(activeCounts.get(release.id) ?? 0)}</span>
                      <span className="esm-release-count esm-count-all">{storyCount(releaseCounts.get(release.id) ?? 0)}</span>
                    </> : <span className="esm-release-count">{storyCount(releaseCounts.get(release.id) ?? 0)}</span>}
                    {internalReleases?.get(release.id)?.estimates && <ReleaseEstimate estimates={internalReleases.get(release.id)!.estimates!} />}
                  </div>
                  {map.activities.map(activity => {
                    const stories = cells.get(`${release.id}:${activity.id}`) ?? [];
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
                            {...popoverTarget(panelIds.get(story)!)}
                          >
                            {internal && <CardHead story={story} personas={labelsFor(story.personas, lookup)} />}
                            <span className="esm-card-title">{story.title}</span>
                            <span className="esm-card-meta">
                              <Status status={story.status} />
                              {internal && <CardTests story={story} />}
                              {internal && (story.stalled && story.inProgressSince
                                ? <StalledLabel since={story.inProgressSince} settings={settings} />
                                : story.lastChangedAt && <ChangedAt at={story.lastChangedAt} settings={settings} />)}
                            </span>
                          </button>
                        ))}
                      </div>
                    );
                  })}
                </div>
              ))}
            </div>
          </div>
        ) : !filtering && <p className="esm-empty">There are no stories to show yet.</p>}
      </div>
      {showVersion && <VersionFooter internal={internal} />}
      {!personasTab && placed.map(story => (
        <StoryDetail
          key={story.id}
          story={story}
          panelId={panelIds.get(story)!}
          permalink={permalink({ story: story.id })}
          activityTitle={activityTitles.get(story.activity)!}
          releaseTitle={releaseTitles.get(story.release)!}
          internal={internal}
          sourceBaseUrl={sourceBaseUrl}
          links={links}
          settings={settings}
          stalledAfterWeeks={stalledAfterWeeks}
          testsIndexed={testsIndexed}
          changesIndexed={changesIndexed}
          lookup={lookup}
          personaPanelIds={personaPanelIds}
        />
      ))}
      {!personasTab && personaList.map(persona => (
        <PersonaDetail
          key={persona.id}
          persona={persona}
          panelId={personaPanelIds.get(persona.id)!}
          filter={map.filter}
          preservedParams={preservedParams}
          openHref={tabs && personaPageHref(tabs, persona.id, preservedParams)}
        />
      ))}
      {!personasTab && internalReleases && showGrid && releases.map((release, index) => (
        <ReleaseDetail
          key={release.id}
          release={internalReleases.get(release.id)!}
          panelId={`${baseId}-release-${index}`}
          permalink={permalink({ release: release.id })}
          stories={placed.filter(story => story.release === release.id)}
          storyPanelIds={panelIds}
          filtered={!!map.filter}
        />
      ))}
    </section>
  );
}
