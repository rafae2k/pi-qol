/** Settings live under the "pi-qol" key of pi's settings.json (global or project). */
export interface QolConfig {
  /** "provider/model-id" used to write summaries. Defaults to the session's model. */
  summaryModel?: string;
  /** User messages between automatic summary refreshes. */
  summaryEvery: number;
  /** Language of the summary, e.g. "English". Defaults to the language the user writes in. */
  summaryLanguage?: string;
}

export const DEFAULT_SUMMARY_EVERY = 3;

export function readConfig(settings: unknown): QolConfig {
  const raw = ((settings as Record<string, unknown> | undefined)?.["pi-qol"] ?? {}) as Record<string, unknown>;
  const every = Number(raw.summaryEvery);
  return {
    summaryModel: typeof raw.summaryModel === "string" && raw.summaryModel.includes("/") ? raw.summaryModel : undefined,
    summaryEvery: Number.isInteger(every) && every > 0 ? every : DEFAULT_SUMMARY_EVERY,
    summaryLanguage: typeof raw.summaryLanguage === "string" && raw.summaryLanguage ? raw.summaryLanguage : undefined,
  };
}

export function splitModelRef(ref: string): [provider: string, id: string] {
  const i = ref.indexOf("/");
  return [ref.slice(0, i), ref.slice(i + 1)];
}
