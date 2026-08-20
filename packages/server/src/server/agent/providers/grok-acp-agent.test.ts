import { describe, expect, test, vi } from "vitest";

import { createTestLogger } from "../../../test-utils/test-logger.js";
import { type SpawnedACPProcess } from "./acp-agent.js";
import {
  GrokACPAgentClient,
  grokSessionModelRequestMeta,
  thinkingOptionsFromGrokModelMeta,
  writeGrokThinkingOption,
} from "./grok-acp-agent.js";

function grokModel(modelId: string, name: string, meta?: Record<string, unknown>) {
  return {
    modelId,
    name,
    ...(meta ? { _meta: meta } : {}),
  };
}

function createGrokClient(spawnProcess: () => Promise<SpawnedACPProcess>): GrokACPAgentClient {
  class TestGrokACPAgentClient extends GrokACPAgentClient {
    protected override async spawnProcess(): Promise<SpawnedACPProcess> {
      return spawnProcess();
    }

    protected override async closeProbe(): Promise<void> {}
  }

  return new TestGrokACPAgentClient({
    logger: createTestLogger(),
    command: ["grok", "agent", "stdio"],
    providerId: "grok",
    label: "Grok",
  });
}

describe("thinkingOptionsFromGrokModelMeta", () => {
  test("uses canonical effort values as option ids even when the menu uses a display id", () => {
    expect(
      thinkingOptionsFromGrokModelMeta({
        supportsReasoningEffort: true,
        reasoningEffort: "xhigh",
        reasoningEfforts: [
          { id: "deep", value: "xhigh", label: "Deep", default: true },
          { id: "high", value: "high", label: "High", default: false },
        ],
      }),
    ).toEqual({
      thinkingOptions: [
        { id: "xhigh", label: "Deep", description: undefined, isDefault: true },
        { id: "high", label: "High", description: undefined, isDefault: false },
      ],
      defaultThinkingOptionId: "xhigh",
    });
  });

  test("returns no thinking options when the model does not support reasoning effort", () => {
    expect(
      thinkingOptionsFromGrokModelMeta({
        reasoningEffort: "high",
        reasoningEfforts: [{ value: "high", label: "High" }],
      }),
    ).toBeUndefined();
  });

  test("falls back to the built-in effort menu when the model supports effort but lists none", () => {
    const result = thinkingOptionsFromGrokModelMeta({
      supportsReasoningEffort: true,
      reasoningEffort: "medium",
    });

    expect(result?.defaultThinkingOptionId).toBe("medium");
    expect(result?.thinkingOptions.map((option) => option.id)).toEqual([
      "xhigh",
      "high",
      "medium",
      "low",
    ]);
  });
});

describe("GrokACPAgentClient per-model thinking options", () => {
  test("attaches each model's reasoningEfforts from ACP model meta", async () => {
    const client = createGrokClient(
      async () =>
        ({
          child: { kill: vi.fn(), exitCode: 0, signalCode: null, once: vi.fn() },
          connection: {
            newSession: vi.fn().mockResolvedValue({
              sessionId: "session-1",
              models: {
                currentModelId: "grok-4.6",
                availableModels: [
                  grokModel("grok-4.6", "Grok 4.6", {
                    supportsReasoningEffort: true,
                    reasoningEffort: "xhigh",
                    reasoningEfforts: [
                      { id: "low", value: "low", label: "Low" },
                      { id: "xhigh", value: "xhigh", label: "Xhigh" },
                    ],
                  }),
                  grokModel("gpt-5.6-luna", "GPT 5.6 Luna", {
                    supportsReasoningEffort: true,
                    reasoningEffort: "low",
                    reasoningEfforts: [
                      { id: "low", value: "low", label: "Low" },
                      { id: "max", value: "max", label: "Max" },
                    ],
                  }),
                  grokModel("gpt-image-2", "GPT Image 2"),
                ],
              },
            }),
          },
          initialize: { agentCapabilities: {} },
        }) as unknown as SpawnedACPProcess,
    );

    const catalog = await client.fetchCatalog({
      scope: "workspace",
      cwd: "/tmp/acp-grok-thinking",
      force: false,
    });

    expect(catalog.models.find((model) => model.id === "grok-4.6")?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "low", label: "Low", isDefault: false }),
      expect.objectContaining({ id: "xhigh", label: "Xhigh", isDefault: true }),
    ]);
    expect(catalog.models.find((model) => model.id === "gpt-5.6-luna")?.thinkingOptions).toEqual([
      expect.objectContaining({ id: "low", label: "Low", isDefault: true }),
      expect.objectContaining({ id: "max", label: "Max", isDefault: false }),
    ]);
    expect(
      catalog.models.find((model) => model.id === "gpt-image-2")?.thinkingOptions,
    ).toBeUndefined();
  });
});

describe("writeGrokThinkingOption", () => {
  test("sets reasoning effort through session/set_model _meta on the current model", async () => {
    const unstableSetSessionModel = vi.fn(async () => undefined);

    await writeGrokThinkingOption({
      connection: {
        unstable_setSessionModel: unstableSetSessionModel,
      } as never,
      sessionId: "session-1",
      thinkingOptionId: "low",
      currentModelId: "grok-4.6",
    });

    expect(unstableSetSessionModel).toHaveBeenCalledWith({
      sessionId: "session-1",
      modelId: "grok-4.6",
      _meta: { reasoningEffort: "low" },
    });
  });
});

describe("grokSessionModelRequestMeta", () => {
  test("stamps the current thinking option onto a model switch", () => {
    expect(grokSessionModelRequestMeta({ modelId: "grok-4.6", thinkingOptionId: "high" })).toEqual({
      reasoningEffort: "high",
    });
    expect(
      grokSessionModelRequestMeta({ modelId: "grok-4.6", thinkingOptionId: null }),
    ).toBeUndefined();
  });
});
