import { randomUUID } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { z } from "zod";

import { resolveGrokSessionDirectory } from "./grok-subagent-meta.js";

export const GROK_REWIND_POINTS_METHOD = "_x.ai/rewind/points";
export const GROK_REWIND_EXECUTE_METHOD = "_x.ai/rewind/execute";
export const GROK_SESSION_FORK_METHOD = "_x.ai/session/fork";

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
    success: z.boolean().optional(),
    error: z.string().nullish(),
  })
  .passthrough();

const GrokSessionForkResultSchema = z
  .object({
    newSessionId: z.string().min(1),
  })
  .passthrough();

export type GrokRewindPoint = z.infer<typeof GrokRewindPointSchema>;

export interface GrokRewindExtMethod {
  (method: string, params: Record<string, unknown>): Promise<unknown>;
}

export interface RevertGrokConversationInput {
  sessionId: string;
  cwd: string;
  messageId: string;
  userMessageIds: readonly string[];
  extMethod: GrokRewindExtMethod;
  loadSession: (sessionId: string) => Promise<void>;
  startFreshSession: () => Promise<void>;
  env?: Record<string, string | undefined>;
}

export interface TruncateGrokSessionHistoryInput {
  updatesJsonl: string;
  chatHistoryJsonl: string;
  rewindPointsJsonl: string;
  keepPromptCount: number;
}

export interface TruncateGrokSessionHistoryResult {
  updatesJsonl: string;
  chatHistoryJsonl: string;
  rewindPointsJsonl: string;
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

function parseJsonlObjects(text: string): unknown[] {
  const rows: unknown[] = [];
  for (const line of text.split("\n")) {
    const trimmed = line.trim();
    if (!trimmed) continue;
    try {
      rows.push(JSON.parse(trimmed));
    } catch {
      // Grok skips malformed jsonl rows; keep the same tolerance.
    }
  }
  return rows;
}

function encodeJsonl(rows: unknown[]): string {
  if (rows.length === 0) return "";
  return `${rows.map((row) => JSON.stringify(row)).join("\n")}\n`;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return value != null && typeof value === "object" && !Array.isArray(value);
}

function readPromptIndex(value: unknown): number | null {
  if (!isRecord(value)) return null;
  const direct = value.prompt_index ?? value.promptIndex;
  if (typeof direct === "number" && Number.isInteger(direct) && direct >= 0) {
    return direct;
  }
  const nested = value._meta;
  if (!isRecord(nested)) return null;
  const fromMeta = nested.prompt_index ?? nested.promptIndex;
  if (typeof fromMeta === "number" && Number.isInteger(fromMeta) && fromMeta >= 0) {
    return fromMeta;
  }
  return null;
}

function readSessionUpdate(value: unknown): Record<string, unknown> | null {
  if (!isRecord(value)) return null;
  const params = isRecord(value.params) ? value.params : value;
  const update = isRecord(params.update) ? params.update : params;
  return isRecord(update) ? update : null;
}

export function truncateGrokSessionHistory(
  input: TruncateGrokSessionHistoryInput,
): TruncateGrokSessionHistoryResult {
  const updates: unknown[] = [];
  for (const row of parseJsonlObjects(input.updatesJsonl)) {
    const update = readSessionUpdate(row);
    if (update?.sessionUpdate === "user_message_chunk") {
      const promptIndex = readPromptIndex(update);
      if (promptIndex != null && promptIndex >= input.keepPromptCount) {
        break;
      }
    }
    updates.push(row);
  }

  const chatHistory: unknown[] = [];
  for (const row of parseJsonlObjects(input.chatHistoryJsonl)) {
    if (isRecord(row) && row.type === "user") {
      const promptIndex = readPromptIndex(row);
      if (promptIndex != null && promptIndex >= input.keepPromptCount) {
        break;
      }
    }
    chatHistory.push(row);
  }

  const rewindPoints = parseJsonlObjects(input.rewindPointsJsonl).filter((row) => {
    const promptIndex = readPromptIndex(row);
    return promptIndex == null || promptIndex < input.keepPromptCount;
  });

  return {
    updatesJsonl: encodeJsonl(updates),
    chatHistoryJsonl: encodeJsonl(chatHistory),
    rewindPointsJsonl: encodeJsonl(rewindPoints),
  };
}

export function truncateGrokForkedSession(input: {
  cwd: string;
  sessionId: string;
  keepPromptCount: number;
  env?: Record<string, string | undefined>;
}): void {
  const directory = resolveGrokSessionDirectory({
    sessionId: input.sessionId,
    cwd: input.cwd,
    env: input.env,
  });
  if (!directory) {
    throw new Error(`Grok forked session ${input.sessionId} is missing on disk`);
  }

  const updatesPath = join(directory, "updates.jsonl");
  const chatPath = join(directory, "chat_history.jsonl");
  const rewindPath = join(directory, "rewind_points.jsonl");
  const truncated = truncateGrokSessionHistory({
    updatesJsonl: existsSync(updatesPath) ? readFileSync(updatesPath, "utf8") : "",
    chatHistoryJsonl: existsSync(chatPath) ? readFileSync(chatPath, "utf8") : "",
    rewindPointsJsonl: existsSync(rewindPath) ? readFileSync(rewindPath, "utf8") : "",
    keepPromptCount: input.keepPromptCount,
  });
  if (existsSync(updatesPath) || truncated.updatesJsonl.length > 0) {
    writeFileSync(updatesPath, truncated.updatesJsonl);
  }
  if (existsSync(chatPath) || truncated.chatHistoryJsonl.length > 0) {
    writeFileSync(chatPath, truncated.chatHistoryJsonl);
  }
  if (existsSync(rewindPath) || truncated.rewindPointsJsonl.length > 0) {
    writeFileSync(rewindPath, truncated.rewindPointsJsonl);
  }
}

export async function revertGrokConversation(input: RevertGrokConversationInput): Promise<void> {
  if (input.sessionId.length === 0) {
    throw new Error("Grok session is not ready for rewind");
  }

  const points = parseGrokRewindPoints(
    await input.extMethod(GROK_REWIND_POINTS_METHOD, { sessionId: input.sessionId }),
  );
  const clickedPromptIndex = resolveGrokRewindPromptIndex({
    messageId: input.messageId,
    userMessageIds: input.userMessageIds,
    points,
  });
  // Grok cannot execute a rewind at prompt zero, so dropping the first prompt
  // requires a fresh session. Later prompts are identified by their own index.
  if (clickedPromptIndex === 0) {
    await input.startFreshSession();
    return;
  }
  const result = GrokRewindExecuteResultSchema.parse(
    await input.extMethod(GROK_REWIND_EXECUTE_METHOD, {
      sessionId: input.sessionId,
      targetPromptIndex: clickedPromptIndex,
      mode: "conversation_only",
    }),
  );
  if (result.success !== false) {
    return;
  }
  // Grok 1.0.5 ACP rewind/execute returns success:false with error:null because
  // the extension never reaches the session rewind actor. Fork, drop prompts at
  // and after the clicked index from the fork's on-disk history, then load that
  // fork so Grok's next prompt sees the truncated conversation.
  const fork = GrokSessionForkResultSchema.parse(
    await input.extMethod(GROK_SESSION_FORK_METHOD, {
      sourceSessionId: input.sessionId,
      sourceCwd: input.cwd,
      newCwd: input.cwd,
      newSessionId: randomUUID(),
    }),
  );
  truncateGrokForkedSession({
    cwd: input.cwd,
    sessionId: fork.newSessionId,
    keepPromptCount: clickedPromptIndex,
    env: input.env,
  });
  await input.loadSession(fork.newSessionId);
}
