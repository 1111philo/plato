/**
 * @plato/plugin-sdk — type definitions for plato plugin authors.
 *
 * No runtime. Import types from this package and use `definePlugin()` as an
 * identity helper for narrowing (the same trick Vite, Astro, and Tailwind use).
 *
 * Plato itself is JavaScript; these types are purely for plugin-author DX.
 *
 * @example
 *   // plugins/my-plugin/server/index.js
 *   import { definePlugin } from '@plato/plugin-sdk';
 *   import { Hono } from 'hono';
 *
 *   const routes = new Hono();
 *   routes.get('/hello', (c) => c.json({ ok: true }));
 *
 *   export default definePlugin({
 *     routes,
 *     onActivate(ctx) { ctx.logger.info('activated'); },
 *   });
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
  /** Set by core plugins shipped with plato. Built-ins can be disabled but not uninstalled. */
  builtIn?: boolean;
  /** Capabilities the plugin requires; surfaced to admins at activation. */
  capabilities: Capability[];
  extensionPoints: ExtensionPoints;
  /** JSON Schema for the plugin's settings. Used to auto-render a form when no settingsPanel slot is provided. */
  settingsSchema?: JSONSchemaPrimitive;
  /** If absent, defaults to false. Built-ins typically default to true. */
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
  | 'syncData.namespace';

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
}

// ---------- Plugin exports ----------

export interface ServerPluginExports {
  /** Hono router. Mounted under /v1/plugins/<id>/. Use plato's auth middleware re-exported from this SDK. */
  routes?: Hono;
  /** Subscribers to lifecycle events. Each handler receives a typed payload + context. */
  hooks?: Partial<Record<HookName, (payload: unknown, ctx: HookContext) => void | Promise<void>>>;
  /** KPI definitions (Phase 2). */
  kpis?: KpiDefinition[];
  /** Called once when admin enables the plugin AND once at boot if already enabled. Idempotent. */
  onActivate?(ctx: PluginLifecycleContext): void | Promise<void>;
  /** Called when admin disables the plugin. Should release resources, NOT delete user data. */
  onDeactivate?(ctx: PluginLifecycleContext): void | Promise<void>;
}

export interface ClientPluginExports {
  /** slot-name -> React component. The component receives slot-specific props. */
  slots?: Partial<Record<SlotName, ComponentType<SlotProps[SlotName]>>>;
  /** Admin sidebar links (Phase 2). */
  navItems?: { to: string; label: string; component: LazyExoticComponent<ComponentType> }[];
  /** Custom settings panel. If provided, renders inside the Integrations card. If absent, plato auto-renders a form from settingsSchema. */
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
  name?: string;
  username?: string;
  userGroup?: string;
  role: 'admin' | 'learner';
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

// ---------- definePlugin identity helpers ----------

/**
 * Identity helper for typing server-side plugin exports.
 * Accepts ServerPluginExports and returns it unchanged so editors can narrow.
 */
export function defineServerPlugin<T extends ServerPluginExports>(plugin: T): T;

/**
 * Identity helper for typing client-side plugin exports.
 */
export function defineClientPlugin<T extends ClientPluginExports>(plugin: T): T;

/**
 * Generic alias — works on either side. `defineServerPlugin` / `defineClientPlugin`
 * give better narrowing if you know which one you're writing.
 */
export function definePlugin<T extends ServerPluginExports | ClientPluginExports>(plugin: T): T;
