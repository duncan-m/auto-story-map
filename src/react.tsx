import { useId } from "react";
import type { InternalStoryCard, StoryMapView } from "./view.js";

const labels = { planned: "Planned", "in-progress": "In progress", shipped: "Shipped" };

function findEngineeringOverview(sources: readonly string[] | undefined, sourceBaseUrl?: string) {
  for (const source of sources ?? []) {
    let url: URL;
    try {
      url = new URL(source, sourceBaseUrl);
    } catch {
      continue;
    }
    const isWebUrl = url.protocol === "https:" || url.protocol === "http:";
    if (isWebUrl && url.pathname.toLowerCase().endsWith(".md") && url.hash) {
      return url.href;
    }
  }
}

function Card({ story, activityTitle, releaseTitle, internal, sourceBaseUrl }: {
  story: InternalStoryCard;
  activityTitle: string;
  releaseTitle: string;
  internal: boolean;
  sourceBaseUrl?: string;
}) {
  const titleId = useId();
  const overview = internal ? findEngineeringOverview(story.sources, sourceBaseUrl) : undefined;
  const references = overview ? undefined : story.sources;

  return (
    <article className="esm-card" aria-labelledby={titleId}>
      <details>
        <summary className="esm-card-toggle">
          {internal && <span className="esm-id">{story.id}</span>}
          <span className="esm-card-title" id={titleId}>{story.title}</span>
          {story.summary && <span className="esm-card-summary">{story.summary}</span>}
          <span className="esm-status" data-status={story.status}>{labels[story.status]}</span>
          {internal && story.updatedBy && <span className="esm-updater">Last updated by {story.updatedBy}</span>}
        </summary>
        <div className="esm-card-content">
          <dl className="esm-card-context">
            <dt>Activity</dt>
            <dd>{activityTitle}</dd>
            <dt>Release</dt>
            <dd>{releaseTitle}</dd>
          </dl>
          {overview && (
            <a className="esm-overview-link" href={overview} aria-label={`Engineering overview for ${story.title}`}>
              Engineering overview
            </a>
          )}
          {internal && (story.notes || references?.length) ? (
            <div className="esm-notes">
              <h3>{overview ? "Engineering notes" : "Engineering details"}</h3>
              {story.notes && <p>{story.notes}</p>}
              {!!references?.length && <ul>{references.map((source, index) => <li key={index}><code>{source}</code></li>)}</ul>}
            </div>
          ) : null}
        </div>
      </details>
    </article>
  );
}

export function StoryMapBoard({ map, sourceBaseUrl }: { map: StoryMapView; sourceBaseUrl?: string }) {
  const headingId = useId();
  const internal = map.audience === "internal";

  const cells = new Map<string, InternalStoryCard[]>();
  for (const story of map.stories) {
    const key = `${story.release}:${story.activity}`;
    const cell = cells.get(key);
    if (cell) cell.push(story);
    else cells.set(key, [story]);
  }

  return (
    <section className="esm-board" aria-labelledby={headingId}>
      <header className="esm-header">
        <h2 id={headingId}>{map.title}</h2>
        {map.summary && <p>{map.summary}</p>}
      </header>
      {map.stories.length > 0 || internal ? (
        <div className="esm-scroll" role="region" tabIndex={0} aria-label="Story map by release and activity">
          <table className="esm-table">
            <thead>
              <tr>
                <th scope="col" className="esm-corner">Release</th>
                {map.activities.map(activity => (
                  <th scope="col" key={activity.id}>
                    <span>{activity.title}</span>
                    {activity.summary && <small>{activity.summary}</small>}
                  </th>
                ))}
              </tr>
            </thead>
            <tbody>
              {map.releases.map(release => (
                <tr key={release.id}>
                  <th scope="row">
                    <span>{release.title}</span>
                    {release.summary && <small>{release.summary}</small>}
                  </th>
                  {map.activities.map(activity => (
                    <td key={activity.id}>
                      {(cells.get(`${release.id}:${activity.id}`) ?? []).map(story => (
                        <Card
                          key={story.id}
                          story={story}
                          activityTitle={activity.title}
                          releaseTitle={release.title}
                          internal={internal}
                          sourceBaseUrl={sourceBaseUrl}
                        />
                      ))}
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      ) : <p className="esm-empty">There are no stories to show yet.</p>}
    </section>
  );
}
