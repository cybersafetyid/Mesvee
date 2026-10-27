import { memo, useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  Bell,
  BellRing,
  Camera,
  Check,
  CloudDownload,
  Code2,
  Download,
  ExternalLink,
  FolderOpen,
  Globe2,
  Home,
  Info,
  KeyRound,
  LockKeyhole,
  Mic,
  Monitor,
  Moon,
  Palette,
  Plus,
  QrCode,
  RotateCcw,
  RotateCw,
  ScrollText,
  Search,
  ShieldCheck,
  SlidersHorizontal,
  Sparkles,
  Sun,
  Trash2,
  Volume2,
  VolumeX,
  Zap,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { Button, IconButton } from '../../ui/Button';
import { Switch, Segmented } from '../../ui/Controls';
import { Select, SettingRow, SettingsCard } from '../../ui/Form';
import { Logo } from '../../ui/Logo';
import { ServiceIcon } from '../../ui/ServiceIcon';
import { SecurityDialog } from './SecurityDialogs';
import type { SecurityDialogKind } from './SecurityDialogs';
import { cn } from '../../lib/cn';
import { commandModifier, detectPlatform } from '../../lib/platform';
import type { Density, Language, LogLevel, MotionPreference, SettingsSection, Theme } from '../../core/types';

/** Ordered navigation for the settings rail. */
const SECTIONS: SettingsSection[] = [
  'general',
  'appearance',
  'notifications',
  'services',
  'security',
  'updates',
  'advanced',
  'about',
];

/** Auto-lock choices exposed to the user (minutes). */
const AUTO_LOCK_OPTIONS = [
  { value: '0', label: 'Off' },
  { value: '1', label: '1 min' },
  { value: '5', label: '5 min' },
  { value: '15', label: '15 min' },
  { value: '30', label: '30 min' },
  { value: '60', label: '1 hour' },
  { value: '240', label: '4 hours' },
];

/**
 * Full settings experience. Every control writes through the guarded Rust
 * command layer so preferences are validated and persisted atomically.
 */
export function SettingsScreen() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const app = useAppStore((state) => state.app);
  const security = useAppStore((state) => state.security);
  const catalog = useAppStore((state) => state.catalog);
  const section = useAppStore((state) => state.settingsSection);
  const openSettings = useAppStore((state) => state.openSettings);
  const closeSettings = useAppStore((state) => state.closeSettings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const resetPreferences = useAppStore((state) => state.resetPreferences);
  const removeService = useAppStore((state) => state.removeService);
  const clearServiceData = useAppStore((state) => state.clearServiceData);
  const muteService = useAppStore((state) => state.muteService);
  const zoomService = useAppStore((state) => state.zoomService);
  const openService = useAppStore((state) => state.openService);
  const setAddServiceOpen = useAppStore((state) => state.setAddServiceOpen);
  const checkForUpdate = useAppStore((state) => state.checkForUpdate);
  const installUpdate = useAppStore((state) => state.installUpdate);
  const bridge = useAppStore((state) => state.bridge);
  const toast = useAppStore((state) => state.toast);
  const updateState = useAppStore((state) => state.updateState);
  const updateInfo = useAppStore((state) => state.updateInfo);
  const updateProgress = useAppStore((state) => state.updateProgress);

  const [securityDialog, setSecurityDialog] = useState<SecurityDialogKind | null>(null);
  const [removingServiceId, setRemovingServiceId] = useState<string | null>(null);
  const [confirmReset, setConfirmReset] = useState(false);
  const contentScrollRef = useRef<HTMLDivElement>(null);

  // Keep scroll position neat at top when switching sections without unmounting or jarring animations
  useEffect(() => {
    contentScrollRef.current?.scrollTo({ top: 0, behavior: 'instant' });
  }, [section]);

  /** Persists a section patch and confirms via toast. */
  const persist = async (patch: Parameters<typeof saveSettings>[0], silent = false) => {
    try {
      await saveSettings(patch);
      if (!silent) toast({ tone: 'success', title: t('toasts.saved') });
    } catch (error) {
      toast({ tone: 'error', title: t('toasts.storageError'), description: String(error) });
    }
  };

  if (!settings) return null;

  const platform = detectPlatform();
  void commandModifier(platform);

  const sectionMeta: Record<SettingsSection, { icon: React.ReactNode; label: string }> = {
    general: { icon: <SlidersHorizontal />, label: t('settings.general') },
    appearance: { icon: <Palette />, label: t('settings.appearance') },
    notifications: { icon: <BellRing />, label: t('settings.notifications') },
    services: { icon: <Zap />, label: t('settings.services') },
    security: { icon: <ShieldCheck />, label: t('settings.security') },
    updates: { icon: <CloudDownload />, label: t('settings.updates') },
    advanced: { icon: <Code2 />, label: t('settings.advanced') },
    about: { icon: <Info />, label: t('settings.about') },
  };

  const percent =
    updateProgress && updateProgress.total
      ? Math.min(100, Math.round((updateProgress.downloaded / updateProgress.total) * 100))
      : null;

  return (
    // Insets mirror the service screen: 12px above and beside, 8px below so the
    // section rail ends level with the app sidebar.
    <div className="flex h-full gap-2.5 px-3 pt-3 pb-2">
      {/* Section rail — a floating card, matching the app sidebar language. */}
      <aside
        className={cn(
          'flex w-[224px] shrink-0 flex-col rounded-[20px] p-3',
          'border border-[var(--border)] bg-[var(--glass)] shadow-[var(--shadow-glass)] backdrop-blur-2xl',
        )}
      >
        <button
          type="button"
          onClick={closeSettings}
          className="interactive-ring mb-3 flex h-9 items-center gap-2 rounded-[11px] px-2.5 text-[12px] font-medium text-soft hover:bg-[var(--glass-hover)] hover:text-ink"
        >
          <ArrowLeft className="size-3.5" aria-hidden />
          {t('settings.backToApp')}
        </button>
        <p className="eyebrow px-2.5 pb-2">{t('settings.sectionNav')}</p>
        <nav className="flex flex-col gap-0.5">
          {SECTIONS.map((item) => {
            const meta = sectionMeta[item];
            const active = section === item;
            return (
              <button
                key={item}
                type="button"
                onClick={() => openSettings(item)}
                aria-current={active ? 'page' : undefined}
                className={cn(
                  'interactive-ring flex h-9 items-center gap-2.5 rounded-[10px] px-2.5 text-left text-[12px] transition-colors',
                  active
                    ? 'bg-accent text-accent-ink'
                    : 'text-soft hover:bg-[var(--glass-hover)] hover:text-ink',
                )}
              >
                <span className="[&_svg]:size-3.5">{meta.icon}</span>
                {meta.label}
              </button>
            );
          })}
        </nav>
        <div className="mt-auto rounded-[12px] border border-line bg-[var(--glass)] p-2.5">
          <p className="text-[10px] leading-relaxed text-faint">{t('settings.dataNote')}</p>
        </div>
      </aside>

      {/* Content — its own floating card, so both settings columns read as glass
          panels hovering over the canvas instead of one flat page. */}
      <div
        className={cn(
          'relative min-w-0 flex-1 overflow-hidden rounded-[20px]',
          'border border-[var(--border)] bg-[var(--glass)] shadow-[var(--shadow-glass)] backdrop-blur-2xl',
        )}
      >
        <SettingsAmbientVisual />

        <div ref={contentScrollRef} className="relative z-10 h-full overflow-y-auto pr-1">
          <div className="w-full max-w-[620px] px-6 py-6 lg:pl-8 lg:pr-6">
            <header className="mb-6">
              <h1 className="text-[26px] font-semibold tracking-[-0.045em] text-ink">
                {t('settings.title')}
              </h1>
              <p className="mt-1.5 text-[12.5px] text-soft">{t('settings.subtitle')}</p>
            </header>

          <div key={section} className="enter-rise space-y-4">
            {/* ---------------- General ---------------- */}
            {section === 'general' && (
              <>
                <SettingsCard title={t('settings.startupTitle')} description={t('settings.generalDesc')}>
                  <SettingRow
                    icon={<Monitor />}
                    title={t('settings.launchAtLogin')}
                    description={t('settings.launchAtLoginDesc')}
                  >
                    <Switch
                      checked={settings.general.launchAtLogin}
                      onChange={(value) => void persist({ general: { ...settings.general, launchAtLogin: value } }, true)}
                      label={t('settings.launchAtLogin')}
                    />
                  </SettingRow>
                  <SettingRow
                    icon={<Zap />}
                    title={t('settings.startMinimized')}
                    description={t('settings.startMinimizedDesc')}
                  >
                    <Switch
                      checked={settings.general.startMinimized}
                      onChange={(value) => void persist({ general: { ...settings.general, startMinimized: value } }, true)}
                      label={t('settings.startMinimized')}
                    />
                  </SettingRow>
                </SettingsCard>

                <SettingsCard title={t('settings.windowTitle')}>
                  <SettingRow
                    icon={<ExternalLink />}
                    title={t('settings.closeToTray')}
                    description={settings.general.showTrayIcon ? t('settings.closeToTrayDesc') : t('settings.trayDisabledNote')}
                  >
                    <Switch
                      checked={settings.general.closeToTray}
                      disabled={!settings.general.showTrayIcon}
                      onChange={(value) => void persist({ general: { ...settings.general, closeToTray: value } }, true)}
                      label={t('settings.closeToTray')}
                    />
                  </SettingRow>
                  <SettingRow
                    icon={<Info />}
                    title={t('settings.showTray')}
                    description={t('settings.showTrayDesc')}
                  >
                    <Switch
                      checked={settings.general.showTrayIcon}
                      onChange={(value) =>
                        void persist(
                          {
                            general: {
                              ...settings.general,
                              showTrayIcon: value,
                              closeToTray: value ? settings.general.closeToTray : false,
                            },
                          },
                          true,
                        )
                      }
                      label={t('settings.showTray')}
                    />
                  </SettingRow>
                </SettingsCard>

                <SettingsCard title={t('settings.media')}>
                  <SettingRow icon={<Mic />} title={t('settings.microphone')} description={t('settings.microphoneDesc')}>
                    <Switch
                      checked={settings.media.microphone}
                      onChange={(value) => void persist({ media: { ...settings.media, microphone: value } }, true)}
                      label={t('settings.microphone')}
                    />
                  </SettingRow>
                  <SettingRow icon={<Camera />} title={t('settings.camera')} description={t('settings.cameraDesc')}>
                    <Switch
                      checked={settings.media.camera}
                      onChange={(value) => void persist({ media: { ...settings.media, camera: value } }, true)}
                      label={t('settings.camera')}
                    />
                  </SettingRow>
                </SettingsCard>
              </>
            )}

            {/* ---------------- Appearance ---------------- */}
            {section === 'appearance' && (
              <>
                <SettingsCard title={t('settings.appearanceTitle')} description={t('settings.appearanceDesc')}>
                  <div className="py-3.5">
                    <p className="text-[13px] font-medium text-ink">{t('settings.theme')}</p>
                    <p className="mt-0.5 text-[11.5px] text-faint">{t('settings.themeDesc')}</p>
                    <div className="mt-3 grid grid-cols-3 gap-2">
                      {(['system', 'dark', 'light'] as Theme[]).map((value) => {
                        const icons = { system: <Monitor />, dark: <Moon />, light: <Sun /> };
                        return (
                          <button
                            key={value}
                            type="button"
                            onClick={() => void persist({ appearance: { ...settings.appearance, theme: value } })}
                            aria-pressed={settings.appearance.theme === value}
                            className={cn(
                              'interactive-ring flex flex-col items-center gap-2 rounded-[14px] border p-3.5 transition-all',
                              settings.appearance.theme === value
                                ? 'border-[var(--text-tertiary)] bg-[var(--glass-strong)]'
                                : 'border-line bg-[var(--glass)] hover:border-line-strong',
                            )}
                          >
                            <span
                              className={cn(
                                'grid size-8 place-items-center rounded-[10px] border',
                                settings.appearance.theme === value
                                  ? 'border-transparent bg-accent text-accent-ink'
                                  : 'border-line text-soft',
                              )}
                            >
                              {icons[value]}
                            </span>
                            <span className="text-[11.5px] font-medium text-ink">{t(`settings.${value}`)}</span>
                          </button>
                        );
                      })}
                    </div>
                  </div>

                  <div className="flex items-center gap-4 border-t border-[var(--border)] py-3.5">
                    <span className="grid size-8 place-items-center rounded-[10px] border border-line bg-[var(--glass)] text-soft">
                      <Globe2 className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{t('settings.language')}</p>
                      <p className="mt-0.5 text-[11.5px] text-faint">{t('settings.languageDesc')}</p>
                    </div>
                    <Segmented<Language>
                      value={settings.appearance.language}
                      options={[
                        { value: 'id', label: 'ID' },
                        { value: 'en', label: 'EN' },
                      ]}
                      onChange={(value) => void persist({ appearance: { ...settings.appearance, language: value } })}
                      label={t('settings.language')}
                    />
                  </div>

                  <div className="flex items-center gap-4 border-t border-[var(--border)] py-3.5">
                    <span className="grid size-8 place-items-center rounded-[10px] border border-line bg-[var(--glass)] text-soft">
                      <Sparkles className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{t('settings.motion')}</p>
                      <p className="mt-0.5 text-[11.5px] text-faint">{t('settings.motionDesc')}</p>
                    </div>
                    <Segmented<MotionPreference>
                      value={settings.appearance.motion}
                      options={[
                        { value: 'system', label: t('settings.motionSystem') },
                        { value: 'reduce', label: t('settings.motionReduce') },
                        { value: 'full', label: t('settings.motionFull') },
                      ]}
                      onChange={(value) => void persist({ appearance: { ...settings.appearance, motion: value } })}
                      label={t('settings.motion')}
                    />
                  </div>

                  <div className="flex items-center gap-4 border-t border-[var(--border)] py-3.5">
                    <span className="grid size-8 place-items-center rounded-[10px] border border-line bg-[var(--glass)] text-soft">
                      <SlidersHorizontal className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{t('settings.density')}</p>
                      <p className="mt-0.5 text-[11.5px] text-faint">{t('settings.densityDesc')}</p>
                    </div>
                    <Segmented<Density>
                      value={settings.appearance.density}
                      options={[
                        { value: 'comfortable', label: t('settings.comfortable') },
                        { value: 'compact', label: t('settings.compact') },
                      ]}
                      onChange={(value) => void persist({ appearance: { ...settings.appearance, density: value } })}
                      label={t('settings.density')}
                    />
                  </div>
                </SettingsCard>

                <SettingsCard title={t('settings.preview')} description={t('settings.previewNote')}>
                  <div className="py-2">
                    <div className="relative overflow-hidden rounded-[18px] border border-[var(--border-strong)] bg-[var(--bg-base)] p-2 shadow-[0_24px_50px_-24px_rgba(0,0,0,0.85)]">
                      {/* Subtle ambient lighting */}
                      <div
                        aria-hidden
                        className="pointer-events-none absolute -top-12 -left-12 size-48 rounded-full bg-[var(--glow-a)] blur-2xl opacity-60"
                      />
                      <div
                        aria-hidden
                        className="pointer-events-none absolute -bottom-12 -right-12 size-48 rounded-full bg-[var(--glow-b)] blur-2xl opacity-40"
                      />

                      {/* Miniature Window Surface */}
                      <div className="relative flex flex-col overflow-hidden rounded-[14px] border border-[var(--border)] bg-[var(--bg-raised)]/90 backdrop-blur-xl">
                        {/* Miniature Titlebar */}
                        <div className="flex h-7.5 shrink-0 items-center gap-2 border-b border-[var(--border)] bg-[var(--glass)] px-2.5">
                          {/* Traffic Lights */}
                          <div className="flex items-center gap-1.5" aria-hidden>
                            <span className="size-2 rounded-full border border-[#e0443e]/40 bg-[#ff5f57] shadow-xs" />
                            <span className="size-2 rounded-full border border-[#d89e24]/40 bg-[#febc2e] shadow-xs" />
                            <span className="size-2 rounded-full border border-[#1aab29]/40 bg-[#28c840] shadow-xs" />
                          </div>

                          <div className="mx-1 h-3 w-px bg-[var(--border)]" />

                          {/* Logo & Breadcrumb */}
                          <div className="flex items-center gap-1.5 text-[10px]">
                            <Logo size={13} withWordmark />
                            <span className="text-faint/40">/</span>
                            <span className="font-medium text-soft">Telegram</span>
                          </div>

                          {/* Miniature Search Box */}
                          <div className="mx-auto hidden items-center gap-1.5 rounded-md border border-[var(--border)] bg-[var(--glass)] px-2 py-0.5 text-[9px] text-faint sm:flex">
                            <Search className="size-2.5" />
                            <span>{t('titlebar.command')}</span>
                            <span className="ml-1 rounded border border-line px-1 text-[8px]">⌘K</span>
                          </div>

                          {/* Utility Indicators */}
                          <div className="ml-auto flex items-center gap-1.5 text-soft">
                            <span className="flex items-center gap-1 rounded-full border border-line bg-[var(--glass)] px-1.5 py-0.5 text-[8px] text-faint">
                              <ShieldCheck className="size-2.5" />
                              <span className="hidden xs:inline">{t('titlebar.secure')}</span>
                            </span>
                            <Bell className="size-2.5 text-faint" />
                          </div>
                        </div>

                        {/* Miniature Body (Sidebar Rail + Service Workspace) */}
                        <div className="flex h-[180px] gap-2 p-2">
                          {/* Miniature Floating Rail (matches real app) */}
                          <div className="flex w-8 shrink-0 flex-col items-center gap-1 rounded-[12px] border border-[var(--border)] bg-[var(--glass)] py-1.5 shadow-[var(--shadow-glass)]">
                            <span className="grid size-5.5 place-items-center rounded-[6px] border border-line bg-[var(--glass)] text-soft">
                              <Home className="size-3" />
                            </span>
                            <div className="my-0.5 h-px w-3 bg-[var(--border)]" />
                            <span className="grid size-5.5 place-items-center rounded-[6px] border border-transparent text-soft">
                              <ServiceIcon kind="whatsapp" size={11} />
                            </span>
                            <span className="relative grid size-5.5 place-items-center rounded-[6px] border border-transparent bg-accent text-accent-ink shadow-xs">
                              <ServiceIcon kind="telegram" size={11} />
                              <span className="absolute -top-0.5 -right-0.5 size-1.5 rounded-full bg-[var(--accent)] ring-1 ring-[var(--bg-base)]" />
                            </span>
                            <span className="grid size-5.5 place-items-center rounded-[6px] border border-transparent text-soft">
                              <ServiceIcon kind="x" size={11} />
                            </span>
                            <span className="grid size-5.5 place-items-center rounded-[6px] border border-line/40 text-faint">
                              <Plus className="size-2.5" />
                            </span>
                          </div>

                          {/* Miniature Workspace */}
                          <div className="flex min-w-0 flex-1 flex-col gap-1.5">
                            {/* Miniature Service Toolbar */}
                            <div className="flex h-6.5 shrink-0 items-center gap-1.5 rounded-[9px] border border-[var(--border)] bg-[var(--glass)] px-2 text-[9px] text-soft shadow-[var(--shadow-glass)]">
                              <ArrowLeft className="size-2.5 text-faint" />
                              <ArrowRight className="size-2.5 text-faint" />
                              <RotateCw className="size-2.5 text-faint" />
                              <div className="mx-0.5 h-2.5 w-px bg-[var(--border)]" />
                              <ServiceIcon kind="telegram" size={10} />
                              <span className="font-medium text-ink">Telegram</span>
                              <span className="text-[8px] text-faint">Air</span>
                              <span className="size-1 rounded-full bg-[var(--success)]" />
                              <div className="ml-auto flex items-center gap-2 text-[8px] text-faint">
                                <Volume2 className="size-2.5" />
                                <span>100%</span>
                                <ExternalLink className="size-2.5" />
                              </div>
                            </div>

                            {/* Miniature Webview Surface with Telegram QR silhouette */}
                            <div className="relative flex flex-1 flex-col items-center justify-center overflow-hidden rounded-[10px] border border-[var(--border)] bg-[var(--glass)]/40 p-2">
                              <div className="flex flex-col items-center text-center">
                                <div className="relative grid size-11 place-items-center rounded-xl border border-line bg-white text-black shadow-xs">
                                  <QrCode className="size-8 text-black" />
                                  <span className="absolute inset-0 flex items-center justify-center">
                                    <span className="grid size-3 place-items-center rounded-full bg-[#24a1de] text-white shadow-xs">
                                      <ServiceIcon kind="telegram" size={6} />
                                    </span>
                                  </span>
                                </div>
                                <p className="mt-1.5 text-[9px] font-semibold text-ink">Log in to Telegram by QR Code</p>
                                <p className="mt-0.5 text-[7.5px] text-faint">Point your phone at this screen to confirm</p>
                                <div className="mt-2 flex items-center gap-1">
                                  <span className="size-1 rounded-full bg-accent" />
                                  <span className="size-1 rounded-full bg-line" />
                                  <span className="size-1 rounded-full bg-line" />
                                </div>
                              </div>
                            </div>
                          </div>
                        </div>
                      </div>
                    </div>
                  </div>
                </SettingsCard>
              </>
            )}

            {/* ---------------- Notifications ---------------- */}
            {section === 'notifications' && (
              <>
                <SettingsCard title={t('settings.notificationsTitle')} description={t('settings.notificationsDesc')}>
                  <SettingRow
                    icon={<BellRing />}
                    title={t('settings.enableNotifications')}
                    description={t('settings.enableNotificationsDesc')}
                  >
                    <Switch
                      checked={settings.notifications.enabled}
                      onChange={(value) => void persist({ notifications: { ...settings.notifications, enabled: value } }, true)}
                      label={t('settings.enableNotifications')}
                    />
                  </SettingRow>
                  <SettingRow
                    icon={<Bell />}
                    title={t('settings.onlyWhenUnfocused')}
                    description={t('settings.onlyWhenUnfocusedDesc')}
                  >
                    <Switch
                      checked={settings.notifications.onlyWhenUnfocused}
                      disabled={!settings.notifications.enabled}
                      onChange={(value) => void persist({ notifications: { ...settings.notifications, onlyWhenUnfocused: value } }, true)}
                      label={t('settings.onlyWhenUnfocused')}
                    />
                  </SettingRow>
                  <SettingRow
                    icon={<Check />}
                    title={t('settings.showBadge')}
                    description={t('settings.showBadgeDesc')}
                  >
                    <Switch
                      checked={settings.notifications.showBadge}
                      disabled={!settings.notifications.enabled}
                      onChange={(value) => void persist({ notifications: { ...settings.notifications, showBadge: value } }, true)}
                      label={t('settings.showBadge')}
                    />
                  </SettingRow>
                  <SettingRow
                    icon={<VolumeX />}
                    title={t('settings.focusMode')}
                    description={t('settings.focusModeDesc')}
                  >
                    <Switch
                      checked={settings.notifications.focusMode}
                      onChange={(value) => void persist({ notifications: { ...settings.notifications, focusMode: value } }, true)}
                      label={t('settings.focusMode')}
                    />
                  </SettingRow>
                </SettingsCard>

                <SettingsCard title={t('settings.testNotification')} description={t('settings.systemNote')}>
                  <div className="flex items-center gap-3 py-3.5">
                    <Button
                      variant="secondary"
                      icon={<Volume2 />}
                      onClick={() => {
                        void bridge
                          .sendTestNotification()
                          .then(() => toast({ tone: 'success', title: t('settings.testSent') }))
                          .catch((error) => toast({ tone: 'error', title: t('errors.generic'), description: String(error) }));
                      }}
                    >
                      {t('settings.test')}
                    </Button>
                  </div>
                </SettingsCard>
              </>
            )}

            {/* ---------------- Services ---------------- */}
            {section === 'services' && (
              <>
                <SettingsCard
                  title={t('settings.servicesTitle')}
                  description={t('settings.servicesDesc')}
                  action={
                    <Button variant="secondary" size="sm" onClick={() => setAddServiceOpen(true)}>
                      {t('settings.addService')}
                    </Button>
                  }
                >
                  {settings.services.length === 0 ? (
                    <div className="flex flex-col items-center justify-center py-8 text-center">
                      <span className="grid size-10 place-items-center rounded-[12px] border border-line bg-[var(--glass)] text-faint">
                        <Zap className="size-4" aria-hidden />
                      </span>
                      <p className="mt-3 text-[12.5px] font-medium text-ink">{t('settings.noServices')}</p>
                      <p className="mt-1 text-[11px] text-faint">{t('settings.noServicesDesc')}</p>
                    </div>
                  ) : (
                    <div className="divide-y divide-[var(--border)]">
                      {settings.services.map((service) => {
                        const definition = catalog.find((entry) => entry.kind === service.kind);
                        return (
                          <div key={service.id} className="py-3.5">
                            <div className="flex items-center gap-3">
                              <span className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-line bg-[var(--glass)] text-ink">
                                <ServiceIcon kind={service.kind} size={17} />
                              </span>
                              <div className="min-w-0 flex-1">
                                <p className="truncate text-[12.5px] font-medium text-ink">{service.label}</p>
                                <p className="mt-0.5 truncate text-[10.5px] text-faint">
                                  {definition?.name ?? service.kind} · {Math.round(service.zoom * 100)}%
                                </p>
                              </div>
                              <IconButton
                                label={service.muted ? t('service.unmute') : t('service.mute')}
                                size="sm"
                                onClick={() => void muteService(service.id, !service.muted)}
                                active={service.muted}
                              >
                                {service.muted ? <VolumeX /> : <Volume2 />}
                              </IconButton>
                              <Button variant="ghost" size="sm" onClick={() => void openService(service.id)}>
                                {t('settings.openService')}
                              </Button>
                              <IconButton
                                label={t('settings.removeService')}
                                size="sm"
                                onClick={() => setRemovingServiceId(service.id)}
                              >
                                <Trash2 />
                              </IconButton>
                            </div>
                            <div className="mt-2.5 flex flex-wrap items-center gap-3 pl-12">
                              <span className="text-[10.5px] text-faint">{t('settings.serviceZoomDesc')}</span>
                              <div className="inline-flex rounded-[9px] border border-line bg-[var(--glass)] p-[2px]">
                                {[0.75, 0.9, 1, 1.1, 1.25, 1.5].map((level) => (
                                  <button
                                    key={level}
                                    type="button"
                                    onClick={() => void zoomService(service.id, level)}
                                    aria-pressed={service.zoom === level}
                                    className={cn(
                                      'h-6 rounded-[7px] px-2 text-[10px] font-medium transition-colors',
                                      service.zoom === level ? 'bg-accent text-accent-ink' : 'text-soft hover:text-ink',
                                    )}
                                  >
                                    {Math.round(level * 100)}%
                                  </button>
                                ))}
                              </div>
                              <Button
                                variant="ghost"
                                size="sm"
                                onClick={() => {
                                  void clearServiceData(service.id).then(() =>
                                    toast({ tone: 'success', title: t('service.cleared', { name: service.label }) }),
                                  );
                                }}
                              >
                                {t('settings.clearSession')}
                              </Button>
                            </div>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </SettingsCard>
                <div className="flex items-start gap-2 rounded-[14px] border border-line bg-[var(--glass)] p-3.5">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-soft" aria-hidden />
                  <p className="text-[10.5px] leading-relaxed text-faint">{t('settings.isolationNote')}</p>
                </div>
                <p className="text-[10px] text-faint">{t('settings.maxServices', { count: 16 })}</p>
              </>
            )}

            {/* ---------------- Security ---------------- */}
            {section === 'security' && (
              <>
                <SettingsCard
                  title={t('settings.securityTitle')}
                  description={t('settings.securityDesc')}
                  action={
                    <span
                      className={cn(
                        'inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[10px]',
                        security?.lockEnabled
                          ? 'border-transparent bg-accent text-accent-ink'
                          : 'border-dashed border-line text-faint',
                      )}
                    >
                      <LockKeyhole className="size-3" aria-hidden />
                      {security?.lockEnabled ? t('settings.lockEnabled') : t('settings.lockDisabled')}
                    </span>
                  }
                >
                  <div className="py-3.5">
                    <p className="text-[13px] font-medium text-ink">
                      {security?.lockEnabled ? t('settings.lockEnabledDesc') : t('settings.lockDisabledDesc')}
                    </p>
                    <div className="mt-3 flex flex-wrap gap-2">
                      {security?.lockEnabled ? (
                        <>
                          <Button variant="secondary" size="sm" icon={<LockKeyhole />} onClick={() => void bridge.lockApp()}>
                            {t('settings.lockNow')}
                          </Button>
                          <Button variant="secondary" size="sm" icon={<KeyRound />} onClick={() => setSecurityDialog('change-pin')}>
                            {t('settings.changePin')}
                          </Button>
                          <Button variant="danger" size="sm" onClick={() => setSecurityDialog('disable')}>
                            {t('settings.disableLock')}
                          </Button>
                        </>
                      ) : (
                        <Button variant="primary" size="sm" icon={<LockKeyhole />} onClick={() => setSecurityDialog('enable')}>
                          {t('settings.enableLock')}
                        </Button>
                      )}
                    </div>
                  </div>

                  {security?.lockEnabled && (
                    <div className="border-t border-[var(--border)] py-3.5">
                      <p className="text-[13px] font-medium text-ink">{t('settings.recovery')}</p>
                      <p className="mt-0.5 text-[11.5px] text-faint">{t('settings.recoveryDesc')}</p>
                      <Button
                        variant="secondary"
                        size="sm"
                        className="mt-2.5"
                        icon={<RotateCcw />}
                        onClick={() => setSecurityDialog('regenerate')}
                      >
                        {t('settings.regenerateRecovery')}
                      </Button>
                    </div>
                  )}

                  {security?.lockEnabled && (
                    <>
                      <div className="flex items-center gap-4 border-t border-[var(--border)] py-3.5">
                        <div className="min-w-0 flex-1">
                          <p className="text-[13px] font-medium text-ink">{t('settings.autoLock')}</p>
                          <p className="mt-0.5 text-[11.5px] text-faint">{t('settings.autoLockDesc')}</p>
                        </div>
                        <Select
                          value={String(settings.security.autoLockMinutes)}
                          options={AUTO_LOCK_OPTIONS}
                          onChange={(event) =>
                            void persist({
                              security: {
                                autoLockMinutes: Number(event.target.value),
                                lockOnFocusLoss: settings.security.lockOnFocusLoss,
                                protectScreenCapture: settings.security.protectScreenCapture,
                              },
                            })
                          }
                          aria-label={t('settings.autoLock')}
                        />
                      </div>
                      <SettingRow
                        icon={<ExternalLink />}
                        title={t('settings.focusLoss')}
                        description={t('settings.focusLossDesc')}
                      >
                        <Switch
                          checked={settings.security.lockOnFocusLoss}
                          onChange={(value) =>
                            void persist({
                              security: {
                                autoLockMinutes: settings.security.autoLockMinutes,
                                lockOnFocusLoss: value,
                                protectScreenCapture: settings.security.protectScreenCapture,
                              },
                            })
                          }
                          label={t('settings.focusLoss')}
                        />
                      </SettingRow>
                      <SettingRow
                        icon={<Camera />}
                        title={t('settings.screenProtection')}
                        description={t('settings.screenProtectionDesc')}
                      >
                        <Switch
                          checked={settings.security.protectScreenCapture}
                          onChange={(value) =>
                            void persist({
                              security: {
                                autoLockMinutes: settings.security.autoLockMinutes,
                                lockOnFocusLoss: settings.security.lockOnFocusLoss,
                                protectScreenCapture: value,
                              },
                            })
                          }
                          label={t('settings.screenProtection')}
                        />
                      </SettingRow>
                    </>
                  )}
                </SettingsCard>

                <div className="flex items-start gap-2 rounded-[14px] border border-line bg-[var(--glass)] p-3.5">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-soft" aria-hidden />
                  <p className="text-[10.5px] leading-relaxed text-faint">{t('settings.keychainNote')}</p>
                </div>
              </>
            )}

            {/* ---------------- Updates ---------------- */}
            {section === 'updates' && (
              <>
                <SettingsCard title={t('settings.updatesTitle')} description={t('settings.updatesDesc')}>
                  <div className="flex items-center gap-4 py-3.5">
                    <span className="grid size-10 place-items-center rounded-[13px] border border-line bg-[var(--glass)] text-ink">
                      <CloudDownload className="size-5" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{t('settings.currentVersion')}</p>
                      <p className="mono mt-0.5 text-[11.5px] text-faint">{app?.version ?? '0.1.0'}</p>
                    </div>
                    <Button
                      variant="secondary"
                      icon={<RotateCcw />}
                      loading={updateState === 'checking'}
                      onClick={() => void checkForUpdate()}
                    >
                      {updateState === 'checking' ? t('settings.checking') : t('settings.checkNow')}
                    </Button>
                  </div>

                  {updateState === 'upToDate' && (
                    <p className="border-t border-[var(--border)] py-3.5 text-[12px] text-soft">{t('settings.upToDate')}</p>
                  )}

                  {updateState === 'available' && updateInfo && (
                    <div className="border-t border-[var(--border)] py-3.5">
                      <p className="text-[13px] font-medium text-ink">
                        {t('settings.updateAvailable', { version: updateInfo.version })}
                      </p>
                      <p className="mt-0.5 text-[11.5px] text-faint">{t('settings.updateAvailableDesc')}</p>
                      {updateInfo.notes && (
                        <details className="mt-2.5 rounded-[12px] border border-line bg-[var(--glass)] p-3">
                          <summary className="cursor-pointer text-[11px] text-faint">{t('settings.releaseNotes')}</summary>
                          <pre className="mt-2 max-h-32 overflow-auto whitespace-pre-wrap font-mono text-[10px] leading-relaxed text-soft">
                            {updateInfo.notes}
                          </pre>
                        </details>
                      )}
                      <Button variant="primary" size="sm" className="mt-3" icon={<Download />} onClick={() => void installUpdate()}>
                        {t('settings.installUpdate')}
                      </Button>
                    </div>
                  )}

                  {updateState === 'downloading' && (
                    <div className="border-t border-[var(--border)] py-3.5">
                      <p className="text-[13px] font-medium text-ink">{t('settings.downloading')}</p>
                      <p className="mt-0.5 text-[11.5px] text-faint">
                        {percent !== null ? t('settings.downloadingDesc', { percent }) : t('settings.unknownSize')}
                      </p>
                      <div className="mt-2.5 h-1.5 overflow-hidden rounded-full bg-[var(--glass)]">
                        <div
                          className="h-full rounded-full bg-accent transition-all duration-300"
                          style={{ width: `${percent ?? 30}%` }}
                        />
                      </div>
                    </div>
                  )}

                  {updateState === 'error' && (
                    <p className="border-t border-[var(--border)] py-3.5 text-[12px] text-danger">{t('settings.updateError')}</p>
                  )}
                </SettingsCard>

                <div className="rounded-[var(--radius-lg)] border border-[var(--border)] bg-[var(--glass)] shadow-[var(--shadow-glass)] px-3.5">
                  <SettingRow
                    title={t('settings.autoCheck')}
                    description={t('settings.autoCheckDesc')}
                  >
                    <Switch
                      checked={settings.updates.autoCheck}
                      onChange={(value) => void persist({ updates: { autoCheck: value } }, true)}
                      label={t('settings.autoCheck')}
                    />
                  </SettingRow>
                </div>

                <div className="flex items-start gap-2 rounded-[14px] border border-line bg-[var(--glass)] p-3.5">
                  <ShieldCheck className="mt-0.5 size-3.5 shrink-0 text-soft" aria-hidden />
                  <p className="text-[10.5px] leading-relaxed text-faint">{t('settings.signatureNote')}</p>
                </div>
                {app?.isDev && <p className="text-[10px] text-faint">{t('settings.devNotice')}</p>}
              </>
            )}

            {/* ---------------- Advanced ---------------- */}
            {section === 'advanced' && (
              <>
                <SettingsCard title={t('settings.advancedTitle')} description={t('settings.advancedDesc')}>
                  <div className="flex items-center gap-4 py-3.5">
                    <span className="grid size-8 place-items-center rounded-[10px] border border-line bg-[var(--glass)] text-soft">
                      <ScrollText className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[13px] font-medium text-ink">{t('settings.logLevel')}</p>
                      <p className="mt-0.5 text-[11.5px] text-faint">{t('settings.logLevelDesc')}</p>
                    </div>
                    <Select
                      value={settings.advanced.logLevel}
                      options={[
                        { value: 'error', label: t('settings.logError') },
                        { value: 'warn', label: t('settings.logWarn') },
                        { value: 'info', label: t('settings.logInfo') },
                        { value: 'debug', label: t('settings.logDebug') },
                      ]}
                      onChange={(event) => void persist({ advanced: { logLevel: event.target.value as LogLevel } })}
                      aria-label={t('settings.logLevel')}
                    />
                  </div>

                  <div className="flex flex-wrap items-center gap-2 border-t border-[var(--border)] py-3.5">
                    <Button variant="secondary" size="sm" icon={<FolderOpen />} onClick={() => void bridge.openFolder('logs')}>
                      {t('settings.openLogs')}
                    </Button>
                    <Button variant="secondary" size="sm" icon={<FolderOpen />} onClick={() => void bridge.openFolder('config')}>
                      {t('settings.openConfig')}
                    </Button>
                    <Button
                      variant="secondary"
                      size="sm"
                      icon={<Download />}
                      onClick={() => {
                        void bridge
                          .exportDiagnostics()
                          .then((result) => toast({ tone: 'success', title: t('settings.exported', { path: result.path }) }))
                          .catch((error) => toast({ tone: 'error', title: t('errors.generic'), description: String(error) }));
                      }}
                    >
                      {t('settings.export')}
                    </Button>
                  </div>
                </SettingsCard>

                <SettingsCard title={t('settings.resetPreferences')} description={t('settings.resetPreferencesDesc')}>
                  <div className="flex items-center gap-3 py-3.5">
                    <Button variant="danger" size="sm" icon={<Trash2 />} onClick={() => setConfirmReset(true)}>
                      {t('common.reset')}
                    </Button>
                  </div>
                </SettingsCard>
              </>
            )}

            {/* ---------------- About ---------------- */}
            {section === 'about' && (
              <>
                <div className="flex flex-col items-center rounded-[20px] border border-[var(--border)] bg-[var(--glass)] shadow-[var(--shadow-glass)] p-8 text-center">
                  <Logo size={52} />
                  <h2 className="mt-4 text-[20px] font-semibold tracking-[-0.04em] text-ink">Mesvee</h2>
                  <p className="mt-1 max-w-[320px] text-pretty text-[12px] leading-relaxed text-soft">
                    {t('settings.aboutDesc')}
                  </p>
                  <div className="mono mt-4 flex flex-wrap items-center justify-center gap-2 text-[10px] text-faint">
                    <span>{t('settings.versionLabel', { version: app?.version ?? '0.1.0' })}</span>
                    <span aria-hidden>·</span>
                    <span>
                      {t('settings.platformLabel', {
                        platform: app?.platform ?? 'unknown',
                        arch: app?.arch ?? 'unknown',
                      })}
                    </span>
                  </div>
                </div>

                <SettingsCard divided={false}>
                  <SettingRow icon={<Code2 />} title={t('settings.builtWith')} description="Tauri 2 · Rust · React · TypeScript" />
                  <SettingRow icon={<Info />} title={t('settings.license')} description={t('settings.legal')} />
                  <SettingRow icon={<ShieldCheck />} title={t('settings.madeWith')} description={t('settings.copyright')} />
                </SettingsCard>
              </>
            )}
          </div>
        </div>
      </div>
    </div>

      {securityDialog && <SecurityDialog kind={securityDialog} open onClose={() => setSecurityDialog(null)} />}

      {removingServiceId && (
        <RemoveServiceConfirm
          onCancel={() => setRemovingServiceId(null)}
          onConfirm={async (clearData) => {
            const service = settings.services.find((item) => item.id === removingServiceId);
            setRemovingServiceId(null);
            try {
              await removeService(removingServiceId, clearData);
              toast({ tone: 'success', title: t('toasts.serviceRemoved', { name: service?.label ?? '' }) });
            } catch (error) {
              toast({ tone: 'error', title: t('errors.generic'), description: String(error) });
            }
          }}
        />
      )}

      {confirmReset && (
        <ConfirmPanel
          title={t('settings.resetConfirm')}
          onCancel={() => setConfirmReset(false)}
          onConfirm={async () => {
            setConfirmReset(false);
            try {
              await resetPreferences();
              toast({ tone: 'success', title: t('settings.resetDone') });
            } catch (error) {
              toast({ tone: 'error', title: t('errors.generic'), description: String(error) });
            }
          }}
        />
      )}
    </div>
  );
}

/** Confirmation panel for removing a service account. */
function RemoveServiceConfirm({
  onCancel,
  onConfirm,
}: {
  onCancel: () => void;
  onConfirm: (clearData: boolean) => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 grid place-items-center p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div role="alertdialog" aria-modal="true" className="glass-strong enter-scale w-full max-w-[400px] rounded-[22px] p-6">
        <p className="text-[15px] font-semibold tracking-[-0.03em] text-ink">{t('settings.removeService')}</p>
        <p className="mt-2 text-pretty text-[12px] leading-relaxed text-soft">{t('settings.removeServiceDesc')}</p>
        <div className="mt-6 space-y-2">
          <Button
            variant="primary"
            className="w-full"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm(false).finally(() => setBusy(false));
            }}
          >
            {t('service.keepData')}
          </Button>
          <Button
            variant="danger"
            className="w-full"
            onClick={() => {
              setBusy(true);
              void onConfirm(true).finally(() => setBusy(false));
            }}
          >
            {t('service.eraseData')}
          </Button>
          <Button variant="ghost" className="w-full" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/** Generic confirmation panel used for preference resets. */
function ConfirmPanel({
  title,
  onCancel,
  onConfirm,
}: {
  title: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <div
      className="modal-backdrop fixed inset-0 z-50 grid place-items-center p-6"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onCancel();
      }}
    >
      <div role="alertdialog" aria-modal="true" className="glass-strong enter-scale w-full max-w-[380px] rounded-[22px] p-6">
        <p className="text-[15px] font-semibold tracking-[-0.03em] text-ink">{title}</p>
        <div className="mt-6 flex justify-end gap-2">
          <Button variant="ghost" onClick={onCancel}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="danger"
            loading={busy}
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
          >
            {t('common.confirm')}
          </Button>
        </div>
      </div>
    </div>
  );
}

/**
 * Ambient orbital animation in the right-side background of the settings panel.
 * Mirrors the signature celestial motif from the dashboard and lockscreen to
 * gracefully fill widescreen negative space without interrupting form interactions.
 */
const SettingsAmbientVisual = memo(function SettingsAmbientVisual() {
  return (
    <div
      aria-hidden
      className="pointer-events-none absolute inset-0 overflow-hidden select-none"
    >
      {/* Subtle dot-grid texture on the right half with smooth horizontal gradient mask */}
      <div className="dot-grid absolute top-0 right-0 h-full w-[65%] opacity-25 [mask-image:linear-gradient(to_left,black,transparent)]" />

      {/* Atmospheric radial glows */}
      <div className="absolute -top-24 -right-24 size-[520px] rounded-full bg-[radial-gradient(circle,var(--glow-a)_0%,transparent_70%)] opacity-70 blur-3xl" />
      <div className="absolute -bottom-28 right-8 size-[460px] rounded-full bg-[radial-gradient(circle,var(--glow-b)_0%,transparent_70%)] opacity-50 blur-2xl" />

      {/* Concentric orbital rings centered in the right zone */}
      <div className="absolute top-1/2 -right-24 size-[660px] -translate-y-1/2 rounded-full border border-[var(--border)] opacity-35 xl:right-16" />
      <div className="absolute top-1/2 -right-24 size-[480px] -translate-y-1/2 rounded-full border border-[var(--border)] opacity-50 xl:right-16" />
      <div className="absolute top-1/2 -right-24 size-[320px] -translate-y-1/2 rounded-full border border-[var(--border-strong)] opacity-40 xl:right-16" />

      {/* Outer forward orbit with luminous particle */}
      <div className="orbit absolute top-1/2 -right-24 size-[660px] -translate-y-1/2 rounded-full xl:right-16">
        <span className="absolute top-[9%] left-[22%] size-1.5 rounded-full bg-[var(--text-tertiary)] shadow-[0_0_8px_var(--text-tertiary)]" />
        <span className="absolute bottom-[13%] right-[24%] size-1 rounded-full bg-[var(--text-tertiary)]" />
      </div>

      {/* Middle reverse orbit with accent particle */}
      <div className="orbit-reverse absolute top-1/2 -right-24 size-[480px] -translate-y-1/2 rounded-full xl:right-16">
        <span className="absolute top-[17%] right-[14%] size-1.5 rounded-full bg-accent opacity-75 shadow-[0_0_8px_var(--accent)]" />
        <span className="absolute bottom-[21%] left-[18%] size-1 rounded-full bg-[var(--text-tertiary)]" />
      </div>

      {/* Center floating glass orb / emblem in the orbit eye on wide screens */}
      <div className="hidden 2xl:flex absolute top-1/2 -right-24 size-[116px] -translate-y-1/2 -translate-x-1/2 items-center justify-center xl:right-16">
        <div className="pulse-soft absolute inset-0 rounded-full border border-[var(--border)] opacity-50" />
        <div className="glass-strong relative flex size-[92px] items-center justify-center rounded-full border border-[var(--border)] shadow-[0_24px_50px_-20px_rgba(0,0,0,0.8)] backdrop-blur-xl">
          <Logo size={24} />
        </div>
      </div>
    </div>
  );
});
