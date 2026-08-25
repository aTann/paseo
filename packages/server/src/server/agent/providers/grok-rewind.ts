import { z } from "zod";

import type { ACPConversationRewindContext } from "./acp-agent.js";

export const GROK_REWIND_POINTS_METHOD = "_x.ai/rewind/points";
export const GROK_REWIND_EXECUTE_METHOD = "_x.ai/rewind/execute";

const GROK_EXECUTE_MODE = {
  conversation: "conversation_only",
  files: "files_only",
  both: "all",
} as const;

const GrokRewindPointSchema = z
  .object({
    prompt_index: z.number().int().nonnegative(),
    prompt_text: z.string().optional(),
    prompt_preview: z.string().optional(),
  })
  .passthrough();

const GrokRewindPointsEnvelopeSchema = z
  .object({
    points: z.array(GrokRewindPointSchema).optional(),
    rewind_points: z.array(GrokRewindPointSchema).optional(),
  })
  .passthrough();

const GrokRewindExecuteResultSchema = z
  .object({
    success: z.boolean(),
    error: z.string().nullish(),
  })
  .passthrough();

export type GrokRewindPoint = z.infer<typeof GrokRewindPointSchema>;

export function parseGrokRewindPoints(value: unknown): GrokRewindPoint[] {
  if (Array.isArray(value)) {
    return z.array(GrokRewindPointSchema).parse(value);
  }
  const envelope = GrokRewindPointsEnvelopeSchema.parse(value ?? {});
  return envelope.points ?? envelope.rewind_points ?? [];
}

export function resolveGrokRewindPromptIndex(input: {
  messageId: string;
  userMessageIds: readonly string[];
  points: readonly GrokRewindPoint[];
}): number {
  const index = input.userMessageIds.indexOf(input.messageId);
  if (index < 0) {
    throw new Error(`Grok could not find user message ${input.messageId}`);
  }
  if (input.points.length > 0 && !input.points.some((point) => point.prompt_index === index)) {
    throw new Error(`Grok has no rewind point for user message ${input.messageId}`);
  }
  return index;
}

export async function revertGrok(input: ACPConversationRewindContext): Promise<void> {
  if (input.sessionId.length === 0) {
    throw new Error("Grok session is not ready for rewind");
  }

  const points = parseGrokRewindPoints(
    await input.extMethod(GROK_REWIND_POINTS_METHOD, { sessionId: input.sessionId }),
  );
  const targetPromptIndex = resolveGrokRewindPromptIndex({
    messageId: input.messageId,
    userMessageIds: input.userMessageIds,
    points,
  });
  const result = GrokRewindExecuteResultSchema.parse(
    await input.extMethod(GROK_REWIND_EXECUTE_METHOD, {
      sessionId: input.sessionId,
      targetPromptIndex,
      force: true,
      mode: GROK_EXECUTE_MODE[input.mode],
    }),
  );
  if (!result.success) {
    throw new Error(result.error ?? "Grok rewind failed");
  }
}
