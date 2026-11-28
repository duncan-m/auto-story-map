import { realpath } from "node:fs/promises";
import { extname, relative, sep } from "node:path";
import { readTextFileWithin } from "./read-text.js";
import { fitHistoryText } from "./history.js";
import {
  outsideLinkIssue,
  repositoryFiles,
  resolveRootedPath,
  storyIdPattern,
  type FileFilter,
  type ReferenceIssue,
} from "./references.js";
import { untestedStoryWarnings } from "./actions.js";
import type { LoadedStoryMap } from "./schema.js";
import {
  testNameMaxLength,
  testsMaxItems,
  testsPerStoryMaxItems,
  testStoryIdsMaxItems,
  testsOmittedMaxItems,
  type OmittedStoryTests,
  type StoryMapTests,
  type StoryTestEntry,
} from "./tests-index.js";
import { present } from "./present.js";

/** A test or group whose name contains a story ID, as found in the source text. */
export interface FoundStoryTest {
  /** Every ID in the name that uses one of the map's prefixes, in order, including IDs that are not in the map. */
  storyIds: string[];
  /** Path relative to the repository root, with `/` separators. */
  file: string;
  /** 1-based line of the `test`, `it`, `describe` or `suite` call. */
  line: number;
  /** 1-based column of the call. */
  column: number;
  /** The name as written, with escapes decoded. A template literal keeps its `${…}` parts as written. */
  name: string;
  /** `group` for `describe` and `suite`, `test` for `test` and `it`. */
  kind: "test" | "group";
  /**
   * The IDs in `storyIds` that come only from the tagged `describe` or `suite`
   * blocks around the call, not from its own name. Absent when there are none.
   */
  inheritedIds?: string[];
}

export interface FoundStoryTests {
  /** Sorted by file, then line, then column. */
  tests: FoundStoryTest[];
  /** Paths that could not be read, such as ones outside the repository. */
  issues: ReferenceIssue[];
}

/** Largest test file read, so a scan stays quick. Larger files are reported and skipped. */
export const maxTestFileBytes = 5 * 1024 * 1024;

const testExtensions = new Set([".js", ".mjs", ".cjs", ".jsx", ".ts", ".mts", ".cts", ".tsx"]);
const testFolders = new Set(["test", "tests", "__tests__"]);
const skippedFolders = new Set(["dist", "build"]);

/** `*.test.*` and `*.spec.*` files, and every script under a `test`, `tests` or `__tests__` folder. */
const testFileFilter: FileFilter = {
  include(path, name) {
    if (!testExtensions.has(extname(name).toLowerCase())) return false;
    if (/\.(test|spec)\.[^.]+$/i.test(name)) return true;
    return path.split("/").slice(0, -1).some(folder => testFolders.has(folder));
  },
  skipFolder: name => skippedFolders.has(name),
};

const callNames: Record<string, FoundStoryTest["kind"]> = { test: "test", it: "test", describe: "group", suite: "group" };
const modifiers = new Set(["only", "skip", "todo", "each", "concurrent"]);

/** Words after which a `/` starts a regular expression rather than a division. */
const regexAfterWords = new Set(["return", "typeof", "case", "do", "else", "in", "of", "new", "delete", "void", "throw", "yield", "await", "instanceof"]);

const isIdentifierChar = (char: string | undefined) => char !== undefined && /[\p{L}\p{N}_$‌‍]/u.test(char);
const isSpace = (char: string | undefined) => char !== undefined && /\s/.test(char);

/** Index just past the comment starting at `i`, or `i` when there is none. */
function skipComment(text: string, i: number) {
  if (text[i] !== "/") return i;
  if (text[i + 1] === "/") {
    const end = text.indexOf("\n", i);
    return end === -1 ? text.length : end;
  }
  if (text[i + 1] === "*") {
    const end = text.indexOf("*/", i + 2);
    return end === -1 ? text.length : end + 2;
  }
  return i;
}

/** Skips spaces and comments. */
function skipTrivia(text: string, i: number) {
  for (;;) {
    while (isSpace(text[i])) i++;
    const next = skipComment(text, i);
    if (next === i) return i;
    i = next;
  }
}

/** Index just past the quoted string starting at `i`, or -1 when it does not close on its line. */
function skipQuoted(text: string, i: number) {
  const quote = text[i];
  for (let j = i + 1; j < text.length; j++) {
    const char = text[j];
    if (char === "\\") j++;
    else if (char === quote) return j + 1;
    else if (char === "\n") return -1;
  }
  return -1;
}

/** Decodes the escape starting at the backslash at `i`. Returns the text and the index just past it. */
function decodeEscape(text: string, i: number): [string, number] {
  const char = text[i + 1];
  const simple: Record<string, string> = { n: "\n", r: "\r", t: "\t", b: "\b", f: "\f", v: "\v", 0: "\0" };
  if (char === undefined) return ["", i + 1];
  if (char in simple && !(char === "0" && /\d/.test(text[i + 2] ?? ""))) return [simple[char], i + 2];
  if (char === "\r") return ["", text[i + 2] === "\n" ? i + 3 : i + 2];
  if (char === "\n" || char === " " || char === " ") return ["", i + 2];
  const hex = char === "x" ? /^[0-9a-f]{2}/i.exec(text.slice(i + 2, i + 4))
    : char === "u" ? /^(?:[0-9a-f]{4}|\{[0-9a-f]{1,6}\})/i.exec(text.slice(i + 2, i + 10)) : null;
  if (hex) {
    const code = parseInt(hex[0].replace(/[{}]/g, ""), 16);
    if (code <= 0x10ffff) return [String.fromCodePoint(code), i + 2 + hex[0].length];
  }
  // Any other escaped character stands for itself. Take a whole code point so a surrogate pair is not split.
  const point = text.codePointAt(i + 1);
  if (point === undefined) return ["", i + 1];
  const codePoint = String.fromCodePoint(point);
  return [codePoint, i + 1 + codePoint.length];
}

/**
 * Decodes a whole string literal, quotes included. A template literal keeps
 * each `${…}` as written in `name`, and has it replaced by a space in
 * `literal`, the text that story IDs are matched against.
 */
function decodeLiteral(literalText: string): { name: string; literal: string } {
  let name = "";
  let literal = "";
  for (let j = 1; j < literalText.length - 1; j++) {
    const char = literalText[j];
    if (char === "\\") {
      const [decoded, next] = decodeEscape(literalText, j);
      name += decoded;
      literal += decoded;
      j = next - 1;
    } else if (char === "$" && literalText[0] === "`" && literalText[j + 1] === "{") {
      let depth = 0;
      let end = j + 1;
      for (; end < literalText.length - 1; end++) {
        if (literalText[end] === "{") depth++;
        else if (literalText[end] === "}" && --depth === 0) break;
      }
      name += literalText.slice(j, end + 1);
      literal += " ";
      j = end;
    } else {
      name += char;
      literal += char;
    }
  }
  return { name, literal };
}

/**
 * A call as the scan meets it. `parent` is the nearest group around it whose
 * name was read, and `index` is set once the call's own name is read.
 */
type Call = { line: number; column: number; kind: FoundStoryTest["kind"]; parent?: Call; index?: number };
type TemplateFrame = { start: number; name?: Call; each?: Call };
/** `group` is the innermost `describe` or `suite` call whose arguments hold this frame. */
type Frame = ({ close: string; each?: Call } | { template: TemplateFrame }) & { group?: Call };

/** A test call found by `scanTestCalls`. */
export interface ScannedTestCall {
  line: number;
  column: number;
  /** The name as written, with escapes decoded. */
  name: string;
  /** The text story IDs are matched against: the name with each `${…}` replaced by a space. */
  literal: string;
  kind: FoundStoryTest["kind"];
  /** Index, in the returned list, of the nearest `describe` or `suite` around the call whose name was read. */
  parent?: number;
}

/**
 * Finds `test`, `it`, `describe` and `suite` calls in JavaScript or
 * TypeScript source whose name is a string literal, skipping text inside
 * comments, strings, template literals and regular expressions. It reads the
 * text only, so no test code runs.
 *
 * It makes one pass and never looks ahead past spaces, comments and a few
 * words, so each character is visited a bounded number of times and hostile
 * text, such as many unclosed `test.each(` calls, stays linear. A call's name,
 * and the end of a `.each(…)` table, are picked up when the pass reaches them.
 */
export function scanTestCalls(text: string): ScannedTestCall[] {
  const calls: ScannedTestCall[] = [];
  const stack: Frame[] = [];
  let line = 1;
  let lineStart = 0;
  // The last code token before here, to tell a regular expression from a division.
  let previous: "start" | "operator" | "value" | "word" = "start";
  let lastWord = "";
  // A call whose name, or `.each` table, starts at a known index.
  let pendingName: { call: Call; at: number } | undefined;
  let pendingEach: { call: Call; at: number } | undefined;
  // The `(` that opens a group's arguments, so the frame it pushes knows its group.
  let pendingGroup: { call: Call; at: number } | undefined;

  /** Records a call whose name has been read, linking it to the group around it. */
  const record = (call: Call, literalText: string) => {
    call.index = calls.length;
    const found: ScannedTestCall = { line: call.line, column: call.column, kind: call.kind, ...decodeLiteral(literalText) };
    if (call.parent?.index !== undefined) found.parent = call.parent.index;
    calls.push(found);
  };
  const currentGroup = () => stack[stack.length - 1]?.group;

  const countLines = (from: number, to: number) => {
    for (let k = text.indexOf("\n", from); k !== -1 && k < to; k = text.indexOf("\n", k + 1)) {
      line++;
      lineStart = k + 1;
    }
  };

  /** After a call and its modifiers, expects `(` and a name that starts on that line or the next. */
  const expectName = (from: number, call: Call) => {
    const open = skipTrivia(text, from);
    if (text[open] !== "(") return;
    if (call.kind === "group") pendingGroup = { call, at: open };
    const start = skipTrivia(text, open + 1);
    let lineBreaks = 0;
    for (let k = text.indexOf("\n", from); k !== -1 && k < start; k = text.indexOf("\n", k + 1)) lineBreaks++;
    if (lineBreaks <= 1 && /["'`]/.test(text[start] ?? "")) pendingName = { call, at: start };
  };

  /** Reads modifiers such as `.only` or `.each` after a call's word, up to the `(`. */
  const readModifiers = (from: number, call: Call) => {
    let j = from;
    for (let count = 0; count < 4; count++) {
      const dot = skipTrivia(text, j);
      if (text[dot] !== ".") break;
      const start = skipTrivia(text, dot + 1);
      let end = start;
      while (isIdentifierChar(text[end])) end++;
      if (!modifiers.has(text.slice(start, end))) return;
      j = end;
      if (text.slice(start, end) === "each") {
        const open = skipTrivia(text, j);
        if (/[([`]/.test(text[open] ?? "")) pendingEach = { call, at: open };
        return;
      }
    }
    expectName(j, call);
  };

  /** Continues a template literal's text from `from`. */
  const templateText = (frame: TemplateFrame, from: number) => {
    let end = text.length;
    let expression = false;
    for (let j = from; j < text.length; j++) {
      const char = text[j];
      if (char === "\\") j++;
      else if (char === "`") {
        end = j + 1;
        break;
      } else if (char === "$" && text[j + 1] === "{") {
        end = j + 2;
        expression = true;
        break;
      }
    }
    countLines(from, end);
    if (expression) {
      stack.push({ template: frame, group: currentGroup() });
      previous = "start";
      return end;
    }
    if (frame.name && text[end - 1] === "`") record(frame.name, text.slice(frame.start, end));
    if (frame.each) expectName(end, frame.each);
    previous = "value";
    return end;
  };

  let i = 0;
  while (i < text.length) {
    const char = text[i];
    if (char === "\n") {
      line++;
      lineStart = i + 1;
      i++;
      continue;
    }
    if (isSpace(char)) {
      i++;
      continue;
    }
    const afterComment = skipComment(text, i);
    if (afterComment !== i) {
      countLines(i, afterComment);
      i = afterComment;
      continue;
    }
    if (char === '"' || char === "'") {
      const end = skipQuoted(text, i);
      if (end !== -1 && pendingName?.at === i) record(pendingName.call, text.slice(i, end));
      const to = end === -1 ? (text.indexOf("\n", i) + 1 || text.length) : end;
      countLines(i, to);
      i = to;
      previous = "value";
      continue;
    }
    if (char === "`") {
      const frame: TemplateFrame = { start: i };
      if (pendingName?.at === i) frame.name = pendingName.call;
      if (pendingEach?.at === i) frame.each = pendingEach.call;
      i = templateText(frame, i + 1);
      continue;
    }
    if (char === "/") {
      const regex = previous === "start" || previous === "operator" || (previous === "word" && regexAfterWords.has(lastWord));
      if (regex) {
        let inClass = false;
        let j = i + 1;
        for (; j < text.length && text[j] !== "\n"; j++) {
          if (text[j] === "\\") j++;
          else if (text[j] === "[") inClass = true;
          else if (text[j] === "]") inClass = false;
          else if (text[j] === "/" && !inClass) break;
        }
        i = text[j] === "/" ? j + 1 : j;
        while (isIdentifierChar(text[i])) i++;
        previous = "value";
        continue;
      }
      previous = "operator";
      i++;
      continue;
    }
    if (isIdentifierChar(char)) {
      let end = i + 1;
      while (isIdentifierChar(text[end])) end++;
      const word = text.slice(i, end);
      // `expect.test(…)` or `/x/.test(…)` is a method, not a test.
      let back = i - 1;
      while (isSpace(text[back])) back--;
      if (Object.hasOwn(callNames, word) && text[back] !== ".") {
        // The nearest group around the call whose name was read. A group's name
        // comes before its body, so whether it was read is settled by now.
        const group = currentGroup();
        const parent = group?.index !== undefined ? group : group?.parent;
        readModifiers(end, { line, column: i - lineStart + 1, kind: callNames[word], parent });
      }
      lastWord = word;
      previous = /^\d/.test(word) ? "value" : "word";
      i = end;
      continue;
    }
    const closer = ({ "(": ")", "[": "]", "{": "}" } as Record<string, string>)[char];
    if (closer) {
      const frame: Frame = pendingEach?.at === i ? { close: closer, each: pendingEach.call } : { close: closer };
      frame.group = pendingGroup?.at === i ? pendingGroup.call : currentGroup();
      stack.push(frame);
    } else if (char === ")" || char === "]" || char === "}") {
      const top = stack[stack.length - 1];
      if (top && "template" in top) {
        if (char === "}") {
          stack.pop();
          i = templateText(top.template, i + 1);
          continue;
        }
      } else if (top?.close === char) {
        stack.pop();
        if (top.each) expectName(i + 1, top.each);
      }
    }
    previous = char === ")" || char === "]" || char === "}" ? "value" : "operator";
    i++;
  }
  return calls;
}

/**
 * Finds tests and groups whose names contain a story ID. Each path names a
 * file or a folder inside the root. In a folder, `*.test.*` and `*.spec.*`
 * files and every script under `test`, `tests` and `__tests__` folders are
 * read, skipping `node_modules`, `dist`, `build` and dot folders. Paths that
 * lead outside the root, directly or through a symbolic link, are reported
 * and not read. No test code is loaded or run.
 */
export async function findStoryTests(loaded: LoadedStoryMap, root: string, { paths }: { paths: string[] }): Promise<FoundStoryTests> {
  const tests: FoundStoryTest[] = [];
  const issues: ReferenceIssue[] = [];
  const pattern = storyIdPattern(loaded);
  const realRoot = await realpath(root);
  const shown = (file: string) => relative(realRoot, file).split(sep).join("/");
  const read = new Set<string>();

  for (const path of paths) {
    const resolved = await resolveRootedPath(root, realRoot, path);
    if (resolved.kind === "issue") {
      issues.push(resolved.issue);
      continue;
    }
    const outside: string[] = [];
    const files = resolved.kind === "inside" ? await repositoryFiles(realRoot, resolved.path, testFileFilter, outside) : [];
    for (const link of outside) issues.push(outsideLinkIssue(shown(link)));
    if (!files.length) {
      issues.push({ severity: "error", path: [], file: path, message: "No test files found. Pass a folder or file that holds the tests.", rule: "tests-not-found" });
      continue;
    }
    for (const file of files) {
      if (read.has(file)) continue;
      read.add(file);
      const source = await readTextFileWithin(file, maxTestFileBytes);
      if (source === undefined) {
        issues.push({ severity: "warning", path: [], file: shown(file), message: `Larger than ${maxTestFileBytes / 1024 / 1024} MB, so its tests were not read. Split the file to have its tests counted.`, rule: "test-file-too-large" });
        continue;
      }
      if (!pattern) continue;
      // Each call's IDs: its own, then those of the groups around it, innermost first.
      const idsOf: string[][] = [];
      for (const call of scanTestCalls(source)) {
        const own = [...new Set(Array.from(call.literal.matchAll(pattern), match => match[0]))];
        // Capped like the index, so deeply nested tagged blocks stay quick to read.
        const inheritedIds = call.parent === undefined ? [] : idsOf[call.parent].filter(id => !own.includes(id)).slice(0, testStoryIdsMaxItems);
        const storyIds = [...own, ...inheritedIds];
        idsOf.push(storyIds);
        if (!storyIds.length) continue;
        const test: FoundStoryTest = { storyIds, file: shown(file), line: call.line, column: call.column, name: call.name, kind: call.kind };
        if (inheritedIds.length) test.inheritedIds = inheritedIds;
        tests.push(test);
      }
    }
  }
  tests.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0) || a.line - b.line || a.column - b.column);
  return { tests, issues };
}

/**
 * Builds the tests index from found tests. IDs that are not in the map are
 * left out and returned in `unknownIds`, in the order first found. Names are
 * cut to `testNameMaxLength`, and tests beyond the per-story and total limits
 * are counted in `omitted`, so `parseStoryMapTests` accepts the result.
 */
export function buildStoryMapTests(loaded: LoadedStoryMap, found: FoundStoryTest[], now = new Date()): { index: StoryMapTests; unknownIds: string[] } {
  const known = new Set(loaded.map.stories.map(story => story.id));
  const unknownIds = new Set<string>();
  const perStory = new Map<string, number>();
  const omitted = new Map<string, OmittedStoryTests>();
  const tests: StoryTestEntry[] = [];

  for (const test of found) {
    const ids = test.storyIds.filter(id => {
      if (known.has(id)) return true;
      unknownIds.add(id);
      return false;
    });
    const listed: string[] = [];
    for (const id of ids) {
      const fits = tests.length < testsMaxItems && (perStory.get(id) ?? 0) < testsPerStoryMaxItems && listed.length < testStoryIdsMaxItems;
      if (fits) {
        listed.push(id);
        continue;
      }
      const key = `${id}\n${test.file}`;
      const entry = omitted.get(key);
      if (entry) entry.count++;
      else omitted.set(key, { storyId: id, file: test.file, count: 1 });
    }
    if (!listed.length) continue;
    for (const id of listed) perStory.set(id, (perStory.get(id) ?? 0) + 1);
    const entry: StoryTestEntry = { storyIds: listed, file: test.file, line: test.line, name: present(fitHistoryText(test.name, testNameMaxLength), `the name of the test at ${test.file}:${test.line}`), kind: test.kind };
    const inheritedIds = listed.filter(id => test.inheritedIds?.includes(id));
    if (inheritedIds.length) entry.inheritedIds = inheritedIds;
    tests.push(entry);
  }

  const index: StoryMapTests = { version: 1, generatedAt: now.toISOString(), tests };
  if (omitted.size) index.omitted = [...omitted.values()].slice(0, testsOmittedMaxItems);
  return { index, unknownIds: [...unknownIds] };
}

/**
 * The checks `validate --tests` runs on found tests: an error for each tag
 * naming a story that is not in the map, at the test or group whose name has
 * it, and a warning for each
 * `in-progress` or `merged` story that no test names, at the story.
 */
export function checkStoryTests(loaded: LoadedStoryMap, found: FoundStoryTest[]): ReferenceIssue[] {
  const known = new Set(loaded.map.stories.map(story => story.id));
  const tagged = new Set(found.flatMap(test => test.storyIds));
  const issues: ReferenceIssue[] = [];
  for (const test of found) {
    for (const id of test.storyIds) {
      // An unknown ID in a group's name is reported once, at the group, not at every test inside it.
      if (known.has(id) || test.inheritedIds?.includes(id)) continue;
      issues.push({
        severity: "error",
        path: [],
        file: test.file,
        line: test.line,
        column: test.column,
        message: `Unknown story ID '${id}' in a test name. Add the story to the map or correct the tag.`,
        rule: "unknown-test-story",
      });
    }
  }
  for (const warning of untestedStoryWarnings(loaded.map, tagged)) issues.push({ ...warning, ...loaded.locate(warning.path) });
  return issues;
}
