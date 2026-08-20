import type { SessionModelState } from "@agentclientprotocol/sdk";
import type { Logger } from "pino";

import type { AgentModelDefinition, AgentSelectOption } from "../agent-sdk-types.js";
import {
  type ACPCatalogModelResolverContext,
  type ACPSessionModelRequestMetaContext,
  type ACPThinkingOptionWriterContext,
} from "./acp-agent.js";
import { GenericACPAgentClient } from "./generic-acp-agent.js";

interface GrokACPAgentClientOptions {
  logger: Logger;
  command: [string, ...string[]];
  env?: Record<string, string>;
  providerId?: string;
  label?: string;
  providerParams?: unknown;
}

const GROK_REASONING_EFFORT_META_KEY = "reasoningEffort";
const GROK_SUPPORTS_REASONING_EFFORT_META_KEY = "supportsReasoningEffort";
const GROK_REASONING_EFFORTS_META_KEY = "reasoningEfforts";

const GROK_CANONICAL_EFFORTS = [
  "none",
  "minimal",
  "low",
  "medium",
  "high",
  "xhigh",
  "max",
] as const;

type GrokCanonicalEffort = (typeof GROK_CANONICAL_EFFORTS)[number];

const GROK_LEGACY_EFFORT_OPTIONS: AgentSelectOption[] = [
  {
    id: "xhigh",
    label: "xhigh",
    description: "Extended reasoning",
    isDefault: false,
  },
  {
    id: "high",
    label: "high",
    description: "Heavy reasoning",
    isDefault: false,
  },
  {
    id: "medium",
    label: "medium",
    description: "Balanced reasoning",
    isDefault: false,
  },
  {
    id: "low",
    label: "low",
    description: "Faster, lighter reasoning",
    isDefault: false,
  },
];

type GrokAcpModel = NonNullable<SessionModelState["availableModels"]>[number];

interface GrokReasoningEffortOption {
  id?: unknown;
  value?: unknown;
  label?: unknown;
  description?: unknown;
  default?: unknown;
}

/**
 * Grok reports per-model reasoning menus on ACP model `_meta` (`reasoningEfforts`)
 * and applies a change with `session/set_model` `_meta.reasoningEffort`. It does
 * not implement `thought_level` config options. Keep the extra round trips and
 * `_meta` mapping on this client so other ACP providers stay on the standard path.
 */
export function thinkingOptionsFromGrokModelMeta(
  meta: Record<string, unknown> | null | undefined,
): { thinkingOptions: AgentSelectOption[]; defaultThinkingOptionId: string } | undefined {
  if (meta?.[GROK_SUPPORTS_REASONING_EFFORT_META_KEY] !== true) {
    return undefined;
  }

  const currentEffort = readCanonicalEffort(meta[GROK_REASONING_EFFORT_META_KEY]);
  const listed = readGrokEffortOptions(meta[GROK_REASONING_EFFORTS_META_KEY], currentEffort);
  const thinkingOptions = listed.length > 0 ? listed : markLegacyDefault(currentEffort);
  const defaultThinkingOptionId =
    thinkingOptions.find((option) => option.isDefault)?.id ?? thinkingOptions[0]?.id;
  if (!defaultThinkingOptionId) {
    return undefined;
  }

  return { thinkingOptions, defaultThinkingOptionId };
}

export function resolveGrokCatalogModels({
  models,
  acpModels,
}: ACPCatalogModelResolverContext): Promise<AgentModelDefinition[]> {
  const byId = new Map(acpModels.map((model) => [model.modelId, model]));
  return Promise.resolve(
    models.map((model) => {
      const thinking = thinkingOptionsFromGrokModelMeta(readGrokModelMeta(byId.get(model.id)));
      if (!thinking) {
        return model;
      }
      return {
        ...model,
        thinkingOptions: thinking.thinkingOptions,
        defaultThinkingOptionId: thinking.defaultThinkingOptionId,
      };
    }),
  );
}

export async function writeGrokThinkingOption({
  connection,
  sessionId,
  thinkingOptionId,
  currentModelId,
}: ACPThinkingOptionWriterContext): Promise<void> {
  if (!currentModelId) {
    throw new Error("Grok thinking option requires the current model id");
  }
  if (typeof connection.unstable_setSessionModel !== "function") {
    throw new Error("Grok does not expose ACP model selection");
  }

  await connection.unstable_setSessionModel({
    sessionId,
    modelId: currentModelId,
    _meta: grokReasoningEffortMeta(thinkingOptionId),
  });
}

export function grokSessionModelRequestMeta({
  thinkingOptionId,
}: ACPSessionModelRequestMetaContext): Record<string, unknown> | undefined {
  if (!thinkingOptionId) {
    return undefined;
  }
  return grokReasoningEffortMeta(thinkingOptionId);
}

export class GrokACPAgentClient extends GenericACPAgentClient {
  constructor(options: GrokACPAgentClientOptions) {
    super({
      logger: options.logger,
      command: options.command,
      env: options.env,
      providerId: options.providerId,
      label: options.label,
      providerParams: options.providerParams,
      catalogModelResolver: resolveGrokCatalogModels,
      thinkingOptionWriter: writeGrokThinkingOption,
      sessionModelRequestMeta: grokSessionModelRequestMeta,
    });
  }
}

function grokReasoningEffortMeta(thinkingOptionId: string): Record<string, unknown> {
  return { [GROK_REASONING_EFFORT_META_KEY]: thinkingOptionId };
}

function readGrokModelMeta(model: GrokAcpModel | undefined): Record<string, unknown> | undefined {
  if (!model) {
    return undefined;
  }
  const meta = model._meta;
  if (!meta || typeof meta !== "object" || Array.isArray(meta)) {
    return undefined;
  }
  return meta as Record<string, unknown>;
}

function readCanonicalEffort(value: unknown): GrokCanonicalEffort | null {
  return typeof value === "string" && isCanonicalEffort(value) ? value : null;
}

function isCanonicalEffort(value: string): value is GrokCanonicalEffort {
  return (GROK_CANONICAL_EFFORTS as readonly string[]).includes(value);
}

function readGrokEffortOptions(
  raw: unknown,
  currentEffort: GrokCanonicalEffort | null,
): AgentSelectOption[] {
  if (!Array.isArray(raw)) {
    return [];
  }

  const options: AgentSelectOption[] = [];
  for (const entry of raw) {
    const option = normalizeGrokEffortOption(entry, currentEffort);
    if (option) {
      options.push(option);
    }
  }
  return options;
}

function normalizeGrokEffortOption(
  entry: unknown,
  currentEffort: GrokCanonicalEffort | null,
): AgentSelectOption | null {
  if (typeof entry === "string") {
    if (!isCanonicalEffort(entry)) {
      return null;
    }
    return {
      id: entry,
      label: entry,
      isDefault: currentEffort === entry,
    };
  }
  if (!entry || typeof entry !== "object") {
    return null;
  }

  const record = entry as GrokReasoningEffortOption;
  const value = readCanonicalEffort(record.value);
  if (!value) {
    return null;
  }
  const label =
    typeof record.label === "string" && record.label.trim().length > 0 ? record.label : value;
  const description =
    typeof record.description === "string" && record.description.trim().length > 0
      ? record.description
      : undefined;
  const isDefault = currentEffort !== null ? currentEffort === value : record.default === true;
  return {
    id: value,
    label,
    description,
    isDefault,
  };
}

function markLegacyDefault(currentEffort: GrokCanonicalEffort | null): AgentSelectOption[] {
  return GROK_LEGACY_EFFORT_OPTIONS.map((option) => ({
    id: option.id,
    label: option.label,
    description: option.description,
    isDefault: currentEffort === option.id,
  }));
}
