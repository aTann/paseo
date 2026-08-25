import { mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { afterEach, describe, expect, test, vi } from "vitest";

import { asInternals } from "../../test-utils/class-mocks.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";
import type { AgentStreamEvent, AgentTimelineItem } from "../agent-sdk-types.js";
import { ACPAgentSession } from "./acp-agent.js";
import {
  GROK_REWIND_EXECUTE_METHOD,
  GROK_REWIND_POINTS_METHOD,
  GROK_SESSION_FORK_METHOD,
  parseGrokRewindPoints,
  resolveGrokRewindPromptIndex,
  revertGrokConversation,
  truncateGrokSessionHistory,
} from "./grok-rewind.js";
import { encodeGrokSessionsCwdDirname } from "./grok-subagent-meta.js";

interface RewindSessionInternals {
  sessionId: string | null;
  connection: {
    extMethod: (...args: unknown[]) => Promise<unknown>;
    loadSession: (...args: unknown[]) => Promise<Record<string, unknown>>;
    newSession: (...args: unknown[]) => Promise<{ sessionId: string }>;
  } | null;
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

describe("truncateGrokSessionHistory", () => {
  test("keeps updates, chat, and rewind points before the clicked prompt", () => {
    const truncated = truncateGrokSessionHistory({
      keepPromptCount: 1,
      updatesJsonl: [
        updateLine(0, "one"),
        thoughtLine("thinking one"),
        assistantLine("one"),
        updateLine(1, "two"),
        assistantLine("two"),
      ].join("\n"),
      chatHistoryJsonl: [
        JSON.stringify({ type: "system", content: "sys" }),
        JSON.stringify({ type: "user", prompt_index: 0, content: "one" }),
        JSON.stringify({ type: "assistant", content: "one" }),
        JSON.stringify({ type: "user", prompt_index: 1, content: "two" }),
        JSON.stringify({ type: "assistant", content: "two" }),
      ].join("\n"),
      rewindPointsJsonl: [
        JSON.stringify({ prompt_index: 0 }),
        JSON.stringify({ prompt_index: 1 }),
      ].join("\n"),
    });

    expect(truncated.updatesJsonl).toBe(
      [updateLine(0, "one"), thoughtLine("thinking one"), assistantLine("one")].join("\n") + "\n",
    );
    expect(truncated.chatHistoryJsonl).toBe(
      [
        JSON.stringify({ type: "system", content: "sys" }),
        JSON.stringify({ type: "user", prompt_index: 0, content: "one" }),
        JSON.stringify({ type: "assistant", content: "one" }),
      ].join("\n") + "\n",
    );
    expect(truncated.rewindPointsJsonl).toBe(`${JSON.stringify({ prompt_index: 0 })}\n`);
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
  const tempDirs: string[] = [];

  afterEach(() => {
    for (const dir of tempDirs.splice(0)) {
      rmSync(dir, { recursive: true, force: true });
    }
  });

  test("starts a fresh session when rewinding the first prompt", async () => {
    const recorded: string[] = [];

    await revertGrokConversation({
      sessionId: "session-1",
      cwd: "/workspace",
      messageId: "msg-a",
      userMessageIds: ["msg-a", "msg-b"],
      extMethod: async (method) => {
        recorded.push(method);
        if (method === GROK_REWIND_POINTS_METHOD) {
          return { points: [{ prompt_index: 0 }, { prompt_index: 1 }] };
        }
        throw new Error("execute should not run for the first prompt");
      },
      loadSession: async () => {
        throw new Error("loadSession should not run for the first prompt");
      },
      startFreshSession: async () => {
        recorded.push("fresh");
      },
    });

    expect(recorded).toEqual([GROK_REWIND_POINTS_METHOD, "fresh"]);
  });

  test("executes conversation-only rewind keeping prompts before the clicked message", async () => {
    const recorded: Array<{ method: string; params: Record<string, unknown> }> = [];

    await revertGrokConversation({
      sessionId: "session-1",
      cwd: "/workspace",
      messageId: "msg-b",
      userMessageIds: ["msg-a", "msg-b"],
      loadSession: async () => {
        throw new Error("loadSession should not run when execute succeeds");
      },
      startFreshSession: async () => {
        throw new Error("startFreshSession should not run for a later prompt");
      },
      extMethod: async (method, params) => {
        recorded.push({ method, params });
        if (method === GROK_REWIND_POINTS_METHOD) {
          return { points: [{ prompt_index: 0 }, { prompt_index: 1 }] };
        }
        if (params.targetPromptIndex === 0) {
          return {
            success: false,
            error: null,
            target_prompt_index: 0,
            mode: "conversation_only",
            reverted_files: [],
            clean_files: [],
            conflicts: [],
            prompt_text: null,
          };
        }
        return { success: true };
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
          mode: "conversation_only",
        },
      },
    ]);
  });

  test("does not execute when the session is missing", async () => {
    await expect(
      revertGrokConversation({
        sessionId: "",
        cwd: "/workspace",
        messageId: "msg-a",
        userMessageIds: ["msg-a"],
        loadSession: async () => {
          throw new Error("loadSession should not run");
        },
        startFreshSession: async () => {
          throw new Error("startFreshSession should not run");
        },
        extMethod: async () => {
          throw new Error("extMethod should not run");
        },
      }),
    ).rejects.toThrow("Grok session is not ready for rewind");
  });

  test("does not claim success when the forked session is missing on disk", async () => {
    const grokHome = mkdtempSync(join(tmpdir(), "paseo-grok-rewind-missing-"));
    tempDirs.push(grokHome);
    const loaded: string[] = [];
    await expect(
      revertGrokConversation({
        sessionId: "session-1",
        cwd: "/workspace",
        messageId: "msg-b",
        userMessageIds: ["msg-a", "msg-b"],
        env: { GROK_HOME: grokHome },
        loadSession: async (sessionId) => {
          loaded.push(sessionId);
        },
        startFreshSession: async () => {
          throw new Error("startFreshSession should not run");
        },
        extMethod: async (method) => {
          if (method === GROK_REWIND_POINTS_METHOD) {
            return { rewind_points: [{ prompt_index: 0 }, { prompt_index: 1 }] };
          }
          if (method === GROK_SESSION_FORK_METHOD) {
            return { newSessionId: "session-fork" };
          }
          return {
            success: false,
            error: null,
            mode: "conversation_only",
          };
        },
      }),
    ).rejects.toThrow("Grok forked session session-fork is missing on disk");
    expect(loaded).toEqual([]);
  });

  test("forks and truncates on-disk history when rewind execute cannot reach the session actor", async () => {
    const grokHome = mkdtempSync(join(tmpdir(), "paseo-grok-rewind-fork-"));
    tempDirs.push(grokHome);
    const cwd = "/workspace";
    writeGrokSessionFiles(grokHome, cwd, "session-fork");
    const recorded: Array<{ method: string; params: Record<string, unknown> }> = [];
    const loaded: string[] = [];

    await revertGrokConversation({
      sessionId: "session-1",
      cwd,
      messageId: "msg-b",
      userMessageIds: ["msg-a", "msg-b"],
      env: { GROK_HOME: grokHome },
      loadSession: async (sessionId) => {
        loaded.push(sessionId);
      },
      startFreshSession: async () => {
        throw new Error("startFreshSession should not run");
      },
      extMethod: async (method, params) => {
        recorded.push({ method, params });
        if (method === GROK_REWIND_POINTS_METHOD) {
          return { points: [{ prompt_index: 0 }, { prompt_index: 1 }] };
        }
        if (method === GROK_SESSION_FORK_METHOD) {
          return { newSessionId: "session-fork" };
        }
        return { success: false, error: null, mode: "conversation_only" };
      },
    });

    expect(loaded).toEqual(["session-fork"]);
    expect(recorded).toEqual([
      { method: GROK_REWIND_POINTS_METHOD, params: { sessionId: "session-1" } },
      {
        method: GROK_REWIND_EXECUTE_METHOD,
        params: { sessionId: "session-1", targetPromptIndex: 1, mode: "conversation_only" },
      },
      {
        method: GROK_SESSION_FORK_METHOD,
        params: {
          sourceSessionId: "session-1",
          sourceCwd: cwd,
          newCwd: cwd,
          newSessionId: expect.stringMatching(
            /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
          ),
        },
      },
    ]);
    const sessionDir = join(
      grokHome,
      "sessions",
      encodeGrokSessionsCwdDirname(cwd),
      "session-fork",
    );
    expect(readFileSync(join(sessionDir, "chat_history.jsonl"), "utf8")).toContain("one");
    expect(readFileSync(join(sessionDir, "chat_history.jsonl"), "utf8")).not.toContain("two");
    expect(readFileSync(join(sessionDir, "updates.jsonl"), "utf8")).not.toContain("two");
  });
});

describe("ACPAgentSession Grok conversation rewind", () => {
  test("executes Grok conversation rewind and refills streamHistory with remaining turns", async () => {
    const extMethod = vi.fn(async (method: string) => {
      if (method === GROK_REWIND_POINTS_METHOD) {
        return { points: [{ prompt_index: 0 }, { prompt_index: 1 }] };
      }
      return { success: true };
    });
    const newSession = vi.fn(async () => ({ sessionId: "session-2" }));
    const loadSession = vi.fn(async () => ({ sessionId: "session-loaded" }));
    const session = createGrokRewindSession();
    const internals = asInternals<RewindSessionInternals>(session);
    internals.sessionId = "session-1";
    internals.connection = { extMethod, loadSession, newSession };

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
      mode: "conversation_only",
    });
    expect(newSession).not.toHaveBeenCalled();
    expect(loadSession).not.toHaveBeenCalled();
    expect(await collectHistory(session)).toEqual([
      timelineEvent(userMessage("first", "msg-a")),
      timelineEvent(assistantMessage("ok", "asst-1")),
    ]);
  });

  test("switches to a fork without duplicating replayed history when resumed rewind fails", async () => {
    const grokHome = mkdtempSync(join(tmpdir(), "paseo-grok-rewind-acp-"));
    const previousGrokHome = process.env.GROK_HOME;
    process.env.GROK_HOME = grokHome;
    writeGrokSessionFiles(grokHome, "/tmp/grok-rewind", "session-fork");
    const extMethod = vi.fn(async (method: string) => {
      if (method === GROK_REWIND_POINTS_METHOD) {
        return { points: [{ prompt_index: 0 }, { prompt_index: 1 }] };
      }
      if (method === GROK_SESSION_FORK_METHOD) {
        return { newSessionId: "session-fork" };
      }
      return { success: false, error: null, mode: "conversation_only" };
    });
    let session!: ACPAgentSession;
    const loadSession = vi.fn(async (params: { sessionId: string }) => {
      await session.sessionUpdate({
        sessionId: params.sessionId,
        update: {
          sessionUpdate: "user_message_chunk",
          content: { type: "text", text: "replayed but suppressed" },
        },
      });
      return {};
    });
    const newSession = vi.fn(async () => ({ sessionId: "session-fresh" }));
    session = createGrokRewindSession();
    const internals = asInternals<RewindSessionInternals>(session);
    internals.sessionId = "session-1";
    internals.connection = { extMethod, loadSession, newSession };

    internals.pushEvent(timelineEvent(userMessage("first", "msg-a")));
    internals.pushEvent(timelineEvent(assistantMessage("ok", "asst-1")));
    internals.pushEvent(timelineEvent(userMessage("second", "msg-b")));
    internals.pushEvent(timelineEvent(assistantMessage("later", "asst-2")));

    try {
      await session.revertConversation?.({ messageId: "msg-b" });

      expect(loadSession).toHaveBeenCalledWith({
        sessionId: "session-fork",
        cwd: "/tmp/grok-rewind",
        mcpServers: [],
      });
      expect(internals.sessionId).toBe("session-fork");
      expect(await collectHistory(session)).toEqual([
        timelineEvent(userMessage("first", "msg-a")),
        timelineEvent(assistantMessage("ok", "asst-1")),
      ]);
    } finally {
      if (previousGrokHome === undefined) {
        delete process.env.GROK_HOME;
      } else {
        process.env.GROK_HOME = previousGrokHome;
      }
      rmSync(grokHome, { recursive: true, force: true });
    }
  });

  test("opens a new Grok session when rewinding the first prompt", async () => {
    const extMethod = vi.fn(async (method: string) => {
      if (method === GROK_REWIND_POINTS_METHOD) {
        return { rewind_points: [{ prompt_index: 0 }] };
      }
      throw new Error("execute should not run for the first prompt");
    });
    const newSession = vi.fn(async () => ({ sessionId: "session-fresh" }));
    const loadSession = vi.fn(async () => ({ sessionId: "session-loaded" }));
    const session = createGrokRewindSession();
    const internals = asInternals<RewindSessionInternals>(session);
    internals.sessionId = "session-1";
    internals.connection = { extMethod, loadSession, newSession };

    internals.pushEvent(timelineEvent(userMessage("first", "msg-a")));
    internals.pushEvent(timelineEvent(assistantMessage("ok", "asst-1")));

    await session.revertConversation?.({ messageId: "msg-a" });

    expect(newSession).toHaveBeenCalledWith({
      cwd: "/tmp/grok-rewind",
      mcpServers: [],
    });
    expect(extMethod).toHaveBeenCalledWith(GROK_REWIND_POINTS_METHOD, { sessionId: "session-1" });
    expect(extMethod.mock.calls.some(([method]) => method === GROK_REWIND_EXECUTE_METHOD)).toBe(
      false,
    );
    expect(internals.sessionId).toBe("session-fresh");
    expect(await collectHistory(session)).toEqual([]);
  });
});

function updateLine(promptIndex: number, text: string): string {
  return JSON.stringify({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "user_message_chunk",
        content: { type: "text", text },
        _meta: { promptIndex },
      },
    },
  });
}

function thoughtLine(text: string): string {
  return JSON.stringify({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "agent_thought_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function assistantLine(text: string): string {
  return JSON.stringify({
    method: "session/update",
    params: {
      update: {
        sessionUpdate: "agent_message_chunk",
        content: { type: "text", text },
      },
    },
  });
}

function writeGrokSessionFiles(grokHome: string, cwd: string, sessionId: string): void {
  const sessionDir = join(grokHome, "sessions", encodeGrokSessionsCwdDirname(cwd), sessionId);
  mkdirSync(sessionDir, { recursive: true });
  writeFileSync(
    join(sessionDir, "updates.jsonl"),
    [updateLine(0, "one"), assistantLine("one"), updateLine(1, "two"), assistantLine("two")].join(
      "\n",
    ) + "\n",
  );
  writeFileSync(
    join(sessionDir, "chat_history.jsonl"),
    [
      JSON.stringify({ type: "system", content: "sys" }),
      JSON.stringify({ type: "user", prompt_index: 0, content: "one" }),
      JSON.stringify({ type: "assistant", content: "one" }),
      JSON.stringify({ type: "user", prompt_index: 1, content: "two" }),
      JSON.stringify({ type: "assistant", content: "two" }),
    ].join("\n") + "\n",
  );
  writeFileSync(
    join(sessionDir, "rewind_points.jsonl"),
    `${JSON.stringify({ prompt_index: 0 })}\n${JSON.stringify({ prompt_index: 1 })}\n`,
  );
}

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
