import type { MesveeBridge, RuntimeEvents } from './types';
import type {
  AddServiceResult,
  Bootstrap,
  CatalogEntry,
  DiagnosticsResult,
  LogLevel,
  NavigationAction,
  RecoveryResult,
  SecurityStatus,
  ServiceInstance,
  Settings,
  SettingsPatch,
  UpdateInfo,
  WorkspaceBounds,
} from '../types';
import { detectPlatform } from '../../lib/platform';

const STORAGE_KEY = 'mesvee.mock.settings.v1';
const MOCK_VERSION = '0.1.0';

/** Deterministic demo catalog matching the Rust source of truth. */
const CATALOG: CatalogEntry[] = [
  { kind: 'whatsapp', name: 'WhatsApp', url: 'https://web.whatsapp.com', category: 'messaging', supportsUnread: true },
  { kind: 'telegram', name: 'Telegram', url: 'https://web.telegram.org/a/', category: 'messaging', supportsUnread: true },
  { kind: 'messenger', name: 'Messenger', url: 'https://www.messenger.com', category: 'messaging', supportsUnread: true },
  { kind: 'instagram', name: 'Instagram', url: 'https://www.instagram.com/direct/inbox/', category: 'social', supportsUnread: true },
  { kind: 'x', name: 'X', url: 'https://x.com/messages', category: 'social', supportsUnread: true },
  { kind: 'discord', name: 'Discord', url: 'https://discord.com/app', category: 'messaging', supportsUnread: true },
  { kind: 'slack', name: 'Slack', url: 'https://app.slack.com/client', category: 'work', supportsUnread: true },
  { kind: 'linkedin', name: 'LinkedIn', url: 'https://www.linkedin.com/messaging/', category: 'work', supportsUnread: true },
  { kind: 'teams', name: 'Microsoft Teams', url: 'https://teams.microsoft.com/v2/', category: 'work', supportsUnread: true },
  { kind: 'element', name: 'Element', url: 'https://app.element.io', category: 'messaging', supportsUnread: true },
  { kind: 'googleChat', name: 'Google Chat', url: 'https://chat.google.com', category: 'work', supportsUnread: true },
  { kind: 'facebook', name: 'Facebook', url: 'https://www.facebook.com', category: 'social', supportsUnread: false },
  { kind: 'threads', name: 'Threads', url: 'https://www.threads.net', category: 'social', supportsUnread: false },
  { kind: 'bluesky', name: 'Bluesky', url: 'https://bsky.app', category: 'social', supportsUnread: false },
  { kind: 'tiktok', name: 'TikTok', url: 'https://www.tiktok.com/messages', category: 'social', supportsUnread: true },
];

/** Pure default settings for the browser demo. */
function createDefaults(): Settings {
  const now = new Date().toISOString();
  const demo: ServiceInstance[] = [
    { id: '11111111-1111-4111-8111-111111111111', kind: 'whatsapp', label: 'WhatsApp Pribadi', muted: false, zoom: 1, createdAt: now },
    { id: '22222222-2222-4222-8222-222222222222', kind: 'telegram', label: 'Telegram Kerja', muted: false, zoom: 1, createdAt: now },
    { id: '33333333-3333-4333-8333-333333333333', kind: 'instagram', label: 'Instagram', muted: false, zoom: 1, createdAt: now },
    { id: '44444444-4444-4444-8444-444444444444', kind: 'discord', label: 'Discord Studio', muted: true, zoom: 1, createdAt: now },
  ];
  return {
    schemaVersion: 1,
    onboarded: true,
    activeServiceId: null,
    general: { launchAtLogin: false, startMinimized: false, closeToTray: true, showTrayIcon: true },
    appearance: { language: 'id', theme: 'dark', motion: 'system', density: 'comfortable' },
    notifications: { enabled: true, showBadge: true, onlyWhenUnfocused: true, focusMode: false },
    security: { lockEnabled: false, autoLockMinutes: 5, lockOnFocusLoss: false, protectScreenCapture: true },
    media: { microphone: false, camera: false },
    updates: { autoCheck: true },
    advanced: { logLevel: 'info' },
    services: demo,
  };
}

/** Applies a partial settings patch with the same semantics as Rust. */
function applyPatch(settings: Settings, patch: SettingsPatch): Settings {
  return {
    ...settings,
    onboarded: patch.onboarded ?? settings.onboarded,
    general: patch.general ?? settings.general,
    appearance: patch.appearance ?? settings.appearance,
    notifications: patch.notifications ?? settings.notifications,
    security: patch.security
      ? { ...settings.security, ...patch.security }
      : settings.security,
    media: patch.media ?? settings.media,
    updates: patch.updates ?? settings.updates,
    advanced: patch.advanced ?? settings.advanced,
  };
}

class MockEmitter {
  private readonly listeners = new Map<string, Set<(payload: unknown) => void>>();

  subscribe<K extends keyof RuntimeEvents>(
    event: K,
    handler: (payload: RuntimeEvents[K]) => void,
  ): () => void {
    const set = this.listeners.get(event) ?? new Set();
    set.add(handler as (payload: unknown) => void);
    this.listeners.set(event, set);
    return () => set.delete(handler as (payload: unknown) => void);
  }

  emit<K extends keyof RuntimeEvents>(event: K, payload: RuntimeEvents[K]): void {
    this.listeners.get(event)?.forEach((handler) => handler(payload));
  }
}

/**
 * Browser-only adapter. It deliberately never pretends to host real webviews:
 * native sessions, keychain and signatures remain Rust responsibilities.
 */
class MockBridge implements MesveeBridge {
  readonly runtime = 'mock' as const;
  private readonly events = new MockEmitter();
  private settings: Settings;
  private security: SecurityStatus;
  private pin: string | null = null;
  private recovery: string | null = 'MESV-7K2Q-9JX4';
  private attempts = 5;
  private unread: Record<string, number> = {
    '11111111-1111-4111-8111-111111111111': 3,
    '33333333-3333-4333-8333-333333333333': 7,
    '44444444-4444-4444-8444-444444444444': 1,
  };

  constructor() {
    const params = new URLSearchParams(window.location.search);
    if (params.has('fresh')) {
      localStorage.removeItem(STORAGE_KEY);
    }
    this.settings = this.load();
    this.security = {
      lockEnabled: this.settings.security.lockEnabled,
      configured: this.pin !== null || this.settings.security.lockEnabled,
      isLocked: false,
      autoLockMinutes: this.settings.security.autoLockMinutes,
      protectScreenCapture: this.settings.security.protectScreenCapture,
      attemptsRemaining: 5,
      lockoutUntil: null,
      recoveryConfigured: this.recovery !== null,
    };
  }

  private load(): Settings {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      if (!raw) return createDefaults();
      const parsed = JSON.parse(raw) as Settings;
      return { ...createDefaults(), ...parsed };
    } catch {
      return createDefaults();
    }
  }

  private persist(): void {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(this.settings));
  }

  private emitSettings(): void {
    this.persist();
    this.events.emit('settingsChanged', this.settings);
  }

  private runtimeState(serviceId: string) {
    return {
      serviceId,
      unread: this.unread[serviceId] ?? 0,
      loading: false,
      title: '',
      error: null,
      url: CATALOG.find((entry) => entry.kind === this.serviceById(serviceId)?.kind)?.url ?? null,
      created: false,
    };
  }

  async bootstrap(): Promise<Bootstrap> {
    return {
      app: {
        version: MOCK_VERSION,
        identifier: 'app.mesvee.desktop',
        platform: detectPlatform(),
        arch: 'arm64',
        isDev: true,
      },
      settings: this.settings,
      catalog: CATALOG,
      security: this.security,
      services: this.settings.services.map((service) => this.runtimeState(service.id)),
      startupWarning: null,
    };
  }

  async appReady(): Promise<void> {}

  async updateSettings(patch: SettingsPatch): Promise<Settings> {
    this.settings = applyPatch(this.settings, patch);
    this.security = {
      ...this.security,
      autoLockMinutes: this.settings.security.autoLockMinutes,
      protectScreenCapture: this.settings.security.protectScreenCapture,
      lockEnabled: this.settings.security.lockEnabled,
    };
    this.emitSettings();
    return this.settings;
  }

  async resetPreferences(): Promise<Settings> {
    const defaults = createDefaults();
    this.settings = {
      ...defaults,
      onboarded: this.settings.onboarded,
      services: this.settings.services,
      activeServiceId: this.settings.activeServiceId,
      security: { ...defaults.security, lockEnabled: this.settings.security.lockEnabled },
    };
    this.emitSettings();
    return this.settings;
  }

  async minimizeWindow(): Promise<void> {}
  async toggleMaximize(): Promise<boolean> { return false; }
  async isMaximized(): Promise<boolean> { return false; }
  async closeWindow(): Promise<void> {}
  async quitApp(): Promise<void> {}

  async openExternal(url: string): Promise<void> {
    console.info('[mock] open external', url);
  }

  async openFolder(target: string): Promise<void> {
    console.info('[mock] open folder', target);
  }

  async sendTestNotification(): Promise<void> {}

  async log(level: LogLevel, message: string, context?: string): Promise<void> {
    if (import.meta.env.DEV) console.debug(`[${level}] ${message}`, context ?? '');
  }

  async securityStatus(): Promise<SecurityStatus> {
    return this.security;
  }

  async enableLock(pin: string): Promise<RecoveryResult> {
    if (!/^\d{4,8}$/.test(pin)) {
      throw { code: 'pin_policy', message: 'Use 4–8 digits.' };
    }
    this.pin = pin;
    this.recovery = 'MESV-4P7A-N2KD';
    this.security = {
      ...this.security,
      lockEnabled: true,
      configured: true,
      recoveryConfigured: true,
    };
    this.settings = { ...this.settings, security: { ...this.settings.security, lockEnabled: true } };
    this.emitSettings();
    return { recoveryCode: this.recovery, status: this.security };
  }

  async disableLock(pin: string): Promise<SecurityStatus> {
    if (this.pin && pin !== this.pin) {
      throw { code: 'incorrect_pin', message: 'Incorrect PIN.' };
    }
    this.pin = null;
    this.security = { ...this.security, lockEnabled: false, configured: false, isLocked: false };
    this.settings = { ...this.settings, security: { ...this.settings.security, lockEnabled: false } };
    this.emitSettings();
    return this.security;
  }

  async lockApp(): Promise<void> {
    if (!this.pin && !this.security.configured) {
      throw { code: 'lock_not_configured', message: 'Set up a PIN first.' };
    }
    this.security = { ...this.security, isLocked: true };
    this.events.emit('locked', { reason: 'manual', at: new Date().toISOString() });
  }

  async unlockApp(pin: string): Promise<SecurityStatus> {
    if (this.pin && pin !== this.pin) {
      this.attempts = Math.max(0, this.attempts - 1);
      this.security = { ...this.security, attemptsRemaining: this.attempts };
      if (this.attempts === 0) {
        const until = new Date(Date.now() + 30_000).toISOString();
        this.security = { ...this.security, lockoutUntil: until };
        throw {
          code: 'locked_out',
          message: 'Too many attempts.',
          details: { secondsRemaining: 30, lockoutUntil: until },
        };
      }
      throw {
        code: 'incorrect_pin',
        message: 'Incorrect PIN.',
        details: { attemptsRemaining: this.attempts },
      };
    }
    this.attempts = 5;
    this.security = { ...this.security, isLocked: false, attemptsRemaining: 5, lockoutUntil: null };
    this.events.emit('unlocked', {});
    return this.security;
  }

  async changePin(currentPin: string, newPin: string): Promise<SecurityStatus> {
    if (this.pin && currentPin !== this.pin) {
      throw { code: 'incorrect_pin', message: 'Incorrect PIN.' };
    }
    if (!/^\d{4,8}$/.test(newPin)) throw { code: 'pin_policy', message: 'Use 4–8 digits.' };
    this.pin = newPin;
    return this.security;
  }

  async resetPinWithRecovery(recoveryCode: string, newPin: string): Promise<RecoveryResult> {
    if (recoveryCode.replace(/[^A-Z0-9]/gi, '').toUpperCase() !== (this.recovery ?? '').replace(/[^A-Z0-9]/g, '')) {
      throw { code: 'incorrect_pin', message: 'Recovery code is not valid.' };
    }
    this.pin = newPin;
    this.recovery = 'MESV-8H3F-Q6TR';
    this.security = {
      ...this.security,
      isLocked: false,
      lockEnabled: true,
      configured: true,
      recoveryConfigured: true,
    };
    this.settings = { ...this.settings, security: { ...this.settings.security, lockEnabled: true } };
    this.events.emit('unlocked', {});
    this.emitSettings();
    return { recoveryCode: this.recovery, status: this.security };
  }

  async regenerateRecovery(pin: string): Promise<RecoveryResult> {
    if (this.pin && pin !== this.pin) throw { code: 'incorrect_pin', message: 'Incorrect PIN.' };
    this.recovery = 'MESV-1W9C-V4MB';
    return { recoveryCode: this.recovery, status: this.security };
  }

  async addService(kind: string, label?: string): Promise<AddServiceResult> {
    const entry = CATALOG.find((item) => item.kind === kind);
    if (!entry) throw { code: 'not_found', message: 'Unknown service.' };
    const service: ServiceInstance = {
      id: crypto.randomUUID(),
      kind,
      label: label?.trim() || entry.name,
      muted: false,
      zoom: 1,
      createdAt: new Date().toISOString(),
    };
    this.settings = {
      ...this.settings,
      services: [...this.settings.services, service],
      activeServiceId: service.id,
    };
    this.emitSettings();
    return { service, settings: this.settings };
  }

  async removeService(serviceId: string, _clearData: boolean): Promise<Settings> {
    this.settings = {
      ...this.settings,
      services: this.settings.services.filter((service) => service.id !== serviceId),
      activeServiceId:
        this.settings.activeServiceId === serviceId ? null : this.settings.activeServiceId,
    };
    delete this.unread[serviceId];
    this.emitSettings();
    this.events.emit('serviceRemoved', { serviceId });
    return this.settings;
  }

  async setActiveService(serviceId: string | null): Promise<Settings> {
    this.settings = { ...this.settings, activeServiceId: serviceId };
    this.emitSettings();
    return this.settings;
  }

  async reorderServices(serviceIds: string[]): Promise<Settings> {
    const ordered = [...this.settings.services].sort(
      (a, b) => serviceIds.indexOf(a.id) - serviceIds.indexOf(b.id),
    );
    this.settings = { ...this.settings, services: ordered };
    this.emitSettings();
    return this.settings;
  }

  async setServiceMuted(serviceId: string, muted: boolean): Promise<Settings> {
    this.settings = {
      ...this.settings,
      services: this.settings.services.map((service) =>
        service.id === serviceId ? { ...service, muted } : service,
      ),
    };
    this.emitSettings();
    return this.settings;
  }

  async setServiceZoom(serviceId: string, zoom: number): Promise<Settings> {
    this.settings = {
      ...this.settings,
      services: this.settings.services.map((service) =>
        service.id === serviceId ? { ...service, zoom } : service,
      ),
    };
    this.emitSettings();
    return this.settings;
  }

  async syncWorkspace(_activeId: string | null, _visible: boolean, _bounds: WorkspaceBounds): Promise<void> {}

  async navigateService(action: NavigationAction): Promise<void> {
    console.info('[mock] navigate service', action);
  }

  async clearServiceData(serviceId: string): Promise<void> {
    this.unread[serviceId] = 0;
  }

  async checkForUpdate(): Promise<UpdateInfo | null> {
    return null;
  }

  async installUpdate(): Promise<void> {
    throw { code: 'no_update', message: 'Mesvee is already up to date.' };
  }

  async exportDiagnostics(): Promise<DiagnosticsResult> {
    return { path: '/Users/demo/Downloads/Mesvee-Diagnostics', logFiles: 3 };
  }

  subscribe<K extends keyof RuntimeEvents>(
    event: K,
    handler: (payload: RuntimeEvents[K]) => void,
  ): () => void {
    return this.events.subscribe(event, handler);
  }

  /** Local lookup helper for the mock's simulated page titles. */
  private serviceById(serviceId: string): ServiceInstance | undefined {
    return this.settings.services.find((service) => service.id === serviceId);
  }
}

/** Singleton preview adapter. */
export const mockBridge = new MockBridge();
