/**
 * A tiny client for Langfuse's public API, only for reading what the agents traced.
 *
 * The agents (Python) write the traces; here we read them back for the panel. We use the v2 observations
 * endpoint: it is Langfuse's real-time read path, while the older ones can lag by minutes and are being
 * retired.
 */

/** One observation as the v2 API returns it, with the field groups we ask for. */
export interface Observation {
  id: string;
  traceId: string;
  projectId: string;
  parentObservationId: string | null;
  /** AGENT, CHAIN, GENERATION (a model call), TOOL, SPAN, ... */
  type: string;
  name: string;
  startTime: string;
  endTime: string | null;
  level?: string;
  statusMessage?: string | null;
  model?: string | null;
  usageDetails?: Record<string, number>;
  totalCost?: number | null;
}

export interface LangfuseConfig {
  baseUrl: string;
  publicKey: string;
  secretKey: string;
  environment: string;
}

/** Same settings as the agents read, so both sides talk to the same project and environment. */
export function langfuseConfig(): LangfuseConfig | null {
  const publicKey = process.env.LANGFUSE_PUBLIC_KEY;
  const secretKey = process.env.LANGFUSE_SECRET_KEY;
  if (!publicKey || !secretKey) return null;
  const baseUrl = process.env.LANGFUSE_BASE_URL || process.env.LANGFUSE_HOST || 'https://cloud.langfuse.com';
  return {
    baseUrl: baseUrl.replace(/\/+$/, ''),
    publicKey,
    secretKey,
    environment: process.env.LANGFUSE_TRACING_ENVIRONMENT || 'development',
  };
}

const FIELDS = 'core,basic,model,usage';
const PAGE_SIZE = 1000;
const MAX_PAGES = 5;

/** Every observation of a session (all the traces of one ticket), oldest first. */
export async function sessionObservations(config: LangfuseConfig, sessionId: string, from: Date): Promise<Observation[]> {
  const headers = { Authorization: `Basic ${Buffer.from(`${config.publicKey}:${config.secretKey}`).toString('base64')}` };
  const observations: Observation[] = [];
  let cursor: string | undefined;
  for (let page = 0; page < MAX_PAGES; page++) {
    const params = new URLSearchParams({
      sessionId,
      environment: config.environment,
      fromStartTime: from.toISOString(),
      fields: FIELDS,
      limit: String(PAGE_SIZE),
    });
    if (cursor) params.set('cursor', cursor);
    const response = await fetch(`${config.baseUrl}/api/public/v2/observations?${params}`, {
      headers,
      signal: AbortSignal.timeout(10_000),
    });
    if (!response.ok) throw new Error(`Langfuse answered ${response.status}`);
    const body = (await response.json()) as { data: Observation[]; meta?: { cursor?: string | null } };
    observations.push(...body.data);
    cursor = body.meta?.cursor ?? undefined;
    if (!cursor) break;
  }
  return observations.sort((a, b) => a.startTime.localeCompare(b.startTime));
}
