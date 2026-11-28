/**
 * Returns `value`, or throws an internal error naming what was missing.
 * Use it only where a missing value means a bug in this package, never for bad map input or
 * command arguments: those get a message that says what the person should add.
 */
export function present<T>(value: T | null | undefined, what: string): T {
  if (value === undefined || value === null) throw new Error(`Internal error: ${what} is missing. Please report this as a bug in Auto Story Map.`);
  return value;
}
