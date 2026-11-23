/** What a permalink opens: one story or one release, by its ID in the viewer's view. */
export type StoryMapPermalinkTarget = { story: string } | { release: string };

/** The ID of the card or release lane a permalink scrolls to, such as `esm-story-ESM-801`. */
export function storyMapAnchorId(target: StoryMapPermalinkTarget) {
  return "story" in target ? `esm-story-${target.story}` : `esm-release-${target.release}`;
}

const placeholderOrigin = "http://story-map.invalid";

/**
 * A link that opens the board on one story's or release's panel, such as
 * `?story=ESM-801#esm-story-ESM-801`. `base` is the board page's URL or path; without
 * it the link is relative to the current page. The host's `preservedParams` are kept,
 * but no filters, so the link opens the same board for whoever follows it. Returns
 * undefined when `base` is not an http(s) URL or a path.
 */
export function storyMapPermalink(
  target: StoryMapPermalinkTarget,
  options: { base?: string; preservedParams?: Readonly<Record<string, string>> } = {},
): string | undefined {
  let url: URL;
  try {
    url = new URL(options.base ?? "", placeholderOrigin);
  } catch {
    return undefined;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return undefined;
  for (const [name, value] of Object.entries(options.preservedParams ?? {})) url.searchParams.set(name, value);
  url.searchParams.delete("story");
  url.searchParams.delete("release");
  if ("story" in target) url.searchParams.set("story", target.story);
  else url.searchParams.set("release", target.release);
  url.hash = storyMapAnchorId(target);
  if (url.origin !== placeholderOrigin) return url.href;
  // A path or nothing: keep the link relative, so it works behind any host name.
  return options.base ? `${url.pathname}${url.search}${url.hash}` : `${url.search}${url.hash}`;
}
