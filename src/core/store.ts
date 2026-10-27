import { create } from 'zustand';
import i18n from './i18n';
import { bridge } from './bridge';
import type { MesveeBridge } from './bridge/types';
import type {
  AppInfo,
  Bootstrap,
  CatalogEntry,
  CommandErrorShape,
  Route,
  SecurityStatus,
  ServiceRuntimeState,
  Settings,
  SettingsPatch,
  SettingsSection,
  ToastMessage,
  UpdateInfo,
  UpdateProgress,
} from './types';
import { toCommandError } from './types';

type UpdateState = 'idle' | 'checking' | 'available' | 'upToDate' | 'downloading' | 'installing' | 'error';

interface AppStore {
  bridge: MesveeBridge;
  booted: boolean;
  bootError: string | null;
  app: AppInfo | null;
  settings: Settings | null;
  catalog: CatalogEntry[];
  security: SecurityStatus | null;
  serviceStates: Record<string, ServiceRuntimeState>;
  route: Route;
  /** Route restored when the user leaves Settings. */
  previousRoute: Route | null;
  settingsSection: SettingsSection;
  paletteOpen: boolean;
  addServiceOpen: boolean;
  updateState: UpdateState;
  updateInfo: UpdateInfo | null;
  updateProgress: UpdateProgress | null;
  updateError: string | null;
  toasts: ToastMessage[];

  init: () => Promise<void>;
  retryBootstrap: () => Promise<void>;
  navigate: (route: Route) => void;
  openSettings: (section?: SettingsSection) => void;
  closeSettings: () => void;
  lockNow: () => Promise<void>;
  goHome: () => void;
  openService: (serviceId: string) => Promise<void>;
  setPaletteOpen: (open: boolean) => void;
  setAddServiceOpen: (open: boolean) => void;
  setSecurity: (security: SecurityStatus) => void;
  saveSettings: (patch: SettingsPatch) => Promise<Settings>;
  refreshSecurity: () => Promise<SecurityStatus>;
  addService: (kind: string, label?: string) => Promise<ServiceRuntimeState>;
  removeService: (serviceId: string, clearData: boolean) => Promise<void>;
  muteService: (serviceId: string, muted: boolean) => Promise<void>;
  zoomService: (serviceId: string, zoom: number) => Promise<void>;
  clearServiceData: (serviceId: string) => Promise<void>;
  checkForUpdate: () => Promise<void>;
  installUpdate: () => Promise<void>;
  toast: (toast: Omit<ToastMessage, 'id'>) => void;
  dismissToast: (id: string) => void;
  resetPreferences: () => Promise<void>;
}

/** Converts a runtime service array into the keyed store shape. */
function indexServices(services: ServiceRuntimeState[]): Record<string, ServiceRuntimeState> {
  return Object.fromEntries(services.map((service) => [service.serviceId, service]));
}

/** Finds the most natural landing route after bootstrap. */
function landingRoute(bootstrap: Bootstrap): Route {
  if (!bootstrap.settings.onboarded) return 'onboarding';
  if (bootstrap.settings.activeServiceId) return 'service';
  return 'home';
}

/** Guards the one-shot readiness signal so a retry can never double-send it. */
let readyReported = false;

/**
 * Tells Rust the shell has rendered so it can reveal the window (and honour
 * start-minimized). We wait for the first frame to avoid a white flash, but a
 * window created with `visible: false` may not produce frames at all, leaving
 * `requestAnimationFrame` pending until Rust's 9-second safety net. The timeout
 * is the belt to that suspenders: whichever fires first reports readiness.
 */
function reportReady(): void {
  if (readyReported) return;
  readyReported = true;
  const send = () => {
    void bridge.appReady().catch((error) => {
      void bridge.log('error', 'app_ready failed', JSON.stringify(error)).catch(() => undefined);
    });
  };
  requestAnimationFrame(send);
  window.setTimeout(send, 600);
}

let subscriptionsAttached = false;

/**
 * Central renderer state. Native remains authoritative for settings, security
 * and service sessions; this store is a projection with explicit mutations.
 */
export const useAppStore = create<AppStore>((set, get) => ({
  bridge,
  booted: false,
  bootError: null,
  app: null,
  settings: null,
  catalog: [],
  security: null,
  serviceStates: {},
  route: 'home',
  previousRoute: null,
  settingsSection: 'general',
  paletteOpen: false,
  addServiceOpen: false,
  updateState: 'idle',
  updateInfo: null,
  updateProgress: null,
  updateError: null,
  toasts: [],

  init: async () => {
    const { bridge } = get();

    if (!subscriptionsAttached) {
      subscriptionsAttached = true;
      bridge.subscribe('settingsChanged', (settings) => set({ settings }));
      bridge.subscribe('serviceState', (state) =>
        set((current) => ({
          serviceStates: { ...current.serviceStates, [state.serviceId]: state },
        })),
      );
      bridge.subscribe('locked', () => {
        set((current) => ({
          paletteOpen: false,
          addServiceOpen: false,
          security: current.security ? { ...current.security, isLocked: true } : current.security,
        }));
      });
      bridge.subscribe('unlocked', () => {
        void get()
          .refreshSecurity()
          .catch(() => undefined);
      });
      bridge.subscribe('navigate', (payload) => {
        if (payload.route === 'settings') {
          get().openSettings((payload.section as SettingsSection | undefined) ?? 'general');
        } else if (payload.route === 'home') {
          get().goHome();
        }
      });
      bridge.subscribe('serviceRemoved', ({ serviceId }) => {
        set((current) => {
          const next = { ...current.serviceStates };
          delete next[serviceId];
          return { serviceStates: next };
        });
      });
      bridge.subscribe('download', (payload) => {
        get().toast({
          tone: payload.success ? 'success' : 'error',
          title: i18n.t(payload.success ? 'toasts.downloadComplete' : 'toasts.downloadFailed'),
          description: payload.path ?? undefined,
        });
      });
      bridge.subscribe('updateAvailable', (info) => {
        set({ updateInfo: info, updateState: 'available', updateError: null });
        get().toast({
          tone: 'info',
          title: i18n.t('toasts.updateAvailable', { version: info.version }),
          description: i18n.t('updates.availableDesc'),
        });
      });
      bridge.subscribe('updateProgress', (progress) => {
        set({ updateProgress: progress, updateState: 'downloading' });
      });
      bridge.subscribe('updateInstalled', () => {
        set({ updateState: 'installing' });
      });
    }

    try {
      const bootstrap = await bridge.bootstrap();
      set({
        booted: true,
        bootError: null,
        app: bootstrap.app,
        settings: bootstrap.settings,
        catalog: bootstrap.catalog,
        security: bootstrap.security,
        serviceStates: indexServices(bootstrap.services),
        route: landingRoute(bootstrap),
      });
      if (bootstrap.startupWarning) {
        get().toast({
          tone: 'info',
          title: i18n.t('toasts.startupWarning'),
          description: bootstrap.startupWarning,
        });
      }
      // Reveal the native window once the shell has painted (or timed out).
      reportReady();
    } catch (error) {
      const normalized = toCommandError(error);
      set({ booted: true, bootError: normalized.message });
      void bridge.log('error', 'bootstrap failed', normalized.message).catch(() => undefined);
      reportReady();
    }
  },

  retryBootstrap: async () => {
    set({ booted: false, bootError: null });
    await get().init();
  },

  /** Navigates without leaving a stale native surface visible. */
  navigate: (route) => set({ route, paletteOpen: false }),

  openSettings: (section = 'general') =>
    set((current) => ({
      route: 'settings',
      previousRoute: current.route === 'settings' ? current.previousRoute : current.route,
      settingsSection: section,
      paletteOpen: false,
      addServiceOpen: false,
    })),

  /** Returns to where the user was before opening Settings. */
  closeSettings: () => {
    const { previousRoute, settings } = get();
    const fallback: Route = settings?.activeServiceId ? 'service' : 'home';
    set({ route: previousRoute && previousRoute !== 'settings' ? previousRoute : fallback });
  },

  goHome: () => set({ route: 'home', paletteOpen: false, addServiceOpen: false }),

  /**
   * Selects an account. Rust persists the selection and the native surface is
   * synced by the workspace; no second bootstrap round-trip is needed here.
   */
  openService: async (serviceId) => {
    const { bridge, settings } = get();
    const service = settings?.services.find((item) => item.id === serviceId);
    if (!service) return;
    try {
      const updated = await bridge.setActiveService(serviceId);
      set((current) => ({
        settings: { ...updated, activeServiceId: serviceId },
        route: 'service',
        paletteOpen: false,
        addServiceOpen: false,
        serviceStates: current.serviceStates[serviceId]
          ? current.serviceStates
          : {
              ...current.serviceStates,
              [serviceId]: {
                serviceId,
                unread: 0,
                loading: true,
                title: '',
                error: null,
                url: null,
                created: false,
              },
            },
      }));
    } catch (error) {
      const normalized = toCommandError(error);
      get().toast({ tone: 'error', title: i18n.t('errors.generic'), description: normalized.message });
    }
  },

  /** Requests an immediate lock; Rust re-checks that a PIN exists. */
  lockNow: async () => {
    try {
      await get().bridge.lockApp();
    } catch (error) {
      const normalized = toCommandError(error);
      get().toast({ tone: 'error', title: i18n.t('toasts.lockUnavailable'), description: normalized.message });
    }
  },

  setPaletteOpen: (open) => set({ paletteOpen: open }),
  setAddServiceOpen: (open) => set({ addServiceOpen: open }),
  setSecurity: (security) => set({ security }),

  saveSettings: async (patch) => {
    const updated = await get().bridge.updateSettings(patch);
    set({ settings: updated });
    return updated;
  },

  refreshSecurity: async () => {
    const security = await get().bridge.securityStatus();
    set({ security });
    return security;
  },

  addService: async (kind, label) => {
    const { bridge } = get();
    const result = await bridge.addService(kind, label);
    set({ settings: result.settings });
    const runtime: ServiceRuntimeState = {
      serviceId: result.service.id,
      unread: 0,
      loading: false,
      title: '',
      error: null,
      url: null,
      created: false,
    };
    set((current) => ({
      serviceStates: { ...current.serviceStates, [result.service.id]: runtime },
    }));
    return runtime;
  },

  removeService: async (serviceId, clearData) => {
    const updated = await get().bridge.removeService(serviceId, clearData);
    set((current) => {
      const states = { ...current.serviceStates };
      delete states[serviceId];
      return {
        settings: updated,
        serviceStates: states,
        route:
          updated.activeServiceId === null && current.route === 'service' ? 'home' : current.route,
      };
    });
  },

  muteService: async (serviceId, muted) => {
    const updated = await get().bridge.setServiceMuted(serviceId, muted);
    set({ settings: updated });
  },

  zoomService: async (serviceId, zoom) => {
    const updated = await get().bridge.setServiceZoom(serviceId, zoom);
    set({ settings: updated });
  },

  clearServiceData: async (serviceId) => {
    await get().bridge.clearServiceData(serviceId);
    set((current) => ({
      serviceStates: {
        ...current.serviceStates,
        [serviceId]: {
          ...(current.serviceStates[serviceId] ?? {
            serviceId,
            unread: 0,
            loading: false,
            title: '',
            error: null,
            url: null,
            created: false,
          }),
          unread: 0,
          created: false,
          loading: false,
          error: null,
        },
      },
    }));
  },

  checkForUpdate: async () => {
    set({ updateState: 'checking', updateError: null });
    try {
      const info = await get().bridge.checkForUpdate();
      if (info) {
        set({ updateInfo: info, updateState: 'available' });
      } else {
        set({ updateInfo: null, updateState: 'upToDate' });
      }
    } catch (error) {
      const normalized = toCommandError(error);
      set({
        updateState: 'error',
        updateError: normalized.code === 'no_update' ? null : normalized.message,
      });
      if (normalized.code === 'no_update') set({ updateState: 'upToDate' });
    }
  },

  installUpdate: async () => {
    set({ updateState: 'downloading', updateProgress: null, updateError: null });
    try {
      await get().bridge.installUpdate();
      set({ updateState: 'installing' });
    } catch (error) {
      const normalized = toCommandError(error);
      set({ updateState: 'error', updateError: normalized.message });
    }
  },

  toast: (toast) => {
    const id = globalThis.crypto?.randomUUID?.() ?? `${Date.now()}-${Math.random()}`;
    set((current) => ({ toasts: [...current.toasts.slice(-3), { ...toast, id }] }));
    window.setTimeout(() => get().dismissToast(id), 5200);
  },

  dismissToast: (id) =>
    set((current) => ({ toasts: current.toasts.filter((toast) => toast.id !== id) })),

  resetPreferences: async () => {
    const updated = await get().bridge.resetPreferences();
    set({ settings: updated });
  },
}));

/** Re-exports for components that only need error normalization. */
export type { CommandErrorShape, SettingsPatch, UpdateInfo };
