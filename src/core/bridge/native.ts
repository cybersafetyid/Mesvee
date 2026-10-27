import { invoke } from '@tauri-apps/api/core';
import { listen } from '@tauri-apps/api/event';
import type { MesveeBridge, RuntimeEvents } from './types';
import type {
  AddServiceResult,
  Bootstrap,
  DiagnosticsResult,
  LogLevel,
  NavigationAction,
  RecoveryResult,
  SecurityStatus,
  Settings,
  SettingsPatch,
  UpdateInfo,
  WorkspaceBounds,
} from '../types';

/** Maps renderer event names to the stable Rust event channels. */
const EVENT_NAMES: Record<keyof RuntimeEvents, string> = {
  serviceState: 'mesvee:service-state',
  settingsChanged: 'mesvee:settings-changed',
  locked: 'mesvee:locked',
  unlocked: 'mesvee:unlocked',
  navigate: 'mesvee:navigate',
  download: 'mesvee:download',
  updateAvailable: 'mesvee:update-available',
  updateProgress: 'mesvee:update-progress',
  updateInstalled: 'mesvee:update-installed',
  serviceRemoved: 'mesvee:service-removed',
};

/**
 * Production adapter. Every privileged command is guarded in Rust by the caller
 * webview label; this layer only provides a typed, ergonomic surface.
 */
class TauriBridge implements MesveeBridge {
  readonly runtime = 'tauri' as const;

  bootstrap(): Promise<Bootstrap> {
    return invoke('bootstrap');
  }

  appReady(): Promise<void> {
    return invoke('app_ready');
  }

  updateSettings(patch: SettingsPatch): Promise<Settings> {
    return invoke('update_settings', { patch });
  }

  resetPreferences(): Promise<Settings> {
    return invoke('reset_preferences');
  }

  minimizeWindow(): Promise<void> {
    return invoke('window_minimize');
  }

  toggleMaximize(): Promise<boolean> {
    return invoke('window_toggle_maximize');
  }

  isMaximized(): Promise<boolean> {
    return invoke('window_is_maximized');
  }

  closeWindow(): Promise<void> {
    return invoke('window_close');
  }

  quitApp(): Promise<void> {
    return invoke('quit_app');
  }

  openExternal(url: string): Promise<void> {
    return invoke('open_external', { url });
  }

  openFolder(target: 'logs' | 'config' | 'data'): Promise<void> {
    return invoke('open_folder', { target });
  }

  sendTestNotification(): Promise<void> {
    return invoke('send_test_notification');
  }

  log(level: LogLevel, message: string, context?: string): Promise<void> {
    return invoke('log_frontend', { level, message, context });
  }

  securityStatus(): Promise<SecurityStatus> {
    return invoke('security_status');
  }

  enableLock(pin: string): Promise<RecoveryResult> {
    return invoke('enable_lock', { pin });
  }

  disableLock(pin: string): Promise<SecurityStatus> {
    return invoke('disable_lock', { pin });
  }

  lockApp(): Promise<void> {
    return invoke('lock_app');
  }

  unlockApp(pin: string): Promise<SecurityStatus> {
    return invoke('unlock_app', { pin });
  }

  changePin(currentPin: string, newPin: string): Promise<SecurityStatus> {
    return invoke('change_pin', { currentPin, newPin });
  }

  resetPinWithRecovery(recoveryCode: string, newPin: string): Promise<RecoveryResult> {
    return invoke('reset_pin_with_recovery', { recoveryCode, newPin });
  }

  regenerateRecovery(pin: string): Promise<RecoveryResult> {
    return invoke('regenerate_recovery', { pin });
  }

  addService(kind: string, label?: string): Promise<AddServiceResult> {
    return invoke('add_service', { kind, label: label ?? null });
  }

  removeService(serviceId: string, clearData: boolean): Promise<Settings> {
    return invoke('remove_service', { serviceId, clearData });
  }

  setActiveService(serviceId: string | null): Promise<Settings> {
    return invoke('set_active_service', { serviceId });
  }

  reorderServices(serviceIds: string[]): Promise<Settings> {
    return invoke('reorder_services', { serviceIds });
  }

  setServiceMuted(serviceId: string, muted: boolean): Promise<Settings> {
    return invoke('set_service_muted', { serviceId, muted });
  }

  setServiceZoom(serviceId: string, zoom: number): Promise<Settings> {
    return invoke('set_service_zoom', { serviceId, zoom });
  }

  syncWorkspace(activeId: string | null, visible: boolean, bounds: WorkspaceBounds): Promise<void> {
    return invoke('sync_workspace', { activeId, visible, bounds });
  }

  navigateService(action: NavigationAction): Promise<void> {
    return invoke('service_navigate', { action });
  }

  clearServiceData(serviceId: string): Promise<void> {
    return invoke('clear_service_data', { serviceId });
  }

  checkForUpdate(): Promise<UpdateInfo | null> {
    return invoke('check_for_update');
  }

  installUpdate(): Promise<void> {
    return invoke('install_update');
  }

  exportDiagnostics(): Promise<DiagnosticsResult> {
    return invoke('export_diagnostics');
  }

  subscribe<K extends keyof RuntimeEvents>(
    event: K,
    handler: (payload: RuntimeEvents[K]) => void,
  ): () => void {
    let disposed = false;
    let unlisten: (() => void) | undefined;
    void listen<RuntimeEvents[K]>(EVENT_NAMES[event], (message) => handler(message.payload))
      .then((dispose) => {
        if (disposed) {
          dispose();
        } else {
          unlisten = dispose;
        }
      })
      .catch((error) => {
        // Event permission failure must not break the app shell.
        console.error(`Failed to listen for ${event}`, error);
      });
    return () => {
      disposed = true;
      unlisten?.();
    };
  }
}
/** Singleton native adapter. */
export const nativeBridge = new TauriBridge();
