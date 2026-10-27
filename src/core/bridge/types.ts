import type {
  AddServiceResult,
  Bootstrap,
  DiagnosticsResult,
  NavigationAction,
  RecoveryResult,
  SecurityStatus,
  ServiceRuntimeState,
  Settings,
  SettingsPatch,
  UpdateInfo,
  UpdateProgress,
  WorkspaceBounds,
  LogLevel,
} from '../types';

/** Payloads pushed by Rust after native or service events. */
export interface RuntimeEvents {
  serviceState: ServiceRuntimeState;
  settingsChanged: Settings;
  locked: { reason: string; at: string };
  unlocked: Record<string, never>;
  navigate: { route: string; section?: string };
  download: { url: string; path?: string | null; success: boolean };
  updateAvailable: UpdateInfo;
  updateProgress: UpdateProgress;
  updateInstalled: { version: string };
  serviceRemoved: { serviceId: string };
}

/**
 * The single port between React and the native layer.
 * Components never call Tauri directly, which keeps the browser preview and
 * future platforms replaceable without touching UI code.
 */
export interface MesveeBridge {
  readonly runtime: 'tauri' | 'mock';
  bootstrap(): Promise<Bootstrap>;
  appReady(): Promise<void>;

  updateSettings(patch: SettingsPatch): Promise<Settings>;
  resetPreferences(): Promise<Settings>;

  minimizeWindow(): Promise<void>;
  toggleMaximize(): Promise<boolean>;
  isMaximized(): Promise<boolean>;
  closeWindow(): Promise<void>;
  quitApp(): Promise<void>;

  openExternal(url: string): Promise<void>;
  openFolder(target: 'logs' | 'config' | 'data'): Promise<void>;
  sendTestNotification(): Promise<void>;
  log(level: LogLevel, message: string, context?: string): Promise<void>;

  securityStatus(): Promise<SecurityStatus>;
  enableLock(pin: string): Promise<RecoveryResult>;
  disableLock(pin: string): Promise<SecurityStatus>;
  lockApp(): Promise<void>;
  unlockApp(pin: string): Promise<SecurityStatus>;
  changePin(currentPin: string, newPin: string): Promise<SecurityStatus>;
  resetPinWithRecovery(recoveryCode: string, newPin: string): Promise<RecoveryResult>;
  regenerateRecovery(pin: string): Promise<RecoveryResult>;

  addService(kind: string, label?: string): Promise<AddServiceResult>;
  removeService(serviceId: string, clearData: boolean): Promise<Settings>;
  setActiveService(serviceId: string | null): Promise<Settings>;
  reorderServices(serviceIds: string[]): Promise<Settings>;
  setServiceMuted(serviceId: string, muted: boolean): Promise<Settings>;
  setServiceZoom(serviceId: string, zoom: number): Promise<Settings>;
  syncWorkspace(activeId: string | null, visible: boolean, bounds: WorkspaceBounds): Promise<void>;
  navigateService(action: NavigationAction): Promise<void>;
  clearServiceData(serviceId: string): Promise<void>;

  checkForUpdate(): Promise<UpdateInfo | null>;
  installUpdate(): Promise<void>;
  exportDiagnostics(): Promise<DiagnosticsResult>;

  subscribe<K extends keyof RuntimeEvents>(
    event: K,
    handler: (payload: RuntimeEvents[K]) => void,
  ): () => void;
}
