import { useId } from "react";
import type { InternalStoryCard, StoryMapView } from "./view.js";

const labels = { planned: "Planned", "in-progress": "In progress", shipped: "Shipped" };

function Card({ story, internal }: { story: InternalStoryCard; internal: boolean }) {
  return (
    <article className="esm-card">
      {internal && <span className="esm-id">{story.id}</span>}
      <h3>{story.title}</h3>
      {story.summary && <p>{story.summary}</p>}
      <span className="esm-status" data-status={story.status}>{labels[story.status]}</span>
      {internal && story.updatedBy && <p className="esm-updater">Last updated by {story.updatedBy}</p>}
      {internal && (story.notes || story.sources?.length) ? (
        <details className="esm-notes">
          <summary>Engineering details</summary>
          {story.notes && <p>{story.notes}</p>}
          {!!story.sources?.length && <ul>{story.sources.map((source, index) => <li key={index}><code>{source}</code></li>)}</ul>}
        </details>
      ) : null}
    </article>
  );
}

export function StoryMapBoard({ map }: { map: StoryMapView }) {
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
                        <Card key={story.id} story={story} internal={internal} />
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
