/**
 * Domain contracts shared by the renderer and the Rust command layer.
 * Values are intentionally serializable so IPC payloads stay transparent.
 */

export type Language = 'id' | 'en';
export type Theme = 'system' | 'dark' | 'light';
export type MotionPreference = 'system' | 'reduce' | 'full';
export type Density = 'comfortable' | 'compact';
export type LogLevel = 'error' | 'warn' | 'info' | 'debug';
export type ServiceCategory = 'messaging' | 'social' | 'work';

export interface GeneralSettings {
  launchAtLogin: boolean;
  startMinimized: boolean;
  closeToTray: boolean;
  showTrayIcon: boolean;
}

export interface AppearanceSettings {
  language: Language;
  theme: Theme;
  motion: MotionPreference;
  density: Density;
}

export interface NotificationSettings {
  enabled: boolean;
  showBadge: boolean;
  onlyWhenUnfocused: boolean;
  focusMode: boolean;
}

export interface SecuritySettings {
  lockEnabled: boolean;
  autoLockMinutes: number;
  lockOnFocusLoss: boolean;
  protectScreenCapture: boolean;
}

/** The patch may only change preferences, never the lock ownership flag. */
export interface SecurityPreferences {
  autoLockMinutes: number;
  lockOnFocusLoss: boolean;
  protectScreenCapture: boolean;
}

export interface MediaPermissions {
  microphone: boolean;
  camera: boolean;
}

export interface UpdatePreferences {
  autoCheck: boolean;
}

export interface AdvancedSettings {
  logLevel: LogLevel;
}

export interface ServiceInstance {
  id: string;
  kind: string;
  label: string;
  muted: boolean;
  zoom: number;
  createdAt: string;
}

export interface Settings {
  schemaVersion: number;
  onboarded: boolean;
  activeServiceId: string | null;
  general: GeneralSettings;
  appearance: AppearanceSettings;
  notifications: NotificationSettings;
  security: SecuritySettings;
  media: MediaPermissions;
  updates: UpdatePreferences;
  advanced: AdvancedSettings;
  services: ServiceInstance[];
}

export interface SettingsPatch {
  onboarded?: boolean;
  general?: GeneralSettings;
  appearance?: AppearanceSettings;
  notifications?: NotificationSettings;
  security?: SecurityPreferences;
  media?: MediaPermissions;
  updates?: UpdatePreferences;
  advanced?: AdvancedSettings;
}

export interface CatalogEntry {
  kind: string;
  name: string;
  url: string;
  category: ServiceCategory;
  supportsUnread: boolean;
}

export interface AppInfo {
  version: string;
  identifier: string;
  platform: string;
  arch: string;
  isDev: boolean;
}

export interface SecurityStatus {
  lockEnabled: boolean;
  configured: boolean;
  isLocked: boolean;
  autoLockMinutes: number;
  protectScreenCapture: boolean;
  attemptsRemaining: number;
  lockoutUntil: string | null;
  recoveryConfigured: boolean;
}

export interface ServiceRuntimeState {
  serviceId: string;
  unread: number;
  loading: boolean;
  title: string;
  error: string | null;
  url: string | null;
  created: boolean;
}

export interface Bootstrap {
  app: AppInfo;
  settings: Settings;
  catalog: CatalogEntry[];
  security: SecurityStatus;
  services: ServiceRuntimeState[];
  startupWarning: string | null;
}

export interface WorkspaceBounds {
  x: number;
  y: number;
  width: number;
  height: number;
}

export interface AddServiceResult {
  service: ServiceInstance;
  settings: Settings;
}

export interface RecoveryResult {
  recoveryCode: string;
  status: SecurityStatus;
}

export interface UpdateInfo {
  version: string;
  currentVersion: string;
  notes: string | null;
  date: string | null;
}

export interface UpdateProgress {
  downloaded: number;
  total: number | null;
}

export interface DiagnosticsResult {
  path: string;
  logFiles: number;
}

export interface CommandErrorShape {
  code: string;
  message: string;
  details?: Record<string, unknown>;
}

export interface ToastMessage {
  id: string;
  tone: 'success' | 'error' | 'info';
  title: string;
  description?: string;
}

export type SettingsSection =
  | 'general'
  | 'appearance'
  | 'notifications'
  | 'services'
  | 'security'
  | 'updates'
  | 'advanced'
  | 'about';

export type Route = 'home' | 'service' | 'settings' | 'onboarding';

export type NavigationAction =
  | 'back'
  | 'forward'
  | 'reload'
  | 'stop'
  | 'home'
  | 'external'
  | 'devtools';

/** Normalizes unknown invoke failures into the backend's stable error shape. */
export function toCommandError(error: unknown): CommandErrorShape {
  if (typeof error === 'object' && error !== null) {
    const candidate = error as Partial<CommandErrorShape>;
    if (typeof candidate.code === 'string' && typeof candidate.message === 'string') {
      return {
        code: candidate.code,
        message: candidate.message,
        details: candidate.details,
      };
    }
    if (error instanceof Error) {
      return { code: 'unexpected_error', message: error.message };
    }
  }
  if (typeof error === 'string') {
    return { code: 'unexpected_error', message: error };
  }
  return {
    code: 'unexpected_error',
    message: 'Something unexpected happened.',
  };
}
