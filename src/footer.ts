/**
 * Session ids are UUIDv7: the first 13 characters encode the creation millisecond, so two sessions
 * only share this prefix if they started in the same millisecond. `pi --session` accepts a prefix.
 */
export const SESSION_ID_PREFIX = 13;

export const shortSessionId = (id: string) => id.slice(0, SESSION_ID_PREFIX);

export function formatModel(id: string | undefined, thinking: string | undefined): string {
  const name = (id ?? "no model").replace(/^claude-/, "");
  return thinking ? `${name} ${thinking}` : name;
}

export function formatContext(percent: number | null | undefined): string {
  return percent == null ? "?" : `${Math.round(percent)}%`;
}

export function formatLocation(cwdName: string, branch: string | null | undefined): string {
  return branch ? `${cwdName} (${branch})` : cwdName;
}
