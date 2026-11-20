/** After the configured summary model fails, skip it for this long and go straight to the session model. */
export const FALLBACK_COOLDOWN_MS = 5 * 60_000;

export interface ModelRef {
  provider: string;
  id: string;
}

const same = (a: ModelRef, b: ModelRef) => a.provider === b.provider && a.id === b.id;

/**
 * Models to try for a summary, in order: the configured one (unless it failed recently), then the
 * session's model. Switching the conversation to another provider therefore moves the summary along
 * whenever the configured model is out of quota or unreachable.
 */
export function summaryCandidates<T extends ModelRef>(
  configured: T | undefined,
  session: T | undefined,
  configuredFailedUntil: number,
  now: number,
): T[] {
  const out: T[] = [];
  if (configured && now >= configuredFailedUntil) out.push(configured);
  if (session && !out.some((m) => same(m, session))) out.push(session);
  // Everything is cooling down and there is no other model: still try the configured one.
  if (out.length === 0 && configured) out.push(configured);
  return out;
}
