import { z } from "zod";

export const GROK_REWIND_POINTS_METHOD = "x.ai/rewind/points";
export const GROK_REWIND_EXECUTE_METHOD = "x.ai/rewind/execute";

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

export type GrokRewindPoint = z.infer<typeof GrokRewindPointSchema>;

export interface GrokRewindExtMethod {
  (method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface RevertGrokConversationInput {
  sessionId: string;
  messageId: string;
  userMessageIds: readonly string[];
  extMethod: GrokRewindExtMethod;
}

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

export async function revertGrokConversation(input: RevertGrokConversationInput): Promise<void> {
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
  await input.extMethod(GROK_REWIND_EXECUTE_METHOD, {
    sessionId: input.sessionId,
    targetPromptIndex,
    conversation_only: true,
  });
}
