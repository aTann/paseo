import pino from "pino";
import { describe, expect, test } from "vitest";

import type { AgentSession, AgentSessionConfig } from "../agent-sdk-types.js";
import { CodexAppServerAgentSession } from "./codex-app-server-agent.js";
import {
  createFakeCodexAppServer,
  type FakeCodexAppServer,
} from "./codex/test-utils/fake-app-server.js";
import { createTestLogger } from "../../../test-utils/test-logger.js";

const CODEX_PROVIDER = "codex";

interface CollaborationModeRecord {
  name: string;
  mode?: string | null;
  model?: string | null;
  reasoning_effort?: string | null;
  developer_instructions?: string | null;
}

const TEST_COLLABORATION_MODES: CollaborationModeRecord[] = [
  {
    name: "Code",
    mode: "code",
    developer_instructions: "Built-in code mode",
  },
  {
    name: "Plan",
    mode: "plan",
    developer_instructions: "Built-in plan mode",
  },
];

const CODEX_147_COLLABORATION_MODES: CollaborationModeRecord[] = [
  {
    name: "Plan",
    mode: "plan",
    model: null,
    reasoning_effort: "medium",
  },
  {
    name: "Default",
    mode: "default",
    model: null,
    reasoning_effort: null,
  },
];

type CodexFeaturesTestSession = AgentSession;

interface CapturedLogEntry {
  level?: number;
  msg?: string;
  [key: string]: unknown;
}

function createCapturedLogger(): { logger: pino.Logger; entries: CapturedLogEntry[] } {
  const entries: CapturedLogEntry[] = [];
  const logger = pino(
    { level: "debug" },
    {
      write(line: string) {
        entries.push(JSON.parse(line) as CapturedLogEntry);
      },
    },
  );
  return { logger, entries };
}

function createConfig(overrides: Partial<AgentSessionConfig> = {}): AgentSessionConfig {
  return {
    provider: CODEX_PROVIDER,
    cwd: "/tmp/codex-fast-mode-test",
    modeId: "auto",
    model: "gpt-5.4",
    ...overrides,
  };
}

function createSessionHarness(
  configOverrides: Partial<AgentSessionConfig> = {},
  options: {
    logger?: pino.Logger;
    collaborationModes?: CollaborationModeRecord[];
  } = {},
): {
  session: CodexFeaturesTestSession;
  appServer: FakeCodexAppServer;
} {
  const config = createConfig(configOverrides);
  const appServer = createFakeCodexAppServer({
    "collaborationMode/list": () => ({
      data: options.collaborationModes ?? TEST_COLLABORATION_MODES,
    }),
  });
  const session = new CodexAppServerAgentSession(
    { ...config, provider: CODEX_PROVIDER },
    null,
    options.logger ?? createTestLogger(),
    async () => appServer.child,
  ) as CodexFeaturesTestSession;
  return { session, appServer };
}

async function createConnectedSession(
  configOverrides: Partial<AgentSessionConfig> = {},
  options: {
    logger?: pino.Logger;
    collaborationModes?: CollaborationModeRecord[];
  } = {},
): Promise<{
  session: CodexFeaturesTestSession;
  appServer: FakeCodexAppServer;
}> {
  const harness = createSessionHarness(configOverrides, options);
  await harness.session.connect();
  harness.appServer.assertNoErrors();
  return harness;
}

describe("Codex app-server provider features", () => {
  test.each([
    "gpt-6-astra",
    "gpt-5.6",
    "gpt-5.6-sol",
    "gpt-5.6-terra",
    "gpt-5.6-luna",
    "gpt-5.5",
    "gpt-5.4",
  ])("exposes and sends Fast for %s", async (model) => {
    const { session, appServer } = await createConnectedSession({ model });
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({
          id: "fast_mode",
          value: false,
        }),
      );
      await session.setFeature?.("fast_mode", true);
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        model,
        serviceTier: "fast",
      });
    } finally {
      await session.close();
    }
  });

  test.each([
    "gpt-5.3-codex-spark",
    "gpt-5.3-codex",
    "gpt-5.4-mini",
    "gpt-5.4-nano",
    "gpt-5.5-pro",
    "gpt-5",
    "gpt-4.1",
    "o3",
    "o4-mini",
    "gpt-6-unknown",
  ])("does not expose or restore Fast for %s", async (model) => {
    const { session, appServer } = await createConnectedSession({
      model,
      featureValues: { fast_mode: true },
    });
    try {
      expect(session.features.map((feature) => feature.id)).toEqual(["plan_mode"]);
      await expect(session.setFeature?.("fast_mode", true)).rejects.toThrow(
        `Codex fast mode is not available for model '${model}'`,
      );
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.not.toMatchObject({
        serviceTier: expect.anything(),
      });
    } finally {
      await session.close();
    }
  });

  test("restores Fast on Astra and preserves it when switching supported models", async () => {
    const { session, appServer } = await createConnectedSession({
      model: "gpt-6-astra",
      featureValues: { fast_mode: true },
    });
    try {
      expect(session.features).toContainEqual(
        expect.objectContaining({
          id: "fast_mode",
          value: true,
        }),
      );
      await session.setModel("gpt-5.6-sol");
      await session.setModel("gpt-6-astra");
      await session.startTurn("hello");
      await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
        model: "gpt-6-astra",
        serviceTier: "fast",
      });
    } finally {
      await session.close();
    }
  });

  test("features returns fast and plan toggles when supported", async () => {
    const { session } = await createConnectedSession();

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        description: "Priority inference at increased usage",
        tooltip: "Toggle fast mode",
        icon: "zap",
        value: false,
      },
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
    ]);

    await session.setFeature?.("fast_mode", true);
    await session.setFeature?.("plan_mode", true);

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        description: "Priority inference at increased usage",
        tooltip: "Toggle fast mode",
        icon: "zap",
        value: true,
      },
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: true,
      },
    ]);
  });

  test("features returns only plan toggle when model does not support fast mode", async () => {
    const { session } = await createConnectedSession({ model: "gpt-3.5-turbo" });

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
    ]);
  });

  test("constructor ignores restored fast mode when model does not support it", async () => {
    const { session, appServer } = await createConnectedSession({
      model: "gpt-3.5-turbo",
      featureValues: { fast_mode: true },
    });

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
    ]);

    await session.startTurn("hello");
    await expect(appServer.waitForTurnStart()).resolves.not.toMatchObject({
      serviceTier: expect.anything(),
    });
  });

  test("setFeature('fast_mode', true) sets serviceTier to fast", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("fast_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "fast",
    });
  });

  test("setFeature('fast_mode', false) clears serviceTier to null", async () => {
    const { session, appServer } = await createConnectedSession({
      featureValues: { fast_mode: true },
    });

    await session.setFeature?.("fast_mode", false);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.not.toMatchObject({
      serviceTier: expect.anything(),
    });
  });

  test("setFeature('fast_mode', true) rejects models that do not support fast mode", async () => {
    const { session } = await createConnectedSession({ model: "gpt-3.5-turbo" });

    await expect(session.setFeature?.("fast_mode", true)).rejects.toThrow(
      "Codex fast mode is not available for model 'gpt-3.5-turbo'",
    );
  });

  test("setFeature invalidates runtime info", async () => {
    const { session } = await createConnectedSession();

    await expect(session.getRuntimeInfo()).resolves.not.toMatchObject({
      extra: { collaborationMode: "Plan" },
    });

    await session.setFeature?.("plan_mode", true);

    await expect(session.getRuntimeInfo()).resolves.toMatchObject({
      extra: { collaborationMode: "Plan" },
    });
  });

  test("setFeature throws for unknown feature ids", async () => {
    const { session } = createSessionHarness();

    await expect(session.setFeature?.("unknown_feature", true)).rejects.toThrow(
      "Unknown Codex feature: unknown_feature",
    );
  });

  test("constructor restores feature flags from config.featureValues", async () => {
    const { session, appServer } = await createConnectedSession({
      featureValues: { fast_mode: true, plan_mode: true },
    });

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "fast_mode",
        label: "Fast",
        description: "Priority inference at increased usage",
        tooltip: "Toggle fast mode",
        icon: "zap",
        value: true,
      },
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: true,
      },
    ]);

    await session.startTurn("hello");
    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "fast",
      collaborationMode: expect.objectContaining({
        mode: "plan",
      }),
    });
  });

  test("startTurn includes serviceTier when fast mode is enabled", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("fast_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      serviceTier: "fast",
    });
  });

  test("startTurn logs a sanitized turn/start summary for fast mode observability", async () => {
    const capture = createCapturedLogger();
    const prompt = "secret prompt text should not be logged";
    const { session } = await createConnectedSession(
      { featureValues: { fast_mode: true } },
      { logger: capture.logger },
    );

    await session.startTurn(prompt);

    const entry = capture.entries.find(
      (candidate) => candidate.msg === "Starting Codex app-server turn",
    );
    expect(entry).toMatchObject({
      level: 30,
      msg: "Starting Codex app-server turn",
      model: "gpt-5.4",
      modeId: "auto",
      serviceTier: "fast",
      cwd: "/tmp/codex-fast-mode-test",
    });
    expect(JSON.stringify(entry)).not.toContain(prompt);
  });

  test("setModel clears fast mode when switching to an unsupported model", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("fast_mode", true);
    await session.setModel("gpt-3.5-turbo");

    expect(session.features).toEqual([
      {
        type: "toggle",
        id: "plan_mode",
        label: "Plan",
        description: "Switch Codex into planning-only collaboration mode",
        tooltip: "Toggle plan mode",
        icon: "list-todo",
        value: false,
      },
    ]);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.not.toMatchObject({
      serviceTier: expect.anything(),
    });
  });

  test("startTurn switches collaboration mode when plan mode is enabled", async () => {
    const { session, appServer } = await createConnectedSession();

    await session.setFeature?.("plan_mode", true);
    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toMatchObject({
      collaborationMode: {
        mode: "plan",
        settings: expect.objectContaining({
          model: "gpt-5.4",
        }),
      },
    });
  });

  test("startTurn sends Codex 0.147 plan collaborationMode with required settings.model", async () => {
    const { session, appServer } = await createConnectedSession(
      { featureValues: { plan_mode: true } },
      { collaborationModes: CODEX_147_COLLABORATION_MODES },
    );

    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toEqual(
      expect.objectContaining({
        collaborationMode: {
          mode: "plan",
          settings: expect.objectContaining({
            model: "gpt-5.4",
          }),
        },
      }),
    );
  });

  test("startTurn sends Codex 0.147 default collaborationMode when plan is off", async () => {
    const { session, appServer } = await createConnectedSession(
      {},
      { collaborationModes: CODEX_147_COLLABORATION_MODES },
    );

    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toEqual(
      expect.objectContaining({
        collaborationMode: {
          mode: "default",
          settings: expect.objectContaining({
            model: "gpt-5.4",
          }),
        },
      }),
    );
  });

  test("startTurn fills collaborationMode settings.model after resolving the session model", async () => {
    const { session, appServer } = await createConnectedSession(
      { model: null, featureValues: { plan_mode: true } },
      { collaborationModes: CODEX_147_COLLABORATION_MODES },
    );

    await session.startTurn("hello");

    await expect(appServer.waitForTurnStart()).resolves.toEqual(
      expect.objectContaining({
        collaborationMode: {
          mode: "plan",
          settings: expect.objectContaining({
            model: "gpt-5.4",
          }),
        },
      }),
    );
  });

  test("thread/start includes collaborationMode when plan mode is restored", async () => {
    const { session, appServer } = await createConnectedSession(
      { featureValues: { plan_mode: true } },
      { collaborationModes: CODEX_147_COLLABORATION_MODES },
    );

    await session.startTurn("hello");

    await expect(appServer.waitForRequest("thread/start")).resolves.toEqual(
      expect.objectContaining({
        collaborationMode: {
          mode: "plan",
          settings: expect.objectContaining({
            model: "gpt-5.4",
          }),
        },
      }),
    );
  });

  test("setFeature('plan_mode') updates the current thread collaboration mode", async () => {
    const { session, appServer } = await createConnectedSession(
      {},
      { collaborationModes: CODEX_147_COLLABORATION_MODES },
    );

    await session.startTurn("hello");
    await appServer.waitForTurnStart();
    await session.setFeature?.("plan_mode", true);

    await expect(appServer.waitForRequest("thread/settings/update")).resolves.toEqual({
      threadId: "thread-1",
      collaborationMode: {
        mode: "plan",
        settings: expect.objectContaining({
          model: "gpt-5.4",
        }),
      },
    });
  });

  test("startTurn does not replace Codex plan developer_instructions with the session system prompt", async () => {
    const { session, appServer } = await createConnectedSession(
      {
        featureValues: { plan_mode: true },
        systemPrompt: "Always respond in 中文(Simplified Chinese)",
      },
      { collaborationModes: CODEX_147_COLLABORATION_MODES },
    );

    await session.startTurn("hello");
    const turnStart = await appServer.waitForTurnStart();

    expect(turnStart).toEqual(
      expect.objectContaining({
        developerInstructions: "Always respond in 中文(Simplified Chinese)",
        collaborationMode: {
          mode: "plan",
          settings: {
            model: "gpt-5.4",
            reasoning_effort: "medium",
          },
        },
      }),
    );
  });

  test("startTurn forwards list-provided collaboration developer_instructions without mixing in the session system prompt", async () => {
    const { session, appServer } = await createConnectedSession(
      {
        featureValues: { plan_mode: true },
        systemPrompt: "Always respond in 中文(Simplified Chinese)",
      },
      { collaborationModes: TEST_COLLABORATION_MODES },
    );

    await session.startTurn("hello");
    const turnStart = await appServer.waitForTurnStart();

    expect(turnStart).toEqual(
      expect.objectContaining({
        developerInstructions: "Always respond in 中文(Simplified Chinese)",
        collaborationMode: {
          mode: "plan",
          settings: expect.objectContaining({
            model: "gpt-5.4",
            developer_instructions: "Built-in plan mode",
          }),
        },
      }),
    );
  });
});
