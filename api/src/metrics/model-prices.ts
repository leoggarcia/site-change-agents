/**
 * List prices per million tokens, from Langfuse's model price table (Oct 2026), which is also what Langfuse
 * uses for the costs in its traces. On Gemini's free tier the real cost is $0; these show what the same
 * work would cost on a paid plan.
 */
export const MODEL_PRICES: Record<string, { input: number; output: number }> = {
  'gemini-3.5-flash-lite': { input: 0.3, output: 2.5 },
  'gemini-3.1-flash-lite': { input: 0.25, output: 1.5 },
};

export const PRICE_SOURCE = "Langfuse's model price table, October 2026";

/** The model each agent runs on, from the same settings the agents read ("provider:model"). */
export function agentModel(agent: 'intake' | 'coder' | 'reviewer'): string {
  const defaults = {
    intake: 'google_genai:gemini-3.5-flash-lite',
    coder: 'google_genai:gemini-3.5-flash-lite',
    reviewer: 'google_genai:gemini-3.1-flash-lite',
  };
  const setting = process.env[`${agent.toUpperCase()}_MODEL`] || defaults[agent];
  return setting.split(':').pop()!;
}

export function costUsd(model: string, inputTokens: number, outputTokens: number): number | null {
  const price = MODEL_PRICES[model];
  if (!price) return null;
  return (inputTokens * price.input + outputTokens * price.output) / 1_000_000;
}
