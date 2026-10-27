import { useEffect } from 'react';
import { useTranslation } from 'react-i18next';
import { AlertTriangle, RotateCcw } from 'lucide-react';
import { useAppStore } from './core/store';
import { setLanguage } from './core/i18n';
import { applyInterfacePreferences, applyTheme, watchSystemTheme } from './lib/appearance';
import { detectPlatform } from './lib/platform';
import { Button } from './ui/Button';
import { Logo } from './ui/Logo';
import { ToastViewport } from './ui/Toasts';
import { Spinner } from './ui/Controls';
import { Titlebar } from './app/Titlebar';
import { Rail } from './app/Rail';
import { HomeScreen } from './features/home/HomeScreen';
import { ServiceScreen } from './features/service/ServiceScreen';
import { SettingsScreen } from './features/settings/SettingsScreen';
import { Onboarding } from './features/onboarding/Onboarding';
import { LockScreen } from './features/lock/LockScreen';
import { CommandPalette } from './features/palette/CommandPalette';
import { AddServiceDialog } from './features/services/AddServiceDialog';

/**
 * Application root: boots the native bridge, projects appearance settings onto
 * the document, and composes the shell, overlays and global dialogs.
 */
export function App() {
  const { t } = useTranslation();
  const booted = useAppStore((state) => state.booted);
  const bootError = useAppStore((state) => state.bootError);
  const settings = useAppStore((state) => state.settings);
  const security = useAppStore((state) => state.security);
  const route = useAppStore((state) => state.route);
  const paletteOpen = useAppStore((state) => state.paletteOpen);
  const setPaletteOpen = useAppStore((state) => state.setPaletteOpen);
  const init = useAppStore((state) => state.init);
  const retryBootstrap = useAppStore((state) => state.retryBootstrap);

  /** Boots once on mount. */
  useEffect(() => {
    void init();
  }, [init]);

  /** Projects persisted appearance values onto <html> whenever they change. */
  useEffect(() => {
    if (!settings) return undefined;
    applyTheme(settings.appearance.theme);
    applyInterfacePreferences(settings.appearance.motion, settings.appearance.density);
    void setLanguage(settings.appearance.language);
    if (settings.appearance.theme !== 'system') return undefined;
    // Keep "system" mode live when the OS switches palette.
    return watchSystemTheme(() => applyTheme('system'));
  }, [settings]);

  /** Global keyboard shortcut for the command palette. */
  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      const mod = event.metaKey || event.ctrlKey;
      if (mod && event.key.toLowerCase() === 'k') {
        event.preventDefault();
        setPaletteOpen(!useAppStore.getState().paletteOpen);
      }
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [setPaletteOpen]);

  /** First paint while the backend loads state. */
  if (!booted) {
    return (
      <div className="app-canvas grid h-full place-items-center">
        <div className="flex flex-col items-center gap-5">
          <Logo size={44} />
          <Spinner size={20} label={t('startup.preparing')} />
          <p className="text-[12px] text-faint">{t('startup.preparing')}</p>
        </div>
      </div>
    );
  }

  /** Boot failure gives the user a retry instead of a dead window. */
  if (bootError) {
    return (
      <div className="app-canvas grid h-full place-items-center p-6">
        <div className="glass-strong enter-rise w-full max-w-[440px] rounded-[24px] p-7 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-line bg-[var(--glass)] text-danger">
            <AlertTriangle className="size-5" aria-hidden />
          </span>
          <h1 className="mt-4 text-[18px] font-semibold tracking-[-0.03em] text-ink">
            {t('errors.bootTitle')}
          </h1>
          <p className="mt-2 text-pretty text-[12.5px] leading-relaxed text-soft">
            {t('errors.bootDesc')}
          </p>
          <p className="mt-3 break-words rounded-xl border border-line bg-[var(--glass)] p-3 font-mono text-[10px] text-faint">
            {bootError}
          </p>
          <Button variant="primary" className="mt-5" icon={<RotateCcw />} onClick={() => void retryBootstrap()}>
            {t('common.retry')}
          </Button>
        </div>
      </div>
    );
  }

  /** First-run experience takes over the entire window. */
  if (settings && !settings.onboarded) {
    return (
      <>
        <Onboarding />
        <ToastViewport />
      </>
    );
  }

  const platform = detectPlatform();

  return (
    <div className="app-canvas flex h-full flex-col">
      <Titlebar platform={platform} onOpenPalette={() => setPaletteOpen(true)} />

      <div className="relative flex min-h-0 flex-1">
        <Rail />
        <main className="relative min-w-0 flex-1 overflow-hidden">
          <div key={route} className="enter-fade h-full">
            {route === 'home' && <HomeScreen onOpenPalette={() => setPaletteOpen(true)} />}
            {route === 'service' && <ServiceScreen />}
            {route === 'settings' && <SettingsScreen />}
          </div>
        </main>
      </div>

      <CommandPalette open={paletteOpen} onClose={() => setPaletteOpen(false)} />
      <AddServiceDialog />
      <ToastViewport />

      {/* Rust sets isLocked; this overlay hides the whole shell. */}
      {security?.isLocked && <LockScreen />}
    </div>
  );
}
