import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  BellOff,
  BellRing,
  CloudDownload,
  Maximize2,
  Minus,
  Search,
  ShieldCheck,
  Square,
  X,
} from 'lucide-react';
import { useAppStore } from '../core/store';
import { Kbd } from '../ui/Form';
import { IconButton } from '../ui/Button';
import { Logo } from '../ui/Logo';
import { cn } from '../lib/cn';
import type { Platform } from '../lib/platform';

/** Props for the custom titlebar. */
export interface TitlebarProps {
  platform: Platform;
  onOpenPalette: () => void;
}

/**
 * Frameless custom title bar.
 *
 * The window is created with `decorations: false`, so the operating system
 * paints **no** controls at all. Every platform therefore gets its own control
 * cluster here, vertically centred with the breadcrumb and the search field:
 * macOS keeps its traffic lights on the left, Windows/Linux keep the caption
 * buttons on the right.
 */
export function Titlebar({ platform, onOpenPalette }: TitlebarProps) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const security = useAppStore((state) => state.security);
  const updateInfo = useAppStore((state) => state.updateInfo);
  const openSettings = useAppStore((state) => state.openSettings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const toast = useAppStore((state) => state.toast);
  const goHome = useAppStore((state) => state.goHome);
  const bridge = useAppStore((state) => state.bridge);

  const [maximized, setMaximized] = useState(false);
  const [busy, setBusy] = useState(false);

  const isMac = platform === 'macos';
  const focusMode = settings?.notifications.focusMode ?? false;

  /** Keeps the maximize glyph in sync when the OS resizes the window. */
  useEffect(() => {
    if (isMac) return undefined;
    const sync = () => {
      void bridge
        .isMaximized()
        .then(setMaximized)
        .catch(() => undefined);
    };
    sync();
    window.addEventListener('resize', sync);
    return () => window.removeEventListener('resize', sync);
  }, [bridge, isMac]);

  /** Toggles the native maximized state and mirrors it locally. */
  const toggleMaximize = async () => {
    if (busy) return;
    setBusy(true);
    try {
      setMaximized(await bridge.toggleMaximize());
    } catch (error) {
      void bridge.log('warn', 'window toggle failed', String(error)).catch(() => undefined);
    } finally {
      setBusy(false);
    }
  };

  /** Toggles focus mode immediately without opening Settings. */
  const toggleFocus = async () => {
    if (!settings) return;
    try {
      await saveSettings({
        notifications: { ...settings.notifications, focusMode: !focusMode },
      });
      toast({
        tone: 'info',
        title: focusMode ? t('home.focusOff') : t('home.focusOn'),
      });
    } catch (error) {
      toast({ tone: 'error', title: t('toasts.storageError'), description: String(error) });
    }
  };

  const controls = {
    minimize: () => void bridge.minimizeWindow(),
    maximize: () => void toggleMaximize(),
    close: () => void bridge.closeWindow(),
  };

  return (
    <header
      className={cn(
        'titlebar-surface relative z-30 flex h-[var(--titlebar-height)] shrink-0 items-center gap-2 pr-2',
        isMac ? 'pl-0' : 'pl-3',
      )}
    >
      {/* Drag layer stays behind interactive controls on purpose.
          On macOS, we leave the native traffic light zone free so clicks hit buttons directly. */}
      <div
        data-tauri-drag-region
        className={cn('absolute inset-0', isMac ? 'left-[84px]' : 'left-0')}
        onDoubleClick={() => void toggleMaximize()}
      />

      {/* Spacer reserving the native macOS traffic lights area (x: 18, y: 16, width: ~54px).
          Pointer events none ensures any pass-through reaches the native buttons directly. */}
      {isMac && <div className="w-[84px] shrink-0 pointer-events-none" aria-hidden />}

      <div className="relative z-10 flex min-w-0 flex-1 items-center gap-2.5">
        <button
          type="button"
          onClick={goHome}
          aria-label={t('titlebar.home')}
          className="interactive-ring flex h-7 items-center gap-2 rounded-lg px-1 text-ink hover:bg-[var(--glass)]"
        >
          <Logo size={21} withWordmark />
        </button>
      </div>

      <button
        type="button"
        onClick={onOpenPalette}
        className={cn(
          'interactive-ring glass relative z-10 hidden h-7 w-[310px] shrink-0 items-center gap-2 rounded-[9px] px-2.5 text-left',
          'text-[11.5px] text-faint hover:border-line-strong hover:text-soft sm:flex',
        )}
      >
        <Search className="size-3.5 shrink-0" aria-hidden />
        <span className="min-w-0 flex-1 truncate">{t('titlebar.command')}</span>
        <Kbd>{platform === 'macos' ? '⌘' : 'Ctrl'}</Kbd>
        <Kbd>K</Kbd>
      </button>

      <div className="relative z-10 flex min-w-0 flex-1 items-center justify-end gap-1">
        {security?.lockEnabled && (
          <span className="mr-1 hidden items-center px-2 py-[3px] text-[10px] text-faint lg:flex">
            <ShieldCheck className="size-4.5" aria-hidden />
          </span>
        )}
        <IconButton
          label={focusMode ? t('titlebar.focusOn') : t('titlebar.focusOff')}
          onClick={() => void toggleFocus()}
          active={focusMode}
        >
          {focusMode ? <BellOff /> : <BellRing />}
        </IconButton>
        <IconButton
          label={t('settings.updates')}
          onClick={() => openSettings('updates')}
          className="relative"
        >
          <CloudDownload />
          {updateInfo && (
            <span
              aria-hidden
              className="absolute top-1.5 right-1.5 size-1.5 rounded-full bg-accent ring-2 ring-[var(--bg-base)]"
            />
          )}
        </IconButton>

        {!isMac && (
          <WindowsWindowControls
            maximized={maximized}
            onMinimize={controls.minimize}
            onMaximize={controls.maximize}
            onClose={controls.close}
            labels={{
              minimize: t('titlebar.minimize'),
              maximize: maximized ? t('titlebar.restore') : t('titlebar.maximize'),
              close: t('titlebar.close'),
            }}
          />
        )}
      </div>
    </header>
  );
}

/**
 * macOS traffic lights, drawn to Apple's own metrics: 12px circles, 8px apart,
 * 20px from the window edge, solid system colours with the glyph revealed only
 * while hovered. The window is frameless, so these stand in for the real ones.
 */
/** Windows/Linux caption buttons: square, right aligned, close turns red. */
function WindowsWindowControls({
  maximized,
  onMinimize,
  onMaximize,
  onClose,
  labels,
}: {
  maximized: boolean;
  onMinimize: () => void;
  onMaximize: () => void;
  onClose: () => void;
  labels: { minimize: string; maximize: string; close: string };
}) {
  return (
    <div className="ml-1 flex items-center gap-0.5" data-no-drag>
      <button
        type="button"
        aria-label={labels.minimize}
        title={labels.minimize}
        onClick={onMinimize}
        className="interactive-ring grid size-7 place-items-center rounded-md text-soft hover:bg-[var(--glass-hover)] hover:text-ink"
      >
        <Minus className="size-3.5" aria-hidden />
      </button>
      <button
        type="button"
        aria-label={labels.maximize}
        title={labels.maximize}
        onClick={onMaximize}
        className="interactive-ring grid size-7 place-items-center rounded-md text-soft hover:bg-[var(--glass-hover)] hover:text-ink"
      >
        {maximized ? (
          <Square className="size-3" aria-hidden />
        ) : (
          <Maximize2 className="size-3.5" aria-hidden />
        )}
      </button>
      <button
        type="button"
        aria-label={labels.close}
        title={labels.close}
        onClick={onClose}
        className="interactive-ring grid size-7 place-items-center rounded-md text-soft hover:bg-[#c42b1c] hover:text-white"
      >
        <X className="size-3.5" aria-hidden />
      </button>
    </div>
  );
}
