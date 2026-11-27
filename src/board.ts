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
 * turns each panel's **Copy link** into a button that copies the permalink. It builds the
 * `story-map edit` command for the story panel's **Change** pickers, to copy. It keeps
 * release names in view beside their lanes, and shrinks the activity row as the grid scrolls.
 * On `story-map preview` it lets the Personas tab edit personas in place. On a host's
 * board opened from `localhost` without a save route, it notes that editing is not set up.
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

const enhancedGrids = new WeakSet<Element>();

/**
 * Keeps the grid's headings in view. Measures the activity row and release column for CSS,
 * and sets `data-esm-stuck`, which shrinks the row to its titles, once the grid has scrolled
 * by the height that saves. Safe to call more than once.
 */
export function enhanceStoryMapHeadings(root: ParentNode = document) {
  for (const box of root.querySelectorAll<HTMLElement>(".esm-scroll")) {
    const row = box.querySelector<HTMLElement>(".esm-activities");
    const corner = box.querySelector<HTMLElement>(".esm-corner");
    if (!row || !corner || enhancedGrids.has(box)) continue;
    enhancedGrids.add(box);
    const set = (name: string, pixels: number) => box.style.setProperty(name, `${pixels}px`);
    let saved = 0;
    const update = () => {
      // Shrinking hides the persona avatars, so wait while one of them has focus.
      const stuck = saved > 0 && box.scrollTop >= saved && !row.contains(document.activeElement);
      if (box.hasAttribute("data-esm-stuck") !== stuck) box.toggleAttribute("data-esm-stuck", stuck);
      set("--esm-activities-height", row.getBoundingClientRect().height);
    };
    const measure = () => {
      box.removeAttribute("data-esm-stuck");
      const full = row.getBoundingClientRect().height;
      box.setAttribute("data-esm-stuck", "");
      saved = full - row.getBoundingClientRect().height;
      set("--esm-activities-saved", saved);
      set("--esm-labels-width", corner.getBoundingClientRect().width);
      update();
    };
    measure();
    box.addEventListener("scroll", update, { passive: true });
    row.addEventListener("focusout", () => requestAnimationFrame(update));
    // Following a permalink scrolls the page as well as the grid, which can push the headings off the window.
    const reveal = () => {
      if (box.querySelector(":target") && row.getBoundingClientRect().top < 0) box.scrollIntoView({ block: "start" });
    };
    if (typeof window !== "undefined") {
      window.addEventListener("load", () => requestAnimationFrame(reveal));
      window.addEventListener("hashchange", () => requestAnimationFrame(reveal));
    }
    if (typeof ResizeObserver === "undefined") continue;
    // The row's height changes as it shrinks, so watch the box and a title, for new widths and text sizes.
    const observer = new ResizeObserver(measure);
    observer.observe(box);
    const title = row.querySelector(".esm-activity-title");
    if (title) observer.observe(title);
  }
}

const enhancedMenus = new WeakSet<Element>();

/**
 * Closes the board's menus (the status and persona filters, Export and each panel's Share) on Escape
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
      if (event.key !== "Escape" || !menu.open) return;
      // Inside a panel, Escape closes only the menu, not the panel around it.
      event.preventDefault();
      close(true);
    });
    menu.addEventListener("click", event => {
      if (event.target instanceof Element && event.target.closest("a, .esm-menu-item")) close(false);
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
 * Shows that `control` copied something, for 2 seconds. Inside a panel's **Share** menu,
 * which closes after a choice, the menu's button says “Copied” instead of the item.
 */
function showCopied(control: HTMLElement, copiedText: string) {
  const target = control.closest<HTMLElement>("details.esm-panel-menu")?.querySelector<HTMLElement>("summary") ?? control;
  const label = target.querySelector<HTMLElement>("[data-esm-copy-label]");
  if (label) {
    label.dataset.esmLabel ??= label.textContent ?? "";
    label.textContent = target === control ? copiedText : "Copied";
  }
  target.dataset.copied = "";
  const timers = copiedTimers.get(target);
  if (timers) clearTimeout(timers);
  copiedTimers.set(target, setTimeout(() => {
    if (label) label.textContent = label.dataset.esmLabel ?? "";
    delete target.dataset.copied;
  }, copiedMs));
}

const copiedTimers = new WeakMap<HTMLElement, ReturnType<typeof setTimeout>>();

/**
 * Opens the story or release panel a permalink names, from the board's `data-esm-open`,
 * expanding its lane if the viewer had collapsed it, without changing what is remembered.
 * Turns each panel's **Copy link**, on its own or in the **Share** menu, into a button that
 * copies the permalink and says “Link copied”. Without clipboard access, it stays a plain
 * link. Safe to call more than once.
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
        showCopied(link, "Link copied");
        announce(board, "Link copied");
      }, () => announce(board, "Could not copy the link. Open the link's menu to copy it."));
    });
  }
}

const enhancedBriefs = new WeakSet<Element>();

/**
 * Shows **Copy brief** in each panel's **Share** menu and makes it copy the agent brief,
 * saying what it copied, such as “Copied brief: ESM-111”. Also shows the **Open in** links
 * for briefs too long to put in a link, and copies the brief as one opens an empty chat,
 * saying “Brief copied. Paste it into the chat.” Without clipboard access, both stay
 * hidden, and the brief can still be selected in its details block. Safe to call more than once.
 */
export function enhanceStoryMapBriefs(root: ParentNode = document) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
  for (const board of root.querySelectorAll<HTMLElement>(".esm-board")) {
    if (enhancedBriefs.has(board)) continue;
    enhancedBriefs.add(board);
    for (const button of board.querySelectorAll<HTMLButtonElement>("button[data-esm-copy-brief]")) button.hidden = false;
    for (const link of board.querySelectorAll<HTMLAnchorElement>("a[data-esm-brief-copy]")) {
      const item = link.closest<HTMLElement>("li");
      if (item) item.hidden = false;
    }
    const briefText = (id: string | undefined) => {
      const text = document.getElementById(id ?? "");
      return text && board.contains(text) ? text.textContent ?? "" : null;
    };
    board.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target : null;
      const button = target?.closest<HTMLButtonElement>("button[data-esm-copy-brief]");
      if (button) {
        const text = briefText(button.dataset.esmCopyBrief);
        if (text === null) return;
        navigator.clipboard.writeText(text).then(() => {
          showCopied(button, "Copied");
          announce(board, button.dataset.esmCopied || "Copied brief");
        }, () => announce(board, "Could not copy the brief. Open Show the brief and select it to copy it."));
        return;
      }
      // The link still opens the chat. The copy starts first, while the click allows it.
      const link = target?.closest<HTMLAnchorElement>("a[data-esm-brief-copy]");
      if (!link) return;
      const text = briefText(link.dataset.esmBriefCopy);
      if (text === null) return;
      navigator.clipboard.writeText(text).then(
        () => announce(board, "Brief copied. Paste it into the chat."),
        () => announce(board, "Could not copy the brief. Open Show the brief and select it to copy it."),
      );
    });
  }
}

const shellSafe = /^[\w@%+=:,./-]+$/;

/** Quotes a value for a POSIX shell, leaving plain words, such as story and release IDs, as they are. */
export function shellQuote(value: string) {
  return shellSafe.test(value) ? value : `'${value.replace(/'/g, `'\\''`)}'`;
}

/** A change to one story, in the terms `story-map edit` takes. */
export interface StoryMapEditChange {
  id: string;
  status?: string;
  reason?: string;
  release?: string;
}

/**
 * The `story-map edit` command for a change, such as
 * `npx story-map edit ESM-108 --release v0-7-5 --write`. Each value is quoted for the shell,
 * and one that starts with a hyphen is passed as `--name=value`, as the parser asks.
 */
export function storyMapEditCommand(change: StoryMapEditChange) {
  const option = (name: string, value: string) => value.startsWith("-") ? shellQuote(`${name}=${value}`) : `${name} ${shellQuote(value)}`;
  return [
    "npx story-map edit",
    shellQuote(change.id),
    ...(change.status ? [option("--status", change.status)] : []),
    ...(change.status && change.reason ? [option("--reason", change.reason)] : []),
    ...(change.release ? [option("--release", change.release)] : []),
    "--write",
  ].join(" ");
}

const needsReason = (status: string) => status === "blocked" || status === "cut";

type ChangeStory = { id: string; status: string; release: string; reason?: string };
type ChangeChoice = { status: string; release: string; reason?: string };

/**
 * What the story panel's **Change** pickers change, or why there is nothing yet: nothing
 * differs from the story, or a blocked or cut story has no reason. Only what changed is
 * kept. A new reason for a story that stays blocked or cut repeats its status, since
 * `--reason` goes with `--status`.
 */
function storyMapChange(story: ChangeStory, chosen: ChangeChoice): { change: StoryMapEditChange } | { message: string } {
  const reason = needsReason(chosen.status) ? chosen.reason?.trim() ?? "" : "";
  const statusChanged = chosen.status !== story.status || (needsReason(chosen.status) && reason !== (story.reason ?? ""));
  const releaseChanged = chosen.release !== story.release;
  if (statusChanged && needsReason(chosen.status) && !reason) return { message: `Say why it is ${chosen.status} to see its command.` };
  if (!statusChanged && !releaseChanged) return { message: "Choose a new status or release to see its command." };
  return {
    change: {
      id: story.id,
      ...(statusChanged ? { status: chosen.status, ...(reason ? { reason } : {}) } : {}),
      ...(releaseChanged ? { release: chosen.release } : {}),
    },
  };
}

/** The command for what the story panel's **Change** pickers say, or why there is none yet, as `storyMapChange` decides. */
export function storyMapChangeCommand(story: ChangeStory, chosen: ChangeChoice): { command: string } | { message: string } {
  const result = storyMapChange(story, chosen);
  return "change" in result ? { command: storyMapEditCommand(result.change) } : result;
}

/**
 * The edit operations that save a change, for `POST /api/story-map/edit`: the same
 * `status` and `release` operations `story-map edit --status --reason --release` makes.
 */
export function storyMapChangeOperations(change: StoryMapEditChange): Record<string, string>[] {
  return [
    ...(change.status ? [{ op: "status", id: change.id, status: change.status, ...(change.reason ? { reason: change.reason } : {}) }] : []),
    ...(change.release ? [{ op: "release", id: change.id, release: change.release }] : []),
  ];
}

const changeSavedKey = "esm-change-saved";

/** The current page with the story's panel open, as a permalink opens it, keeping the filters. */
function storyPageUrl(id: string) {
  const url = new URL(location.href);
  url.searchParams.delete("release");
  url.searchParams.set("story", id);
  url.hash = `esm-story-${id}`;
  return url.href;
}

const enhancedChanges = new WeakSet<Element>();

/**
 * Shows the **Change** section of each internal story panel and builds the matching
 * `story-map edit` command as its status, reason and release pickers change. The reason
 * field shows for blocked and cut. With clipboard access, **Copy** copies the command and
 * says what it copied, such as “Copied command: ESM-111”. When the page was rendered with
 * `storyEditing`, as `story-map preview` does, **Save** posts the change to the map file and
 * reopens the panel. A save the server refuses, such as from a page older than the file,
 * says why in the section and saves nothing. Safe to call more than once.
 */
export function enhanceStoryMapChanges(root: ParentNode = document) {
  const canCopy = typeof navigator !== "undefined" && !!navigator.clipboard?.writeText;
  for (const form of root.querySelectorAll<HTMLFormElement>("form[data-esm-change]")) {
    if (enhancedChanges.has(form)) continue;
    enhancedChanges.add(form);
    const section = form.closest<HTMLElement>("section.esm-change-section");
    if (section) section.hidden = false;
    const field = <Field extends HTMLElement>(selector: string) => form.querySelector<Field>(selector);
    const status = field<HTMLSelectElement>("[name=status]");
    const release = field<HTMLSelectElement>("[name=release]");
    const reason = field<HTMLInputElement>("[name=reason]");
    const reasonField = field<HTMLElement>("[data-esm-change-reason]");
    const output = field<HTMLElement>("[data-esm-change-command]");
    const copy = field<HTMLButtonElement>("button[data-esm-change-copy]");
    const save = field<HTMLButtonElement>("button[data-esm-change-save]");
    const error = field<HTMLElement>(".esm-change-error");
    if (!status || !release || !output) continue;
    const { esmChange: id = "", esmStatus: current = "", esmRelease: currentRelease = "", esmReason: currentReason = "" } = form.dataset;
    const { esmEditEndpoint: endpoint, esmEditToken: token, esmEditRevision: revision } = form.dataset;
    if (copy) copy.hidden = !canCopy;
    let pending: StoryMapEditChange | undefined;
    let saving = false;

    const update = () => {
      if (reasonField) reasonField.hidden = !needsReason(status.value);
      const result = storyMapChange(
        { id, status: current, release: currentRelease, reason: currentReason },
        { status: status.value, release: release.value, reason: reason?.value },
      );
      pending = "change" in result ? result.change : undefined;
      output.textContent = pending ? storyMapEditCommand(pending) : (result as { message: string }).message;
      if (pending) delete output.dataset.empty;
      else output.dataset.empty = "";
      if (copy) copy.disabled = !pending;
      if (save) save.disabled = !pending || saving;
      if (error && !saving) error.hidden = true;
    };
    form.addEventListener("input", update);
    form.addEventListener("change", update);
    form.addEventListener("submit", event => {
      event.preventDefault();
      if (!save || !endpoint || !pending || saving) return;
      saving = true;
      save.disabled = true;
      if (error) error.hidden = true;
      const fail = (message: string) => {
        saving = false;
        save.disabled = !pending;
        if (error) {
          error.textContent = message;
          error.hidden = false;
        }
      };
      fetch(endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Story-Map-Token": token ?? "" },
        body: JSON.stringify({ revision, operations: storyMapChangeOperations(pending) }),
      })
        .then(async response => {
          const body = await response.json().catch(() => ({})) as { error?: string };
          if (!response.ok) throw new Error(body.error || `The preview could not save the change (${response.status}).`);
          try {
            sessionStorage.setItem(changeSavedKey, id);
          } catch {
            // The reload then makes no announcement.
          }
          // A URL that differs only in its hash would not reload, so replace it and reload.
          const next = storyPageUrl(id);
          if (next.split("#")[0] === location.href.split("#")[0]) {
            history.replaceState(history.state, "", next);
            location.reload();
          } else {
            location.assign(next);
          }
        })
        .catch((failure: unknown) => {
          fail(failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Could not reach the preview. Check it is still running, then try again.");
        });
    });
    copy?.addEventListener("click", () => {
      if (copy.disabled || !canCopy) return;
      const board = form.closest(".esm-board");
      navigator.clipboard.writeText(output.textContent ?? "").then(() => {
        showCopied(copy, "Copied");
        if (board) announce(board, `Copied command: ${id}`);
      }, () => {
        if (board) announce(board, "Could not copy the command. Select it to copy it.");
      });
    });
    update();
  }

  // After a save reloads the page on the story's panel, say that it saved.
  let saved: string | null = null;
  try {
    saved = sessionStorage.getItem(changeSavedKey);
    if (saved) sessionStorage.removeItem(changeSavedKey);
  } catch {
    // Storage can be unavailable.
  }
  const board = saved && typeof document !== "undefined" ? document.querySelector(".esm-board") : null;
  if (saved && board) announce(board, `Saved ${saved} to the map file.`);
}

const enhancedActions = new WeakSet<Element>();

/**
 * Shows the **Copy** button beside each action's command, on the Actions tab and in panels,
 * and makes it copy the command, saying “Copied command”. Without clipboard access, the
 * buttons stay hidden and the command can still be selected. Safe to call more than once.
 */
export function enhanceStoryMapActions(root: ParentNode = document) {
  if (typeof navigator === "undefined" || !navigator.clipboard?.writeText) return;
  for (const board of root.querySelectorAll<HTMLElement>(".esm-board")) {
    if (enhancedActions.has(board)) continue;
    enhancedActions.add(board);
    for (const button of board.querySelectorAll<HTMLButtonElement>("button[data-esm-copy-command]")) button.hidden = false;
    board.addEventListener("click", event => {
      const button = event.target instanceof Element ? event.target.closest<HTMLButtonElement>("button[data-esm-copy-command]") : null;
      if (!button) return;
      const command = document.getElementById(button.dataset.esmCopyCommand ?? "");
      if (!command || !board.contains(command)) return;
      navigator.clipboard.writeText(command.textContent ?? "").then(() => {
        showCopied(button, "Copied");
        announce(board, "Copied command");
      }, () => announce(board, "Could not copy the command. Select it to copy it."));
    });
  }
}

const editFocusKey = "esm-edit-focus";
const editNextKey = "esm-edit-next";
const enhancedEditing = new WeakSet<Element>();

/** The fields of a list form, such as Uses today, as one persona edit operation. */
function formOperation(form: HTMLFormElement): Record<string, unknown> {
  const operation = targetOf(form);
  const lists = new Set([...form.querySelectorAll<HTMLElement>("[data-esm-list]")].map(list => list.dataset.esmList!));
  const data = new FormData(form);
  for (const name of new Set(data.keys())) {
    operation[name] = lists.has(name)
      ? data.getAll(name).map(value => String(value).trim()).filter(Boolean)
      : String(data.get(name) ?? "").trim();
  }
  return operation;
}

function targetOf(editor: HTMLElement): Record<string, unknown> {
  const operation: Record<string, unknown> = { op: editor.dataset.esmEdit };
  if (editor.dataset.esmPersona) operation.persona = editor.dataset.esmPersona;
  if (editor.dataset.esmJob) operation.job = editor.dataset.esmJob;
  return operation;
}

/**
 * Text typed into an editable element, with single spaces. A multi-line field keeps
 * its line breaks, with at most one blank line between paragraphs. Others are one line.
 */
function typed(field: HTMLElement, text = field.innerText ?? field.textContent ?? "") {
  if (!field.hasAttribute("data-esm-multiline")) return text.replace(/\s+/g, " ").trim();
  return text.replace(/\r\n?/g, "\n").split("\n").map(line => line.replace(/[^\S\n]+/g, " ").trim()).join("\n").replace(/\n{3,}/g, "\n\n").trim();
}

function updateAddRow(list: HTMLElement) {
  const add = list.querySelector<HTMLButtonElement>("[data-esm-add-row]");
  if (add) add.disabled = list.querySelectorAll(".esm-field-row").length >= Number(list.dataset.esmMaxItems || Infinity);
}

/** The first element that is laid out, so focus never goes to a button hidden by a narrow screen. */
function visible<T extends HTMLElement>(elements: T[]) {
  return elements.find(element => element.getClientRects().length > 0) ?? elements[0];
}

function caretToEnd(field: HTMLElement) {
  const selection = getSelection();
  if (!selection) return;
  const range = document.createRange();
  range.selectNodeContents(field);
  range.collapse(false);
  selection.removeAllRanges();
  selection.addRange(range);
}

/**
 * Lets internal viewers edit personas in place on the Personas tab, when the page
 * was rendered with `personaEditing`, as `story-map preview --writable` does. **Edit**
 * makes the title, summary, success or job statement editable where it is, with
 * Save and Cancel below it. Uses today and Constraints open a form with one row per
 * entry. Save posts the edit and reloads the tab. Without this script the buttons stay
 * hidden and the page is read-only.
 */
export function enhanceStoryMapPersonaEditing(root: ParentNode = document) {
  for (const page of root.querySelectorAll<HTMLElement>(":is(.esm-persona-page, .esm-persona-setup)[data-esm-edit-endpoint]")) {
    if (enhancedEditing.has(page)) continue;
    enhancedEditing.add(page);
    const { esmEditEndpoint: endpoint, esmEditToken: token, esmEditRevision: revision } = page.dataset;
    const editorById = (id: string | undefined) => {
      const editor = id ? document.getElementById(id) : null;
      return editor && page.contains(editor) && editor.dataset.esmEdit ? editor : null;
    };
    // Each list's rows as the page loaded them, so Cancel puts back rows that were added or removed.
    const initialRows = new Map<HTMLElement, HTMLElement[]>();
    for (const list of page.querySelectorAll<HTMLElement>("[data-esm-list]")) {
      initialRows.set(list, [...list.querySelectorAll<HTMLElement>(".esm-field-row")].map(row => row.cloneNode(true) as HTMLElement));
    }
    const restoreRows = (form: HTMLFormElement) => {
      for (const list of form.querySelectorAll<HTMLElement>("[data-esm-list]")) {
        const rows = initialRows.get(list);
        if (!rows) continue;
        for (const row of list.querySelectorAll(".esm-field-row")) row.remove();
        const add = list.querySelector("[data-esm-add-row]")!;
        for (const row of rows) add.before(row.cloneNode(true));
      }
    };
    // An editor can have more than one opener, such as Add persona in the list and in the picker on small screens.
    const buttonsFor = (editor: HTMLElement) => [...page.querySelectorAll<HTMLButtonElement>(`[data-esm-edit-open="${editor.id}"]`)];
    const fieldsOf = (editor: HTMLElement) => [...page.querySelectorAll<HTMLElement>(`[data-esm-editor="${editor.id}"]`)];
    for (const button of page.querySelectorAll<HTMLButtonElement>("[data-esm-edit-open]")) button.hidden = false;
    // Plain text only. Browsers without plaintext-only get true, and pastes are made plain below.
    const probe = document.createElement("span");
    probe.contentEditable = "plaintext-only";
    const editable = probe.contentEditable === "plaintext-only" ? "plaintext-only" : "true";

    const showCount = (editor: HTMLElement, field: HTMLElement) => {
      const count = editor.querySelector<HTMLElement>("[data-esm-live-count]");
      if (!count) return;
      const length = typed(field).length;
      const max = Number(field.dataset.esmMax);
      const saveKey = /Mac|iPhone|iPad/.test(navigator.platform) ? "⌘" : "Ctrl";
      count.textContent = `${field.dataset.esmLabel}: ${length} / ${max}${field.hasAttribute("data-esm-multiline") ? ` · Enter adds a line, ${saveKey}+Enter saves` : ""}`;
      count.toggleAttribute("data-over", length > max);
    };

    const close = (editor: HTMLElement, focus = true) => {
      editor.hidden = true;
      const error = editor.querySelector<HTMLElement>(".esm-form-error");
      if (error) error.hidden = true;
      if (editor instanceof HTMLFormElement) {
        restoreRows(editor);
        editor.reset();
        const view = page.querySelector<HTMLElement>(`[data-esm-edit-view="${editor.id}"]`);
        if (view) view.hidden = false;
      } else {
        for (const field of fieldsOf(editor)) {
          field.textContent = field.dataset.esmOriginal ?? field.textContent;
          for (const name of ["contenteditable", "role", "aria-label", "aria-multiline", "tabindex", "data-esm-editing"]) field.removeAttribute(name);
        }
      }
      const buttons = buttonsFor(editor);
      for (const button of buttons) {
        button.hidden = false;
        button.setAttribute("aria-expanded", "false");
      }
      if (focus) visible(buttons)?.focus();
    };

    const open = (editor: HTMLElement) => {
      for (const other of page.querySelectorAll<HTMLElement>("[data-esm-edit]:not([hidden])")) close(other, false);
      for (const button of buttonsFor(editor)) {
        button.setAttribute("aria-expanded", "true");
        button.hidden = true;
        // A menu that held the opener closes, so it does not cover the form.
        const menu = button.closest("details");
        if (menu) menu.open = false;
      }
      editor.hidden = false;
      if (editor instanceof HTMLFormElement) {
        const view = page.querySelector<HTMLElement>(`[data-esm-edit-view="${editor.id}"]`);
        if (view) view.hidden = true;
        for (const list of editor.querySelectorAll<HTMLElement>("[data-esm-list]")) updateAddRow(list);
        editor.dataset.esmSnapshot = JSON.stringify(formOperation(editor));
        editor.querySelector<HTMLElement>("input, textarea")?.focus();
        return;
      }
      const fields = fieldsOf(editor);
      for (const field of fields) {
        field.dataset.esmOriginal = field.textContent ?? "";
        field.contentEditable = editable;
        field.setAttribute("role", "textbox");
        field.setAttribute("aria-label", field.dataset.esmLabel ?? "");
        field.setAttribute("aria-multiline", field.hasAttribute("data-esm-multiline") ? "true" : "false");
        field.dataset.esmEditing = "";
      }
      if (fields[0]) {
        fields[0].focus();
        caretToEnd(fields[0]);
        showCount(editor, fields[0]);
      }
    };

    const fail = (editor: HTMLElement, message: string) => {
      const error = editor.querySelector<HTMLElement>(".esm-form-error")!;
      error.textContent = message;
      error.hidden = false;
      for (const button of editor.querySelectorAll<HTMLButtonElement>(".esm-save, .esm-delete")) button.disabled = false;
    };

    /** Asks before deleting what `button` deletes, saying what else changes, then posts the delete. */
    const confirmDelete = (editor: HTMLElement, button: HTMLElement) => {
      const dialog = document.createElement("dialog");
      dialog.className = "esm-unsaved-dialog";
      dialog.setAttribute("aria-labelledby", `${editor.id}-delete`);
      const heading = document.createElement("h3");
      heading.id = `${editor.id}-delete`;
      heading.textContent = `Delete ${button.dataset.esmDelete}?`;
      const text = document.createElement("p");
      text.textContent = `${button.dataset.esmDeleteConsequence ?? ""} The map file changes, so you can undo it with Git.`.trim();
      const form = document.createElement("form");
      form.method = "dialog";
      const keep = document.createElement("button");
      keep.value = "keep";
      keep.textContent = "Keep it";
      keep.className = "esm-cancel esm-unsaved-keep";
      const remove = document.createElement("button");
      remove.value = "delete";
      remove.textContent = "Delete";
      remove.className = "esm-save esm-danger";
      form.append(keep, remove);
      dialog.append(heading, text, form);
      page.append(dialog);
      dialog.addEventListener("close", () => {
        const action = dialog.returnValue;
        dialog.remove();
        if (action === "delete") post(editor, { op: "delete-job", job: editor.dataset.esmJob });
        else button.focus();
      });
      dialog.showModal();
      keep.focus();
    };

    /** True when the open editor holds text that differs from what the page loaded with. */
    const isDirty = (editor: HTMLElement) => {
      if (editor.hidden) return false;
      if (editor instanceof HTMLFormElement) return JSON.stringify(formOperation(editor)) !== editor.dataset.esmSnapshot;
      return fieldsOf(editor).some(field => typed(field) !== typed(field, field.dataset.esmOriginal ?? ""));
    };
    const nameOf = (editor: HTMLElement) => (editor.getAttribute("aria-label") ?? "").replace(/^Edit /, "");

    /**
     * Asks what to do with unsaved changes in `current` before `next` opens: save them
     * (then `next` opens after the reload), discard them, or keep editing.
     */
    const askUnsaved = (current: HTMLElement, next: HTMLElement) => {
      const dialog = document.createElement("dialog");
      dialog.className = "esm-unsaved-dialog";
      const titleId = `${current.id}-unsaved`;
      dialog.setAttribute("aria-labelledby", titleId);
      const heading = document.createElement("h3");
      heading.id = titleId;
      heading.textContent = "Save your changes?";
      const text = document.createElement("p");
      text.textContent = `Your changes to ${nameOf(current)} are not saved yet.`;
      const form = document.createElement("form");
      form.method = "dialog";
      const choice = (value: string, label: string, className: string) => {
        const button = document.createElement("button");
        button.value = value;
        button.textContent = label;
        button.className = className;
        return button;
      };
      const saveButton = choice("save", "Save", "esm-save");
      form.append(choice("keep", "Keep editing", "esm-cancel esm-unsaved-keep"), choice("discard", "Discard", "esm-cancel"), saveButton);
      dialog.append(heading, text, form);
      page.append(dialog);
      dialog.addEventListener("close", () => {
        const action = dialog.returnValue;
        dialog.remove();
        if (action === "save") {
          save(current, next);
        } else if (action === "discard") {
          close(current, false);
          open(next);
        } else {
          (fieldsOf(current)[0] ?? current.querySelector<HTMLElement>("input, textarea"))?.focus();
        }
      });
      dialog.showModal();
      saveButton.focus();
    };

    // Leaving the page, by a link or a reload, also warns about unsaved changes.
    let leaving = false;
    addEventListener("beforeunload", event => {
      if (leaving) return;
      if ([...page.querySelectorAll<HTMLElement>("[data-esm-edit]:not([hidden])")].some(isDirty)) event.preventDefault();
    });

    const save = (editor: HTMLElement, next?: HTMLElement) => {
      let operation: Record<string, unknown>;
      if (editor instanceof HTMLFormElement) {
        operation = formOperation(editor);
      } else {
        operation = targetOf(editor);
        for (const field of fieldsOf(editor)) {
          const value = typed(field);
          if (field.hasAttribute("data-esm-required") && !value) {
            field.focus();
            fail(editor, `${field.dataset.esmLabel} cannot be empty.`);
            return;
          }
          const max = Number(field.dataset.esmMax);
          if (value.length > max) {
            field.focus();
            fail(editor, `${field.dataset.esmLabel} is ${value.length} characters. Keep it to ${max}.`);
            return;
          }
          // Only fields that changed, so text the board shortens, such as an outcome's full stop, is kept.
          if (value !== typed(field, field.dataset.esmOriginal ?? "")) operation[field.dataset.esmEditField!] = value;
        }
        if (Object.keys(operation).length === 1 + (operation.persona ? 1 : 0) + (operation.job ? 1 : 0)) {
          close(editor);
          return;
        }
      }
      post(editor, operation, next);
    };

    /** Posts one edit operation and reloads the tab, or shows why it failed in `editor`. */
    const post = (editor: HTMLElement, operation: Record<string, unknown>, next?: HTMLElement) => {
      for (const button of editor.querySelectorAll<HTMLButtonElement>(".esm-save, .esm-delete")) button.disabled = true;
      editor.querySelector<HTMLElement>(".esm-form-error")!.hidden = true;
      fetch(endpoint!, {
        method: "POST",
        headers: { "Content-Type": "application/json", "X-Story-Map-Token": token ?? "" },
        body: JSON.stringify({ revision, operations: [operation] }),
      })
        .then(async response => {
          const body = await response.json().catch(() => ({})) as { error?: string; addedPersonaIds?: string[] };
          if (!response.ok) throw new Error(body.error || `The preview could not save the edit (${response.status}).`);
          const added = body.addedPersonaIds?.[0];
          try {
            sessionStorage.setItem(editFocusKey, editor.id);
            if (next) sessionStorage.setItem(editNextKey, next.id);
          } catch {
            // Focus then starts at the top after the reload.
          }
          leaving = true;
          if (added) {
            // Open the new persona, keeping the other filters.
            const url = new URL(location.href);
            url.searchParams.delete("persona");
            url.searchParams.delete("job");
            url.searchParams.set("persona", added);
            location.assign(url);
          } else {
            location.reload();
          }
        })
        .catch((failure: unknown) => {
          fail(editor, failure instanceof Error && failure.message !== "Failed to fetch" ? failure.message : "Could not reach the preview. Check it is still running, then try again.");
        });
    };

    page.addEventListener("click", event => {
      const target = event.target instanceof Element ? event.target : null;
      const opener = target?.closest<HTMLButtonElement>("[data-esm-edit-open]");
      if (opener) {
        const editor = editorById(opener.dataset.esmEditOpen);
        if (!editor) return;
        const current = [...page.querySelectorAll<HTMLElement>("[data-esm-edit]:not([hidden])")].find(other => other !== editor && isDirty(other));
        if (current) askUnsaved(current, editor);
        else open(editor);
        return;
      }
      const editor = target?.closest<HTMLElement>("[data-esm-edit]");
      if (!editor) return;
      if (target!.closest("[data-esm-edit-cancel]")) {
        close(editor);
        return;
      }
      if (target!.closest("[data-esm-edit-save]")) {
        save(editor);
        return;
      }
      const remove = target!.closest<HTMLElement>("[data-esm-delete]");
      if (remove) {
        confirmDelete(editor, remove);
        return;
      }
      const list = target!.closest<HTMLElement>("[data-esm-list]");
      if (list && target!.closest("[data-esm-add-row]")) {
        const rows = list.querySelectorAll<HTMLElement>(".esm-field-row");
        if (!rows.length || rows.length >= Number(list.dataset.esmMaxItems || Infinity)) return;
        const row = rows[rows.length - 1].cloneNode(true) as HTMLElement;
        row.querySelector("input")!.value = "";
        list.querySelector("[data-esm-add-row]")!.before(row);
        row.querySelector("input")?.focus();
        updateAddRow(list);
        return;
      }
      if (list && target!.closest("[data-esm-remove-row]")) {
        const row = target!.closest<HTMLElement>(".esm-field-row")!;
        if (list.querySelectorAll(".esm-field-row").length > 1) {
          const next = row.nextElementSibling?.matches(".esm-field-row") ? row.nextElementSibling : row.previousElementSibling;
          row.remove();
          next?.querySelector("input")?.focus();
        } else {
          row.querySelector("input")!.value = "";
          row.querySelector("input")!.focus();
        }
        updateAddRow(list);
      }
    });

    const inlineEditorOf = (target: EventTarget | null) => {
      const field = target instanceof HTMLElement && target.hasAttribute("data-esm-editing") ? target : null;
      return field ? { field, editor: editorById(field.dataset.esmEditor) } : null;
    };

    page.addEventListener("input", event => {
      const inline = inlineEditorOf(event.target);
      if (inline?.editor) showCount(inline.editor, inline.field);
    });
    page.addEventListener("focusin", event => {
      const inline = inlineEditorOf(event.target);
      if (inline?.editor) showCount(inline.editor, inline.field);
    });
    page.addEventListener("paste", event => {
      const inline = inlineEditorOf(event.target);
      if (!inline || editable === "plaintext-only") return;
      event.preventDefault();
      document.execCommand("insertText", false, event.clipboardData?.getData("text/plain") ?? "");
    });

    page.addEventListener("keydown", event => {
      const target = event.target instanceof Element ? event.target : null;
      const inline = inlineEditorOf(target);
      const editor = inline?.editor ?? target?.closest<HTMLElement>("[data-esm-edit]") ?? null;
      if (!editor) return;
      if (event.key === "Escape") {
        event.preventDefault();
        event.stopPropagation();
        close(editor);
      } else if (event.key === "Enter" && inline) {
        // Enter saves a one-line field. In a multi-line one it adds a line, and Ctrl or Cmd with Enter saves.
        const multiline = inline.field.hasAttribute("data-esm-multiline");
        if (multiline && !event.ctrlKey && !event.metaKey) {
          if (editable === "true") {
            event.preventDefault();
            document.execCommand("insertText", false, "\n");
          }
          return;
        }
        event.preventDefault();
        save(editor);
      }
    });

    page.addEventListener("submit", event => {
      const form = event.target;
      if (!(form instanceof HTMLFormElement) || !form.dataset.esmEdit) return;
      event.preventDefault();
      save(form);
    });

    // After a save reloads the page, focus goes back to the Edit button that opened the editor,
    // or the editor the person chose next opens.
    let saved: string | null = null;
    let next: string | null = null;
    try {
      saved = sessionStorage.getItem(editFocusKey);
      next = sessionStorage.getItem(editNextKey);
      sessionStorage.removeItem(editFocusKey);
      sessionStorage.removeItem(editNextKey);
    } catch {
      // Storage can be unavailable.
    }
    if (saved) {
      const following = editorById(next ?? undefined);
      if (following) open(following);
      else visible([...page.querySelectorAll<HTMLButtonElement>(`[data-esm-edit-open="${saved}"]`)])?.focus();
      const board = page.closest(".esm-board");
      if (board) announce(board, "Saved to the map file.");
    }
  }
}

const editSetupHiddenKey = "esm-edit-setup-hidden";
const editSetupGuide = "https://github.com/duncan-m/auto-story-map/blob/main/docs/story-map.md#in-your-own-app";
const loopbackHostnames = new Set(["localhost", "127.0.0.1", "[::1]", "::1"]);

/**
 * Says why there are no edit buttons on an internal Personas tab opened from this
 * machine when the app has no save route, and links to the steps. **Hide** keeps it
 * hidden in this browser. The note is added here, not on the server, so a deployed
 * page never mentions editing, and it only appears on a loopback host.
 */
export function enhanceStoryMapEditSetup(root: ParentNode = document) {
  if (typeof location === "undefined" || !loopbackHostnames.has(location.hostname)) return;
  try {
    if (localStorage.getItem(editSetupHiddenKey)) return;
  } catch {
    // Storage can be unavailable. The note then shows each time.
  }
  for (const page of root.querySelectorAll<HTMLElement>(":is(.esm-persona-page, .esm-persona-setup)[data-esm-internal]:not([data-esm-edit-endpoint], [data-esm-read-only])")) {
    if (page.querySelector(".esm-edit-setup-note")) continue;
    const note = document.createElement("aside");
    note.className = "esm-edit-setup-note";
    note.setAttribute("role", "note");
    const text = document.createElement("span");
    const title = document.createElement("strong");
    title.textContent = "Editing is not set up in this app.";
    const link = document.createElement("a");
    link.href = editSetupGuide;
    link.target = "_blank";
    link.rel = "noopener noreferrer";
    link.textContent = "Set up editing";
    text.append(title, " This board runs on your machine, but the app has no save route, so the edit buttons are hidden. Add a save route and read the map on each request to save edits to the map file. ", link);
    const hide = document.createElement("button");
    hide.type = "button";
    hide.className = "esm-cancel";
    hide.textContent = "Hide";
    hide.setAttribute("aria-label", "Hide this note");
    hide.addEventListener("click", () => {
      try {
        localStorage.setItem(editSetupHiddenKey, "1");
      } catch {
        // Storage can be unavailable. The note is hidden until the page reloads.
      }
      for (const shown of document.querySelectorAll(".esm-edit-setup-note")) shown.remove();
    });
    note.append(text, hide);
    // At the top of the persona, or under the heading when there are no personas yet.
    const main = page.querySelector(".esm-persona-main");
    const heading = page.querySelector(":scope > h3");
    if (main) main.prepend(note);
    else if (heading) heading.after(note);
    else page.prepend(note);
  }
}

function enhance() {
  enhanceStoryMapFilters();
  enhanceStoryMapReleases();
  enhanceStoryMapHeadings();
  enhanceStoryMapMenus();
  enhanceStoryMapPermalinks();
  enhanceStoryMapBriefs();
  enhanceStoryMapChanges();
  enhanceStoryMapActions();
  enhanceStoryMapPersonaEditing();
  enhanceStoryMapEditSetup();
}

if (typeof document !== "undefined") {
  if (document.readyState === "loading") {
    document.addEventListener("DOMContentLoaded", enhance, { once: true });
  } else {
    enhance();
  }
}
