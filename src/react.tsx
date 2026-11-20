import { useId, version } from "react";
import type { CSSProperties } from "react";
import { storyStatusLabels, storyStatuses, type StoryStatus } from "./status.js";
import type { InternalStoryCard, StoryMapView } from "./view.js";

export interface StoryMapBoardProps {
  map: StoryMapView;
  /** Base URL for repository-relative sources, such as `https://github.com/org/repo/blob/main/`. */
  sourceBaseUrl?: string;
  /** `light` by default. `auto` follows the viewer's colour scheme preference. */
  theme?: "light" | "dark" | "auto";
  /** Query parameters to keep when the filter form is submitted, such as a host's own page state. */
  preservedParams?: Readonly<Record<string, string>>;
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

function StatusIcon({ status }: { status: StoryStatus }) {
  return (
    <svg className="esm-icon" width="14" height="14" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      {status === "planned"
        ? <circle cx="8" cy="8" r="6.2" strokeDasharray="2.4 2.2" />
        : <circle cx="8" cy="8" r="6.2" />}
      {status === "in-progress" && <circle cx="8" cy="8" r="1.7" fill="currentColor" stroke="none" />}
      {status === "shipped" && <path d="m5.3 8.2 1.8 1.8 3.6-3.7" />}
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

function StoryDetail({ story, panelId, activityTitle, releaseTitle, internal, sourceBaseUrl }: {
  story: InternalStoryCard;
  panelId: string;
  activityTitle: string;
  releaseTitle: string;
  internal: boolean;
  sourceBaseUrl?: string;
}) {
  const titleId = `${panelId}-title`;
  const sources = internal ? resolveSources(story.sources, sourceBaseUrl) : [];
  const overview = sources.find(source => source.overview);
  const references = sources.filter(source => source !== overview);
  const hasEngineering = internal && !!(overview || story.notes || references.length);

  return (
    <div className="esm-detail" id={panelId} popover="auto" role="dialog" aria-labelledby={titleId}>
      <div className="esm-detail-head">
        <div>
          {internal && <p className="esm-card-id">{story.id}</p>}
          <h3 id={titleId}>{story.title}</h3>
        </div>
        <button type="button" className="esm-close" aria-label="Close" autoFocus {...popoverTarget(panelId, "hide")}>
          <svg className="esm-icon" width="18" height="18" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" aria-hidden="true">
            <path d="m4 4 8 8M12 4l-8 8" />
          </svg>
        </button>
      </div>
      <Status status={story.status} />
      {story.summary && <p className="esm-detail-summary">{story.summary}</p>}
      <dl className="esm-detail-context">
        <dt>Activity</dt>
        <dd>{activityTitle}</dd>
        <dt>Release</dt>
        <dd>{releaseTitle}</dd>
      </dl>
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
      {internal && story.updatedBy && <p className="esm-updater">Last updated by {story.updatedBy}</p>}
    </div>
  );
}

function storyCount(count: number) {
  return `${count} ${count === 1 ? "story" : "stories"}`;
}

function FilterToolbar({ filter, shown, preservedParams }: {
  filter: NonNullable<StoryMapView["filter"]>;
  shown: number;
  preservedParams?: Readonly<Record<string, string>>;
}) {
  const filtering = !!(filter.query || filter.status);
  const clearHref = `?${new URLSearchParams(preservedParams ?? {})}`;
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
          <select className="esm-select" name="status" aria-label="Filter by story status" defaultValue={filter.status ?? ""}>
            <option value="">All statuses</option>
            {storyStatuses.map(status => <option key={status} value={status}>{storyStatusLabels[status]}</option>)}
          </select>
          <button type="submit" className="esm-button">Apply</button>
        </form>
      </div>
      {filtering && (
        <p className="esm-filter-results" role="status">
          {shown === 0 ? "No stories match these filters." : `Showing ${shown} of ${storyCount(filter.total)}.`}{" "}
          <a href={clearHref}>Clear filters</a>
        </p>
      )}
    </>
  );
}

export function StoryMapBoard({ map, sourceBaseUrl, theme = "light", preservedParams }: StoryMapBoardProps) {
  const baseId = useId();
  const headingId = `${baseId}-heading`;
  const internal = map.audience === "internal";
  const filtering = !!(map.filter && (map.filter.query || map.filter.status));

  const activityTitles = new Map(map.activities.map(activity => [activity.id, activity.title]));
  const releaseTitles = new Map(map.releases.map(release => [release.id, release.title]));
  const placed = (map.stories as InternalStoryCard[]).filter(story =>
    activityTitles.has(story.activity) && releaseTitles.has(story.release)
  );
  const panelIds = new Map(placed.map((story, index) => [story, `${baseId}-story-${index}`]));

  const cells = new Map<string, InternalStoryCard[]>();
  const releaseCounts = new Map<string, number>();
  for (const story of placed) {
    const key = `${story.release}:${story.activity}`;
    cells.set(key, [...(cells.get(key) ?? []), story]);
    releaseCounts.set(story.release, (releaseCounts.get(story.release) ?? 0) + 1);
  }
  const releases = filtering ? map.releases.filter(release => releaseCounts.has(release.id)) : map.releases;
  const showGrid = releases.length > 0 && (placed.length > 0 || (internal && !filtering));

  return (
    <section className="esm-board" data-theme={theme} aria-labelledby={headingId}>
      <header className="esm-header">
        <p className="esm-eyebrow">{internal ? "User story map" : "Roadmap"}</p>
        <h2 id={headingId}>{map.title}</h2>
        {map.summary && <p className="esm-goal">{map.summary}</p>}
      </header>
      <div className="esm-frame">
        {map.filter && <FilterToolbar filter={map.filter} shown={placed.length} preservedParams={preservedParams} />}
        {showGrid ? (
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
                    {index < map.activities.length - 1 && (
                      <svg className="esm-icon esm-step" width="16" height="16" viewBox="0 0 16 16" fill="none" stroke="currentColor" strokeWidth="1.6" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
                        <path d="m6 3.5 4.5 4.5L6 12.5" />
                      </svg>
                    )}
                  </div>
                ))}
              </div>
              {releases.map((release, laneIndex) => (
                <div className="esm-row esm-lane" role="row" data-lane={laneIndex % 3} key={release.id}>
                  <div className="esm-release" role="rowheader">
                    <span className="esm-release-name"><span className="esm-release-dot" aria-hidden="true" />{release.title}</span>
                    {release.summary && <span className="esm-release-summary">{release.summary}</span>}
                    <span className="esm-release-count">{storyCount(releaseCounts.get(release.id) ?? 0)}</span>
                  </div>
                  {map.activities.map(activity => {
                    const stories = cells.get(`${release.id}:${activity.id}`) ?? [];
                    return (
                      <div className="esm-cell" role="cell" data-empty={stories.length ? undefined : ""} key={activity.id}>
                        <span className="esm-cell-label" aria-hidden="true">{activity.title}</span>
                        {stories.map(story => (
                          <button
                            type="button"
                            className="esm-card"
                            aria-haspopup="dialog"
                            key={story.id}
                            {...popoverTarget(panelIds.get(story)!)}
                          >
                            {internal && <span className="esm-card-id">{story.id}</span>}
                            <span className="esm-card-title">{story.title}</span>
                            <Status status={story.status} />
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
      {placed.map(story => (
        <StoryDetail
          key={story.id}
          story={story}
          panelId={panelIds.get(story)!}
          activityTitle={activityTitles.get(story.activity)!}
          releaseTitle={releaseTitles.get(story.release)!}
          internal={internal}
          sourceBaseUrl={sourceBaseUrl}
        />
      ))}
    </section>
  );
}
