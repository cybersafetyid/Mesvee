import { useEffect, useRef, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  AlertTriangle,
  ArrowLeft,
  ArrowRight,
  ExternalLink,
  House,
  MoreHorizontal,
  RotateCw,
  Trash2,
  Volume2,
  VolumeX,
  X,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { Equalizer, Spinner } from '../../ui/Controls';
import { Button, IconButton } from '../../ui/Button';
import { Modal } from '../../ui/Modal';
import { ServiceIcon } from '../../ui/ServiceIcon';
import { cn } from '../../lib/cn';

/** Zoom steps offered in the toolbar tray (mirrors the Rust validation range). */
const ZOOM_LEVELS = [0.75, 0.9, 1, 1.1, 1.25, 1.5] as const;

/**
 * Service workspace. It reserves a rectangular region of the window; Rust
 * positions the isolated native webview exactly over that region. All
 * privileged navigation and session operations go through guarded commands.
 */
export function ServiceScreen() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const catalog = useAppStore((state) => state.catalog);
  const serviceStates = useAppStore((state) => state.serviceStates);
  const bridge = useAppStore((state) => state.bridge);
  const toast = useAppStore((state) => state.toast);
  const muteService = useAppStore((state) => state.muteService);
  const zoomService = useAppStore((state) => state.zoomService);
  const removeService = useAppStore((state) => state.removeService);
  const isLocked = useAppStore((state) => state.security?.isLocked ?? false);
  const addServiceOpen = useAppStore((state) => state.addServiceOpen);
  const paletteOpen = useAppStore((state) => state.paletteOpen);

  const surfaceRef = useRef<HTMLDivElement>(null);
  /** Inline action tray; it expands the toolbar instead of covering the page. */
  const [tray, setTray] = useState<'actions' | 'zoom' | null>(null);
  const [confirming, setConfirming] = useState<'remove' | 'clear' | null>(null);
  const [syncError, setSyncError] = useState<string | null>(null);
  /** Bumped after clearing session data so the native view is recreated. */
  const [sessionEpoch, setSessionEpoch] = useState(0);

  const activeService = settings?.services.find(
    (service) => service.id === settings.activeServiceId,
  );
  const runtime = activeService ? serviceStates[activeService.id] : undefined;

  /**
   * Only modal dialogs and overlays need the native surface hidden. Menus never do:
   * the action tray grows the toolbar, which pushes (and resizes) the webview, so the
   * page stays visible instead of flashing to an empty black rectangle.
   */
  const overlayOpen = confirming !== null || addServiceOpen || paletteOpen;

  /** Escape collapses the tray; clicks outside the tray/toolbar dismiss it too. */
  useEffect(() => {
    if (!tray) return undefined;
    const close = () => setTray(null);
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault();
      close();
    };
    const handlePointerDown = (event: PointerEvent) => {
      const target = event.target as HTMLElement | null;
      if (target?.closest('[data-service-tray-host]')) return;
      close();
    };
    document.addEventListener('keydown', handleKeyDown);
    document.addEventListener('pointerdown', handlePointerDown, true);
    return () => {
      document.removeEventListener('keydown', handleKeyDown);
      document.removeEventListener('pointerdown', handlePointerDown, true);
    };
  }, [tray]);

  useEffect(() => {
    if (!activeService || isLocked) return undefined;
    if (overlayOpen) {
      void bridge.syncWorkspace(null, false, { x: 0, y: 0, width: 1, height: 1 }).catch(() => undefined);
      return undefined;
    }
    const element = surfaceRef.current;
    if (!element) return undefined;
    let frame = 0;
    let cancelled = false;
    let inFlight = false;
    let pending = false;

    /** Measures the placeholder and hands the rect to the native layer. */
    const sync = () => {
      const rect = element.getBoundingClientRect();
      if (rect.width < 2 || rect.height < 2 || cancelled) return;
      if (inFlight) {
        pending = true;
        return;
      }
      inFlight = true;
      pending = false;

      void bridge
        .syncWorkspace(activeService.id, true, {
          x: Math.round(rect.x),
          y: Math.round(rect.y),
          width: Math.round(rect.width),
          height: Math.round(rect.height),
        })
        .then(() => {
          if (!cancelled) setSyncError(null);
        })
        .catch((error: unknown) => {
          if (!cancelled) setSyncError(String(error));
        })
        .finally(() => {
          inFlight = false;
          if (pending && !cancelled) {
            sync();
          }
        });
    };

    // Defer until after paint so the placeholder has its final size.
    frame = requestAnimationFrame(sync);
    const observer = new ResizeObserver(() => {
      cancelAnimationFrame(frame);
      frame = requestAnimationFrame(sync);
    });
    observer.observe(element);
    window.addEventListener('resize', sync);

    return () => {
      cancelled = true;
      cancelAnimationFrame(frame);
      observer.disconnect();
      window.removeEventListener('resize', sync);
      // Hand the screen back to the React shell on unmount / hide.
      void bridge.syncWorkspace(null, false, { x: 0, y: 0, width: 1, height: 1 }).catch(() => undefined);
    };
    // `isLocked` matters: Rust hides webviews on lock without any renderer call,
    // so the workspace has to re-sync after unlock or the frame stays blank.
  }, [activeService, overlayOpen, bridge, isLocked, sessionEpoch]);

  if (!activeService) {
    return (
      <div className="grid h-full place-items-center p-8">
        <div className="glass enter-rise max-w-[360px] rounded-[22px] p-8 text-center">
          <span className="mx-auto grid size-12 place-items-center rounded-2xl border border-line bg-[var(--glass)] text-faint">
            <House className="size-5" aria-hidden />
          </span>
          <p className="mt-4 text-[15px] font-medium text-ink">{t('service.noService')}</p>
          <p className="mt-1.5 text-[12px] text-faint">{t('service.addFirst')}</p>
        </div>
      </div>
    );
  }

  const definition = catalog.find((entry) => entry.kind === activeService.kind);
  const displayName = activeService.label;
  // The fallback is visible only while the native view does not exist (first
  // mount, failure, or while a modal hides it), so it must not claim to be
  // "connecting" once the page is actually live.
  const showFallback = !runtime?.created || Boolean(syncError || runtime?.error);

  /** Runs a guarded navigation action on the active webview. */
  const nav = async (action: 'back' | 'forward' | 'reload' | 'stop' | 'home' | 'external' | 'devtools') => {
    try {
      await bridge.navigateService(action);
    } catch (error) {
      toast({ tone: 'error', title: t('errors.generic'), description: String(error) });
    }
  };

  return (
    <div className="flex h-full flex-col px-3 pt-3 pb-2">
      {/*
       * Service toolbar plus its inline action tray. The tray belongs to the
       * toolbar, so opening it grows this header and pushes the native webview
       * down: the page stays visible instead of flashing to an empty rectangle,
       * and React chrome never has to fight the webview for z-order.
       */}
      <div
        className="glass relative z-20 flex shrink-0 flex-col rounded-[14px]"
        data-service-tray-host
      >
        <div className="flex h-11 items-center gap-1 px-2">
        <IconButton label={t('service.back')} size="sm" onClick={() => void nav('back')}>
          <ArrowLeft />
        </IconButton>
        <IconButton label={t('service.forward')} size="sm" onClick={() => void nav('forward')}>
          <ArrowRight />
        </IconButton>
        <IconButton label={t('common.reload')} size="sm" onClick={() => void nav('reload')}>
          <RotateCw />
        </IconButton>

        <span aria-hidden className="mx-1.5 h-4 w-px bg-[var(--border)]" />

        <span className="grid size-7 shrink-0 place-items-center rounded-[9px] border border-line bg-[var(--glass)] text-ink">
          <ServiceIcon kind={activeService.kind} size={14} />
        </span>
        <div className="ml-1.5 flex min-w-0 flex-1 items-baseline gap-2">
          <p className="truncate text-[12.5px] font-medium tracking-[-0.01em] text-ink">
            {displayName}
          </p>
          {runtime?.title && (
            <p className="hidden truncate text-[10.5px] text-faint md:block">{runtime.title}</p>
          )}
        </div>

        {runtime?.loading && (
          <span className="mr-1 inline-flex items-center gap-2 rounded-full border border-line bg-[var(--glass)] px-2 py-1 text-[10px] text-faint">
            <Equalizer />
            {t('service.waiting')}
          </span>
        )}

        <IconButton
          label={activeService.muted ? t('service.unmute') : t('service.mute')}
          size="sm"
          onClick={() => void muteService(activeService.id, !activeService.muted)}
          active={activeService.muted}
        >
          {activeService.muted ? <VolumeX /> : <Volume2 />}
        </IconButton>

        <IconButton
          label={t('service.zoom')}
          size="sm"
          active={tray === 'zoom'}
          onClick={() => setTray((value) => (value === 'zoom' ? null : 'zoom'))}
        >
          <span className="mono text-[9.5px] leading-none">
            {Math.round(activeService.zoom * 100)}%
          </span>
        </IconButton>

        <IconButton
          label={t('service.external')}
          size="sm"
          onClick={() => void nav('external')}
        >
          <ExternalLink />
        </IconButton>

        <IconButton
          label={t('service.moreActions')}
          size="sm"
          active={tray === 'actions'}
          onClick={() => setTray((value) => (value === 'actions' ? null : 'actions'))}
        >
          <MoreHorizontal />
        </IconButton>
        </div>

        {tray === 'zoom' && (
          <div
            role="toolbar"
            aria-label={t('service.zoom')}
            className="enter-fade flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] px-2 py-2"
          >
            {ZOOM_LEVELS.map((level) => (
              <TrayAction
                key={level}
                active={activeService.zoom === level}
                onClick={() => {
                  setTray(null);
                  void zoomService(activeService.id, level);
                }}
              >
                {Math.round(level * 100)}%
              </TrayAction>
            ))}
          </div>
        )}

        {tray === 'actions' && (
          <div
            role="toolbar"
            aria-label={t('service.moreActions')}
            className="enter-fade flex flex-wrap items-center gap-1.5 border-t border-[var(--border)] px-2 py-2"
          >
            <TrayAction icon={<RotateCw />} onClick={() => { setTray(null); void nav('reload'); }}>
              {t('service.reload')}
            </TrayAction>
            <TrayAction icon={<X />} onClick={() => { setTray(null); void nav('stop'); }}>
              {t('service.stop')}
            </TrayAction>
            <TrayAction icon={<ExternalLink />} onClick={() => { setTray(null); void nav('external'); }}>
              {t('service.external')}
            </TrayAction>
            <span className="ml-auto flex flex-wrap items-center gap-1.5">
              <TrayAction
                icon={<Trash2 />}
                danger
                onClick={() => { setTray(null); setConfirming('clear'); }}
              >
                {t('service.clearData')}
              </TrayAction>
              <TrayAction
                icon={<Trash2 />}
                danger
                onClick={() => { setTray(null); setConfirming('remove'); }}
              >
                {t('service.remove')}
              </TrayAction>
            </span>
          </div>
        )}
      </div>

      {/* Native webview placeholder. Rust mirrors these exact bounds. */}
      <div className="service-surface relative mt-3 min-h-0 flex-1">
        {/*
         * The page fills the card: the only inset is the card's own 1px border,
         * so content runs edge to edge and the outer padding stays on the card.
         */}
        <div ref={surfaceRef} className="absolute inset-px overflow-hidden">
          <div className="grid h-full w-full place-items-center bg-[var(--bg-raised)]">
            {showFallback && (
              <div className="flex max-w-[340px] flex-col items-center text-center">
                {syncError || runtime?.error ? (
                  <>
                    <span className="grid size-12 place-items-center rounded-2xl border border-line bg-[var(--glass)] text-danger">
                      <AlertTriangle className="size-5" aria-hidden />
                    </span>
                    <p className="mt-4 text-[14px] font-medium text-ink">
                      {t('service.errorTitle', { name: displayName })}
                    </p>
                    <p className="mt-1.5 text-[12px] leading-relaxed text-faint">
                      {t('service.errorDescription')}
                    </p>
                    <button
                      type="button"
                      onClick={() => void nav('reload')}
                      className="interactive-ring mt-5 inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-[var(--glass)] px-4 text-[12px] font-medium text-ink hover:bg-[var(--glass-hover)]"
                    >
                      <RotateCw className="size-3.5" aria-hidden />
                      {t('service.retry')}
                    </button>
                  </>
                ) : (
                  <>
                    <span className="grid size-12 place-items-center rounded-2xl border border-line bg-[var(--glass)] text-ink">
                      <ServiceIcon kind={activeService.kind} size={22} />
                    </span>
                    <p className="mt-4 text-[13.5px] font-medium text-ink">
                      {t('service.loading', { name: displayName })}
                    </p>
                    <p className="mt-1 text-[11px] text-faint">{t('service.offlineHint')}</p>
                    <Spinner className="mt-4" label={definition?.name} />
                  </>
                )}
              </div>
            )}
          </div>
        </div>
      </div>

      {/* Confirm dialogs */}
      {confirming === 'clear' && (
        <ConfirmDialog
          title={t('service.clearTitle', { name: displayName })}
          description={t('service.clearDesc')}
          confirmLabel={t('service.clearConfirm')}
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            setConfirming(null);
            try {
              await bridge.clearServiceData(activeService.id);
              // Rust closed the native view; recreate it on the same surface.
              setSessionEpoch((value) => value + 1);
              toast({ tone: 'success', title: t('service.cleared', { name: displayName }) });
            } catch (error) {
              toast({ tone: 'error', title: t('errors.generic'), description: String(error) });
            }
          }}
        />
      )}
      {confirming === 'remove' && (
        <ConfirmDialog
          title={t('service.deleteTitle', { name: displayName })}
          description={t('service.deleteDesc')}
          confirmLabel={t('service.eraseData')}
          danger
          onCancel={() => setConfirming(null)}
          onConfirm={async () => {
            setConfirming(null);
            try {
              await removeService(activeService.id, true);
              toast({ tone: 'success', title: t('toasts.serviceRemoved', { name: displayName }) });
            } catch (error) {
              toast({ tone: 'error', title: t('errors.generic'), description: String(error) });
            }
          }}
        />
      )}
    </div>
  );
}

/** One pill inside the inline action tray. */
function TrayAction({
  icon,
  children,
  onClick,
  danger,
  active,
}: {
  icon?: React.ReactNode;
  children: React.ReactNode;
  onClick: () => void;
  danger?: boolean;
  active?: boolean;
}) {
  return (
    <button
      type="button"
      aria-pressed={active}
      onClick={onClick}
      className={cn(
        'interactive-ring inline-flex h-7 items-center gap-1.5 rounded-[9px] border px-2.5 text-[11.5px] font-medium',
        active
          ? 'border-transparent bg-accent text-accent-ink'
          : 'border-line bg-[var(--glass)] text-soft hover:border-line-strong hover:bg-[var(--glass-hover)] hover:text-ink',
        danger && !active && 'text-danger hover:border-[color-mix(in_srgb,var(--danger)_45%,transparent)]',
      )}
    >
      {icon && <span className="[&_svg]:size-3.5">{icon}</span>}
      {children}
    </button>
  );
}

/**
 * Confirmation for destructive service actions. It reuses the shared dialog so
 * focus trapping, Escape and focus restoration behave like every other modal.
 */
function ConfirmDialog({
  title,
  description,
  confirmLabel,
  onCancel,
  onConfirm,
  danger,
}: {
  title: string;
  description: string;
  confirmLabel: string;
  onCancel: () => void;
  onConfirm: () => Promise<void>;
  danger?: boolean;
}) {
  const { t } = useTranslation();
  const [busy, setBusy] = useState(false);
  return (
    <Modal
      open
      onClose={onCancel}
      title={title}
      description={description}
      size="sm"
      dismissible={!busy}
      footer={
        <>
          <Button variant="ghost" onClick={onCancel} disabled={busy}>
            {t('common.cancel')}
          </Button>
          <Button
            variant={danger ? 'secondary' : 'primary'}
            loading={busy}
            className={
              danger
                ? 'border-transparent bg-[var(--danger)] text-[var(--accent-ink)] hover:opacity-90'
                : undefined
            }
            onClick={() => {
              setBusy(true);
              void onConfirm().finally(() => setBusy(false));
            }}
          >
            {confirmLabel}
          </Button>
        </>
      }
    />
  );
}
