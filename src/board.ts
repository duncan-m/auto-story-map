/**
 * Optional browser script for the story map board. Load it with
 * `<script type="module" src="…/board.js">` on the page that renders the board.
 *
 * The board works without it: the filter form is a plain GET form with an
 * **Apply** button. With it, changing a filter applies it straight away and the
 * Apply button is hidden; the status and persona filters apply when their menus close. After
 * the page reloads, focus returns to the filter that was changed, so keyboard and
 * screen reader users keep their place. Menus close on Escape or a click elsewhere.
 * It also remembers which release lanes the viewer collapsed, and adds them to
 * the board's export links so the downloaded file matches, and which job lanes
 * they collapsed on the Personas tab. It opens the panel a permalink names, and
 * turns each panel's **Copy link** into a button that copies the permalink.
 */

const focusKey = "esm-filter-focus";
const enhanced = new WeakSet<HTMLFormElement>();

function remember(name: string) {
  try {
    sessionStorage.setItem(focusKey, name);
  } catch {
    // Storage can be unavailable, such as in a private window. Focus then starts at the top.
  }
}

function restoreFocus(form: HTMLFormElement) {
  let name: string | null = null;
  try {
    name = sessionStorage.getItem(focusKey);
    sessionStorage.removeItem(focusKey);
  } catch {
    return;
  }
  if (!name) return;
  // The status and persona filters are checkboxes in a menu, so focus returns to the menu button,
  // even when a map has a single persona and so a single checkbox.
  const field = form.elements.namedItem(name);
  const target = form.querySelector<HTMLElement>(`[data-esm-focus="${name}"]`) ?? (field instanceof HTMLElement ? field : null);
  target?.focus();
}

function submit(form: HTMLFormElement, field: HTMLInputElement | HTMLSelectElement) {
  remember(field.name);
  if (typeof form.requestSubmit === "function") form.requestSubmit();
  else form.submit();
}

/** Applies the board’s filters as soon as they change. Safe to call more than once. */
export function enhanceStoryMapFilters(root: ParentNode = document) {
  for (const form of root.querySelectorAll<HTMLFormElement>("form.esm-filters")) {
    if (enhanced.has(form)) continue;
    enhanced.add(form);
    form.dataset.esmAuto = "";
    const hint = form.querySelector<HTMLElement>("[data-esm-filter-hint]");
    if (hint) hint.textContent = "The board updates as soon as you choose an option. Status and persona choices apply when you close their list.";
    form.addEventListener("change", event => {
      if (event.target instanceof HTMLSelectElement) submit(form, event.target);
    });
    // The Apply button is hidden, so submit the search explicitly rather than
    // relying on the browser's implicit submission.
    form.addEventListener("keydown", event => {
      const target = event.target;
      if (event.key === "Enter" && target instanceof HTMLInputElement && target.type === "search") {
        event.preventDefault();
        submit(form, target);
      }
    });
    restoreFocus(form);
  }
}

const collapsedKeyPrefix = "esm-collapsed:";
const collapsedJobsKeyPrefix = "esm-collapsed-jobs:";
const enhancedBoards = new WeakSet<Element>();

function collapsedKey(prefix = collapsedKeyPrefix) {
  return prefix + (typeof location === "undefined" ? "" : location.pathname);
}

function readCollapsed(prefix = collapsedKeyPrefix): string[] {
  try {
    const value: unknown = JSON.parse(localStorage.getItem(collapsedKey(prefix)) ?? "[]");
    return Array.isArray(value) ? value.filter((id): id is string => typeof id === "string") : [];
  } catch {
    return [];
  }
}

function writeCollapsed(ids: string[], prefix = collapsedKeyPrefix) {
  try {
    if (ids.length) localStorage.setItem(collapsedKey(prefix), JSON.stringify(ids));
    else localStorage.removeItem(collapsedKey(prefix));
  } catch {
    // Storage can be unavailable. Collapsing still works, but resets on reload.
  }
}

/** Sets `collapsed` on the board's export links to the lanes collapsed on that board. */
function updateExportLinks(board: Element) {
  const ids = [...board.querySelectorAll<HTMLInputElement>("input.esm-collapse-input")].filter(input => input.checked).map(input => input.value);
  for (const link of board.querySelectorAll<HTMLAnchorElement>("a[data-esm-export]")) {
    const href = link.dataset.esmExport ?? "";
    if (!ids.length) {
      link.setAttribute("href", href);
      continue;
    }
    const hash = href.indexOf("#");
    const [path, fragment] = hash === -1 ? [href, ""] : [href.slice(0, hash), href.slice(hash)];
    link.setAttribute("href", `${path}${path.includes("?") ? "&" : "?"}collapsed=${ids.map(encodeURIComponent).join(",")}${fragment}`);
  }
}

/** The kinds of lane a viewer can collapse: the checkbox class and where its choices are kept. */
const laneKinds = [
  { input: "esm-collapse-input", prefix: collapsedKeyPrefix },
  { input: "esm-job-collapse-input", prefix: collapsedJobsKeyPrefix },
] as const;

/**
 * Remembers which release lanes, and which job lanes on the Personas tab, the viewer
 * collapsed, per page, so they stay collapsed when a filter or link reloads the page,
 * and keeps the export links in step. Safe to call more than once.
 */
export function enhanceStoryMapReleases(root: ParentNode = document) {
  for (const board of root.querySelectorAll(".esm-board")) {
    if (enhancedBoards.has(board)) continue;
    enhancedBoards.add(board);
    for (const kind of laneKinds) {
      const collapsed = new Set(readCollapsed(kind.prefix));
      for (const input of board.querySelectorAll<HTMLInputElement>(`input.${kind.input}`)) {
        if (collapsed.has(input.value)) input.checked = true;
      }
    }
    updateExportLinks(board);
    board.addEventListener("change", event => {
      const target = event.target;
      if (!(target instanceof HTMLInputElement)) return;
      const kind = laneKinds.find(entry => target.classList.contains(entry.input));
      if (!kind) return;
      // Read storage again so two boards on one page do not overwrite each other.
      const ids = new Set(readCollapsed(kind.prefix));
      if (target.checked) ids.add(target.value);
      else ids.delete(target.value);
      writeCollapsed([...ids], kind.prefix);
      updateExportLinks(board);
    });
  }
}

const enhancedMenus = new WeakSet<Element>();

/**
 * Closes the board's menus (the status and persona filters, and Export) on Escape
 * or a click elsewhere, and the Export menu after a choice. When a filter menu
 * closes with a changed choice, it submits the filter form. Safe to call more than once.
 */
export function enhanceStoryMapMenus(root: ParentNode = document) {
  for (const menu of root.querySelectorAll<HTMLDetailsElement>("details.esm-menu")) {
    if (enhancedMenus.has(menu)) continue;
    enhancedMenus.add(menu);
    const close = (focus: boolean) => {
      if (!menu.open) return;
      menu.open = false;
      if (focus) menu.querySelector<HTMLElement>("summary")?.focus();
    };
    menu.addEventListener("keydown", event => {
      if (event.key === "Escape") close(true);
    });
    menu.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest("a")) close(false);
    });
    document.addEventListener("click", event => {
      if (!(event.target instanceof Node) || !menu.contains(event.target)) close(false);
    });

    const form = menu.closest("form");
    if (!form || !menu.querySelector("input[type=checkbox]")) continue;
    let changed = false;
    menu.addEventListener("change", () => {
      changed = true;
    });
    menu.addEventListener("toggle", () => {
      if (menu.open || !changed) return;
      changed = false;
      remember(menu.querySelector<HTMLElement>("[data-esm-focus]")?.dataset.esmFocus ?? "status");
      if (typeof form.requestSubmit === "function") form.requestSubmit();
      else form.submit();
    });
  }
}

const enhancedPermalinks = new WeakSet<Element>();
const copiedMs = 2000;

/** Says something in the board's live region, clearing it first so the same words are announced again. */
function announce(board: Element, message: string) {
  const status = board.querySelector("[data-esm-copy-status]");
  if (!status) return;
  status.textContent = "";
  setTimeout(() => { status.textContent = message; }, 50);
}

/**
 * Opens the story or release panel a permalink names, from the board's `data-esm-open`,
 * expanding its lane if the viewer had collapsed it, without changing what is remembered.
 * Turns each panel's **Copy link** into a button that copies the permalink and says
 * “Link copied”. Without clipboard access, it stays a plain link. Safe to call more than once.
 */
export function enhanceStoryMapPermalinks(root: ParentNode = document) {
  for (const board of root.querySelectorAll<HTMLElement>(".esm-board")) {
    if (enhancedPermalinks.has(board)) continue;
    enhancedPermalinks.add(board);

    const panelId = board.dataset.esmOpen;
    const panel = panelId ? document.getElementById(panelId) : null;
    if (panelId && panel && board.contains(panel)) {
      const opener = board.querySelector(`[popovertarget="${CSS.escape(panelId)}"]`);
      const collapse = opener?.closest(".esm-lane")?.querySelector<HTMLInputElement>("input.esm-collapse-input");
      if (collapse?.checked) collapse.checked = false;
      try {
        if (!panel.matches(":popover-open")) panel.showPopover();
      } catch {
        // Browsers without popovers keep the card highlighted by :target instead.
      }
    }

    if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) continue;
    board.addEventListener("click", event => {
      const link = event.target instanceof Element ? event.target.closest<HTMLAnchorElement>("a[data-esm-copy-link]") : null;
      // Let modified clicks open the link in a new tab or window.
      if (!link || event.button !== 0 || event.metaKey || event.ctrlKey || event.shiftKey || event.altKey) return;
      event.preventDefault();
      const url = new URL(link.getAttribute("href") ?? "", location.href).href;
      navigator.clipboard.writeText(url).then(() => {
        const label = link.querySelector("[data-esm-copy-label]");
        if (label) label.textContent = "Link copied";
        link.dataset.copied = "";
        announce(board, "Link copied");
        setTimeout(() => {
          if (label) label.textContent = "Copy link";
          delete link.dataset.copied;
        }, copiedMs);
      }, () => announce(board, "Could not copy the link. Open the link's menu to copy it."));
    });
  }
}

function enhance() {
  enhanceStoryMapFilters();
  enhanceStoryMapReleases();
  enhanceStoryMapMenus();
  enhanceStoryMapPermalinks();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }
}
