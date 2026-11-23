/**
 * @plato/plugin-sdk — type definitions for plato plugin authors.
 *
 * No runtime. Plato itself is JavaScript; these types are purely for plugin-
 * author DX (IntelliSense in TS or via `// @ts-check` + JSDoc in JS).
 *
 * @example  // TypeScript
 *   import type { ServerPluginExports } from '@plato/plugin-sdk';
 *   import { Hono } from 'hono';
 *
 *   const routes = new Hono();
 *   routes.get('/hello', (c) => c.json({ ok: true }));
 *
 *   export default {
 *     routes,
 *     onActivate(ctx) { ctx.logger.info('activated'); },
 *   } satisfies ServerPluginExports;
 *
 * @example  // JavaScript with JSDoc
 *   /** @type {import('@plato/plugin-sdk').ServerPluginExports} *\/
 *   export default {
 *     routes,
 *     onActivate(ctx) { ctx.logger.info('activated'); },
 *   };
 */

import type { Hono } from 'hono';
import type { ComponentType, LazyExoticComponent } from 'react';

// ---------- Manifest ----------

export interface PluginManifest {
  /** Lower-case kebab id, must match the plugins/<id>/ directory name. */
  id: string;
  name: string;
  /** Plugin's own version, semver. */
  version: string;
  /** Semver range against the host's PLUGIN_API_VERSION (e.g. "1.x", "^1.2"). */
  apiVersion: string;
  description: string;
  author?: string;
  license?: string;
  homepage?: string;
  /** Capabilities the plugin requires; surfaced to admins at activation. */
  capabilities: Capability[];
  extensionPoints: ExtensionPoints;
  /** JSON Schema for the plugin's settings. Used to auto-render a form when no settingsPanel slot is provided. */
  settingsSchema?: JSONSchemaPrimitive;
  /** If absent, defaults to false. */
  defaultEnabled?: boolean;
}

export interface ExtensionPoints {
  /** Path-relative reference: "server/index.js#routes" */
  serverRoutes?: string;
  /** slot-name -> client component file path */
  slots?: Partial<Record<SlotName, string>>;
  /** Hooks the plugin subscribes to. */
  hooks?: HookName[];
  /** sync-data namespace (Phase 3+; declare for forward-compat). */
  syncDataNamespace?: string;
}

// ---------- Capabilities ----------

export type Capability =
  | 'server.routes'
  | 'settings.read'
  | 'settings.write'
  | `ui.slot.${SlotName}`
  | 'ui.adminNav'
  | `hook.${HookName}`
  | 'user.metadata.read'
  | 'user.metadata.write'
  | 'kpi'
  | 'agent'
  | 'syncData.namespace'
  | 'lessonEnrichment'
  | 'auth.provider';

// ---------- Slots ----------

/**
 * Named UI slots. The host owns placement; plugins own content.
 *
 * Phase 1: adminSettingsPanel, adminUserRowAction.
 * Later phases: adminHomeKpi, adminProfileFields, learnerProfileFields, learnerHomeBanner, etc.
 */
export type SlotName =
  | 'adminSettingsPanel'
  | 'adminUserRowAction'
  // Declared early so plugins can target them when they land:
  | 'adminHomeKpi'
  | 'adminProfileFields'
  | 'learnerProfileFields'
  | 'learnerHomeBanner';

// ---------- Hooks ----------

/**
 * Lifecycle event names plato emits. Plugins can also `emit()`/`on()` arbitrary names
 * (convention: `<plugin-id>.<event>` for plugin-emitted events).
 *
 * Phase 1: plumbing only — no emit-points yet.
 * Phase 2: userCreated, userUpdated, lessonStarted, lessonCompleted, profileUpdated.
 * Phase 3: coachExchangeRecorded.
 */
export type HookName =
  | 'userCreated'
  | 'userUpdated'
  | 'profileUpdated'
  | 'lessonStarted'
  | 'lessonCompleted'
  | 'coachExchangeRecorded';

export interface HookContext {
  pluginId: string;
  logger: PluginLogger;
  /** Read-only access to db and the plugin's own settings. Narrowed surface — full db is intentionally not exposed. */
  db: PluginDbView;
  settings: Record<string, unknown>;
  /** Emit an event on the open hook bus. Use the convention `<plugin-id>.<event>`. */
  emit(event: string, payload: unknown): Promise<void>;
  /**
   * The host's AI provider. Never import `ai-provider.js` yourself. On a traced
   * `lessonStarted` call (API 1.7.0) every call made through it is recorded as
   * an `ai` trace step; name the call with `{ purpose }`.
   */
  ai: PluginAi;
  /** The one model every plato agent uses. Pass it to `ai.invoke`. */
  LLM: string;
  /**
   * Trace mode recorder (API 1.7.0). Always present. `on` is true only on a
   * traced `lessonStarted` call; otherwise it records nothing and `fetch` is
   * plain `fetch`. It belongs to one call: never keep it, or steps, in a
   * module-level variable. On a host before 1.7.0 it is undefined.
   */
  trace: PluginTrace;
}

// ---------- Trace mode (API 1.7.0, #595) ----------

export interface PluginAiBody {
  max_tokens?: number;
  system?: string | { type: 'text'; text: string }[];
  messages: { role: 'user' | 'assistant'; content: unknown }[];
  [key: string]: unknown;
}

export interface PluginAiOptions {
  /** One line saying what this call is for. Shown in a Trace; ignored otherwise. */
  purpose?: string;
}

export interface PluginAi {
  invoke(model: string, body: PluginAiBody, opts?: PluginAiOptions): Promise<{
    content: { type: string; text?: string }[];
    usage?: { input_tokens: number; output_tokens: number };
    stop_reason?: string;
  }>;
  invokeStream(model: string, body: PluginAiBody, opts?: PluginAiOptions): AsyncIterable<unknown>;
}

/** One AI call: `system` and `messages` are what the plugin sent, `reply` what came back. */
export interface TraceAiStep {
  type: 'ai';
  purpose: string;
  model: string;
  system: string;
  messages: { role: string; content: string }[];
  reply: string;
  /** Token counts, e.g. `{ input_tokens, output_tokens }`. Numbers only. */
  usage?: Record<string, number>;
  ms?: number;
  error?: string;
}

/** One outbound request. The URL only: never credentials, headers or a body. */
export interface TraceFetchStep {
  type: 'fetch';
  purpose: string;
  url: string;
  status?: number;
  ms?: number;
  bytes?: number;
  error?: string;
}

/** Anything else worth telling a person: a decision, an outcome. */
export interface TraceNoteStep {
  type: 'note';
  text: string;
}

/**
 * What a plugin did, in order. The host keeps only these types and fields,
 * at most 50 steps and 200 KB per plugin per lesson start, 20,000 characters
 * per text field, and removes credentials from URLs and text.
 */
export type TraceStep = TraceAiStep | TraceFetchStep | TraceNoteStep;

export interface PluginTrace {
  /** True on a traced `lessonStarted` call. */
  readonly on: boolean;
  /** Record a step. A step the host doesn't know is dropped. Never throws. */
  record(step: TraceStep): void;
  /** Record a `note` step. */
  note(text: string): void;
  /**
   * `fetch(url, init)`, recorded as a `fetch` step (URL, status, time, stated
   * size). Returns the Response untouched; a failure is recorded and rethrown.
   */
  fetch(purpose: string, url: string | URL, init?: RequestInit): Promise<Response>;
}

/** Payload of the `lessonStarted` hook. */
export interface LessonStartedPayload {
  userId: string;
  lessonId: string;
  lesson: {
    name: string;
    markdown?: string;
    exemplar?: string;
    learningObjectives?: string[];
    coachDirective?: string;
  };
  lessonKB: Record<string, unknown>;
  /** Present (and true) only when the learner is recording a Trace (API 1.7.0). */
  trace?: true;
}

/** What a `lessonStarted` handler may return (`lessonEnrichment` capability), or null. */
export interface LessonEnrichment {
  pluginId: string;
  label: string;
  context: string;
  reasoning: string;
  sources?: { url: string; title: string; excerpt?: string }[];
  /**
   * Steps to add to the Trace, after those recorded through `ctx.trace` and
   * `ctx.ai` (API 1.7.0). The host moves them out of the enrichment: they are
   * never stored on `lessonKB.enrichments` or given to the coach. Return
   * `{ trace }` alone to report steps without adding an enrichment.
   */
  trace?: TraceStep[];
}

// ---------- Lifecycle ----------

export interface PluginLifecycleContext {
  pluginId: string;
  logger: PluginLogger;
  /** Read/write access to the plugin's own settings record. */
  settings: Record<string, unknown>;
  setSettings(next: Record<string, unknown>): Promise<void>;
  /** Read-only views of host data. */
  db: PluginDbView;
  /** Always the stand-in here (`on: false`): only `lessonStarted` is traced (API 1.7.0). */
  trace: PluginTrace;
}

// ---------- Plugin exports ----------

export interface ServerPluginExports {
  /** Hono router. Mounted under /v1/plugins/<id>/. Use plato's auth middleware re-exported from this SDK. */
  routes?: Hono;
  /** Subscribers to lifecycle events. Each handler receives a typed payload + context. */
  hooks?: Partial<Record<HookName, (payload: unknown, ctx: HookContext) => unknown | Promise<unknown>>> & {
    /** May return an enrichment (and/or trace steps), or null. */
    lessonStarted?(payload: LessonStartedPayload, ctx: HookContext): LessonEnrichment | { trace: TraceStep[] } | null | void | Promise<LessonEnrichment | { trace: TraceStep[] } | null | void>;
  };
  /** KPI definitions (Phase 2). */
  kpis?: KpiDefinition[];
  /** Called once when admin enables the plugin AND once at boot if already enabled. Idempotent. */
  onActivate?(ctx: PluginLifecycleContext): void | Promise<void>;
  /** Called when admin disables the plugin. Should release resources, NOT delete user data. */
  onDeactivate?(ctx: PluginLifecycleContext): void | Promise<void>;
  /**
   * Called only when an admin uses "Delete plugin data" on /plato/plugins.
   * Plugin must be disabled first; admin must type the plugin id to confirm.
   * Wipes everything the plugin has stored. Errors propagate to the admin UI —
   * surface partial-cleanup failures rather than swallow them.
   */
  onUninstall?(ctx: PluginLifecycleContext): void | Promise<void>;
}

export interface ClientPluginExports {
  /** slot-name -> React component. The component receives slot-specific props. */
  slots?: Partial<Record<SlotName, ComponentType<SlotProps[SlotName]>>>;
  /** Admin sidebar links (Phase 2). */
  navItems?: { to: string; label: string; component: LazyExoticComponent<ComponentType> }[];
  /** Custom settings panel. If provided, renders inside the plugin card on /plato/plugins. If absent, plato auto-renders a form from settingsSchema. */
  settingsPanel?: ComponentType<SettingsPanelProps>;
}

// ---------- Slot props ----------

export interface SlotProps {
  adminSettingsPanel: SettingsPanelProps;
  adminUserRowAction: { user: AdminUser };
  adminHomeKpi: Record<string, never>;
  adminProfileFields: { user: AdminUser };
  learnerProfileFields: { profile: LearnerProfile };
  learnerHomeBanner: Record<string, never>;
}

export interface SettingsPanelProps {
  pluginId: string;
  settings: Record<string, unknown>;
  /** Persists settings via PUT /v1/admin/plugins/<id>/settings. Throws on failure. */
  onSave(next: Record<string, unknown>): Promise<void>;
}

export interface AdminUser {
  userId: string;
  email: string;
  /** Derived: `firstName lastName` (API 1.5.0). */
  name?: string;
  /** API 1.5.0 (#402). */
  firstName?: string;
  /** API 1.5.0 (#402). Empty for people with one name. */
  lastName?: string;
  /** 'auto' when inferred from an older single name and not yet confirmed (API 1.5.0). */
  nameSource?: 'user' | 'auto';
  username?: string;
  userGroup?: string;
  /** Normalized: accounts stored as 'user' before API 1.4.0 report 'learner'. */
  role: 'admin' | 'educator' | 'learner' | 'tester';
  createdAt: string;
}

export interface LearnerProfile {
  name?: string;
  goal?: string;
  preferences?: Record<string, unknown>;
}

// ---------- Logger ----------

/**
 * Plugin-scoped logger. Codes are auto-prefixed with `plugin.<id>.` so log lines
 * are traceable to the source plugin.
 */
export interface PluginLogger {
  info(code: string, data?: unknown): void;
  warn(code: string, data?: unknown): void;
  error(code: string, data?: unknown): void;
}

// ---------- DB view ----------

/**
 * Narrowed read-only surface of plato's db layer. Full db is intentionally not exposed
 * to plugins. Phase 2 will widen this with user-metadata helpers; Phase 3 with sync-data
 * namespace helpers.
 */
export interface PluginDbView {
  getUserById(userId: string): Promise<AdminUser | null>;
  listAllUsers(): Promise<AdminUser[]>;
}

// ---------- KPI ----------

export interface KpiDefinition {
  id: string;
  label: string;
  /** Computes a single value from host stats. Phase 2. */
  compute(ctx: { db: PluginDbView }): Promise<number | string>;
}

// ---------- JSON Schema (subset for settings) ----------

export type JSONSchemaPrimitive =
  | { type: 'string'; default?: string; enum?: string[]; description?: string; writeOnly?: boolean }
  | { type: 'number'; default?: number; minimum?: number; maximum?: number; description?: string }
  | { type: 'boolean'; default?: boolean; description?: string }
  | {
      type: 'object';
      properties: Record<string, JSONSchemaPrimitive>;
      required?: string[];
      additionalProperties?: boolean;
      description?: string;
    };

// Plugin authors using TypeScript can type their default export with
// `satisfies ServerPluginExports` (or `: ServerPluginExports`) directly —
// no helper function needed. Plain JS authors get IntelliSense via JSDoc:
//
//   /** @type {import('@plato/plugin-sdk').ServerPluginExports} */
//   export default { routes, async onActivate(ctx) { ... } };
