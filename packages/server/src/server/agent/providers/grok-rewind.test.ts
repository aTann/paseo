import { describe, expect, test, vi } from "vitest";

import { asInternals } from "../../test-utils/class-mocks.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentStreamEvent, AgentTimelineItem } from "../agent-sdk-types.js";
import { ACPAgentSession } from "./acp-agent.js";
import {
  GROK_REWIND_EXECUTE_METHOD,
  GROK_REWIND_POINTS_METHOD,
  parseGrokRewindPoints,
  resolveGrokRewindPromptIndex,
  revertGrokConversation,
} from "./grok-rewind.js";

interface RewindSessionInternals {
  sessionId: string | null;
  connection: { extMethod: (...args: unknown[]) => Promise<unknown> } | null;
  pushEvent(event: AgentStreamEvent): void;
}

describe("parseGrokRewindPoints", () => {
  test("reads prompt indexes from a points envelope", () => {
    expect(
      parseGrokRewindPoints({
        points: [
          { prompt_index: 0, prompt_text: "first" },
          { prompt_index: 1, prompt_preview: "second" },
        ],
      }),
    ).toEqual([
      { prompt_index: 0, prompt_text: "first" },
      { prompt_index: 1, prompt_preview: "second" },
    ]);
  });

  test("reads rewind_points and a bare array", () => {
    expect(parseGrokRewindPoints({ rewind_points: [{ prompt_index: 2 }] })).toEqual([
      { prompt_index: 2 },
    ]);
    expect(parseGrokRewindPoints([{ prompt_index: 3 }])).toEqual([{ prompt_index: 3 }]);
  });
});

describe("resolveGrokRewindPromptIndex", () => {
  test("uses the ordered user-message list as Grok prompt_index", () => {
    expect(
      resolveGrokRewindPromptIndex({
        messageId: "msg-b",
        userMessageIds: ["msg-a", "msg-b", "msg-c"],
        points: [{ prompt_index: 0 }, { prompt_index: 1 }, { prompt_index: 2 }],
      }),
    ).toBe(1);
  });

  test("rejects a message that is not in the tracked conversation", () => {
    expect(() =>
      resolveGrokRewindPromptIndex({
        messageId: "missing",
        userMessageIds: ["msg-a"],
        points: [{ prompt_index: 0 }],
      }),
    ).toThrow("Grok could not find user message missing");
  });

  test("rejects a tracked message that Grok has no rewind point for", () => {
    expect(() =>
      resolveGrokRewindPromptIndex({
        messageId: "msg-c",
        userMessageIds: ["msg-a", "msg-b", "msg-c"],
        points: [{ prompt_index: 0 }, { prompt_index: 1 }],
      }),
    ).toThrow("Grok has no rewind point for user message msg-c");
  });
});

describe("revertGrokConversation", () => {
  test("executes conversation-only rewind at the matched prompt index", async () => {
    const recorded: Array<{ method: string; params: Record<string, unknown> }> = [];

    await revertGrokConversation({
      sessionId: "session-1",
      messageId: "msg-b",
      userMessageIds: ["msg-a", "msg-b"],
      extMethod: async (method, params) => {
        recorded.push({ method, params });
        if (method === GROK_REWIND_POINTS_METHOD) {
          return { points: [{ prompt_index: 0 }, { prompt_index: 1 }] };
        }
        return {};
      },
    });

    expect(recorded).toEqual([
      {
        method: GROK_REWIND_POINTS_METHOD,
        params: { sessionId: "session-1" },
      },
      {
        method: GROK_REWIND_EXECUTE_METHOD,
        params: {
          sessionId: "session-1",
          targetPromptIndex: 1,
          conversation_only: true,
        },
      },
    ]);
  });

  test("does not execute when the session is missing", async () => {
    await expect(
      revertGrokConversation({
        sessionId: "",
        messageId: "msg-a",
        userMessageIds: ["msg-a"],
        extMethod: async () => {
          throw new Error("extMethod should not run");
        },
      }),
    ).rejects.toThrow("Grok session is not ready for rewind");
  });
});

describe("ACPAgentSession Grok conversation rewind", () => {
  test("executes Grok conversation rewind and refills streamHistory with remaining turns", async () => {
    const extMethod = vi.fn(async (method: string) => {
      if (method === GROK_REWIND_POINTS_METHOD) {
        return { points: [{ prompt_index: 0 }, { prompt_index: 1 }] };
      }
      return {};
    });
    const session = createGrokRewindSession();
    const internals = asInternals<RewindSessionInternals>(session);
    internals.sessionId = "session-1";
    internals.connection = { extMethod };

    internals.pushEvent(timelineEvent(userMessage("first", "msg-a")));
    internals.pushEvent(timelineEvent(assistantMessage("ok", "asst-1")));
    internals.pushEvent(timelineEvent(userMessage("second", "msg-b")));
    internals.pushEvent(timelineEvent(assistantMessage("later", "asst-2")));

    expect(await collectHistory(session)).toEqual([]);

    await session.revertConversation?.({ messageId: "msg-b" });

    expect(extMethod).toHaveBeenNthCalledWith(1, GROK_REWIND_POINTS_METHOD, {
      sessionId: "session-1",
    });
    expect(extMethod).toHaveBeenNthCalledWith(2, GROK_REWIND_EXECUTE_METHOD, {
      sessionId: "session-1",
      targetPromptIndex: 1,
      conversation_only: true,
    });
    expect(await collectHistory(session)).toEqual([
      timelineEvent(userMessage("first", "msg-a")),
      timelineEvent(assistantMessage("ok", "asst-1")),
    ]);
  });
});

function createGrokRewindSession(): ACPAgentSession {
  return new ACPAgentSession(
    {
      provider: "acp",
      cwd: "/tmp/grok-rewind",
    },
    {
      provider: "acp",
      logger: createTestLogger(),
      defaultCommand: ["grok", "agent", "stdio"],
      defaultModes: [],
      capabilities: {
        supportsStreaming: true,
        supportsSessionPersistence: true,
        supportsDynamicModes: true,
        supportsMcpServers: true,
        supportsReasoningStream: true,
        supportsToolInvocations: true,
        supportsRewindConversation: true,
        supportsRewindFiles: false,
        supportsRewindBoth: false,
      },
      conversationRewinder: revertGrokConversation,
    },
  );
}

function userMessage(text: string, messageId: string): AgentTimelineItem {
  return { type: "user_message", text, messageId };
}

function assistantMessage(text: string, messageId: string): AgentTimelineItem {
  return { type: "assistant_message", text, messageId };
}

function timelineEvent(item: AgentTimelineItem): AgentStreamEvent {
  return { type: "timeline", provider: "acp", item };
}

async function collectHistory(session: ACPAgentSession): Promise<AgentStreamEvent[]> {
  const events: AgentStreamEvent[] = [];
  for await (const event of session.streamHistory()) {
    events.push(event);
  }
  return events;
}
