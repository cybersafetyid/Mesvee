import { useTranslation } from 'react-i18next';
import { Home, LockKeyhole, Monitor, Moon, Plus, Settings2, Sun, VolumeX } from 'lucide-react';
import { useAppStore } from '../core/store';
import { ServiceIcon } from '../ui/ServiceIcon';
import { cn } from '../lib/cn';
import type { Theme } from '../core/types';

/**
 * Left rail: navigation, every isolated account, and the app-level controls.
 *
 * It is a floating glass card rather than an edge-to-edge column, which matches
 * the service toolbar and keeps the workspace readable as a single surface.
 * Accounts stay one click away, which is the core interaction of Mesvee.
 */
export function Rail() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const security = useAppStore((state) => state.security);
  const route = useAppStore((state) => state.route);
  const serviceStates = useAppStore((state) => state.serviceStates);
  const goHome = useAppStore((state) => state.goHome);
  const openService = useAppStore((state) => state.openService);
  const openSettings = useAppStore((state) => state.openSettings);
  const setAddServiceOpen = useAppStore((state) => state.setAddServiceOpen);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const lockNow = useAppStore((state) => state.lockNow);
  const toast = useAppStore((state) => state.toast);

  if (!settings) return null;

  const services = settings.services;
  const totalUnread = services.reduce(
    (sum, service) => (service.muted ? sum : sum + (serviceStates[service.id]?.unread ?? 0)),
    0,
  );
  const theme = settings.appearance.theme;

  /** Cycles dark → light → system and persists the choice. */
  const cycleTheme = async () => {
    const next: Theme = theme === 'dark' ? 'light' : theme === 'light' ? 'system' : 'dark';
    try {
      await saveSettings({
        appearance: { ...settings.appearance, theme: next },
      });
      toast({ tone: 'info', title: t('toasts.themeChanged') });
    } catch (error) {
      toast({ tone: 'error', title: t('toasts.storageError'), description: String(error) });
    }
  };

  const ThemeIcon = theme === 'system' ? Monitor : theme === 'light' ? Sun : Moon;

  return (
    <nav
      aria-label={t('rail.services')}
      className={cn(
        'relative z-20 mt-3 mb-2 ml-2 flex w-[var(--rail-width)] shrink-0 flex-col items-center gap-1.5',
        'rounded-[22px] border border-[var(--border)] bg-[var(--glass)] px-2 py-2.5',
        'shadow-[var(--shadow-glass)] backdrop-blur-2xl',
      )}
    >
      <button
        type="button"
        onClick={goHome}
        title={t('rail.home')}
        aria-label={t('rail.home')}
        aria-current={route === 'home' ? 'page' : undefined}
        className={cn(
          'interactive-ring relative grid size-[42px] shrink-0 place-items-center rounded-[13px] border',
          route === 'home'
            ? 'border-transparent bg-accent text-accent-ink shadow-[0_14px_30px_-18px_rgba(0,0,0,0.95)]'
            : 'border-[var(--border)] bg-[color-mix(in_srgb,var(--glass)_70%,transparent)] text-soft hover:border-[var(--border-strong)] hover:bg-[var(--glass-hover)] hover:text-ink',
        )}
      >
        <Home className="size-[18px]" strokeWidth={1.9} aria-hidden />
        {totalUnread > 0 && route !== 'home' && (
          <span className="mono absolute -top-1.5 -right-1.5 grid h-[16px] min-w-[16px] place-items-center rounded-full bg-accent px-1 text-[9px] font-semibold text-accent-ink ring-2 ring-[var(--bg-base)]">
            {totalUnread > 99 ? '99+' : totalUnread}
          </span>
        )}
      </button>

      <div aria-hidden className="my-0.5 h-px w-6 bg-[var(--border)]" />

      {/*
       * The scroller is padded by the badge overhang (-mx-2 + px-2, -mt-1.5 +
       * pt-1.5) so its padding box has room for the unread pill. `overflow-y:
       * auto` also clips horizontally, which used to shave the badge corners.
       */}
      <div className="rail-scroll -mx-2 -mt-1.5 flex min-h-0 flex-1 flex-col items-center gap-1.5 overflow-y-auto px-2 pt-1.5 pb-1">
        {services.map((service) => {
          const state = serviceStates[service.id];
          const active = route === 'service' && settings.activeServiceId === service.id;
          const unread = service.muted ? 0 : (state?.unread ?? 0);
          const label = unread
            ? `${service.label} — ${t('rail.unread', { count: unread })}`
            : service.label;

          return (
            <button
              key={service.id}
              type="button"
              title={label}
              aria-label={label}
              aria-current={active ? 'page' : undefined}
              onClick={() => void openService(service.id)}
              className={cn(
                'interactive-ring group relative grid size-[42px] shrink-0 place-items-center rounded-[13px] border',
                active
                  ? 'border-transparent bg-accent text-accent-ink shadow-[0_16px_34px_-18px_rgba(0,0,0,0.95)]'
                  : 'border-[var(--border)] bg-[color-mix(in_srgb,var(--glass)_70%,transparent)] text-soft hover:border-[var(--border-strong)] hover:bg-[var(--glass-hover)] hover:text-ink',
              )}
            >
              <ServiceIcon kind={service.kind} size={20} />
              {unread > 0 && (
                <span
                  className={cn(
                    'mono absolute -top-1.5 -right-1.5 grid h-[17px] min-w-[17px] place-items-center rounded-full px-1 text-[9px] font-semibold ring-2',
                    active
                      ? 'bg-[var(--accent-ink)] text-[var(--accent)] ring-[var(--bg-base)]'
                      : 'bg-accent text-accent-ink ring-[var(--bg-base)]',
                  )}
                >
                  {unread > 99 ? '99+' : unread}
                </span>
              )}
              {service.muted && (
                <span className="absolute -bottom-1 -left-1 grid size-4 place-items-center rounded-full border border-line bg-[var(--bg-raised)] text-faint">
                  <VolumeX className="size-2.5" aria-hidden />
                </span>
              )}
              {state?.error && (
                <span
                  aria-label={t('service.errorTitle', { name: service.label })}
                  className="absolute right-0.5 bottom-0.5 size-1.5 rounded-full bg-danger ring-2 ring-[var(--bg-base)]"
                />
              )}
              {state?.loading && !active && (
                <span className="absolute bottom-1 size-1 animate-pulse rounded-full bg-current opacity-60" />
              )}
            </button>
          );
        })}

        <button
          type="button"
          onClick={() => setAddServiceOpen(true)}
          title={t('rail.addService')}
          aria-label={t('rail.addService')}
          className="interactive-ring mt-0.5 grid size-[42px] shrink-0 place-items-center rounded-[13px] border border-dashed border-[var(--border-strong)] text-faint hover:border-[var(--text-tertiary)] hover:bg-[var(--glass)] hover:text-ink"
        >
          <Plus className="size-[18px]" aria-hidden />
        </button>
      </div>

      {/* App controls live in their own floating capsule. */}
      <div className="mt-auto flex w-full flex-col items-center gap-0.5 rounded-[15px] border border-[var(--border)] bg-[color-mix(in_srgb,var(--glass)_70%,transparent)] p-1">
        <button
          type="button"
          onClick={() => void cycleTheme()}
          title={`${t('settings.theme')}: ${t(
            theme === 'system' ? 'settings.system' : theme === 'light' ? 'settings.light' : 'settings.dark',
          )}`}
          aria-label={t('settings.theme')}
          className="interactive-ring grid size-8 place-items-center rounded-[10px] text-faint hover:bg-[var(--glass-hover)] hover:text-ink"
        >
          <ThemeIcon className="size-[16px]" strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => openSettings('general')}
          title={t('rail.settings')}
          aria-label={t('rail.settings')}
          aria-current={route === 'settings' ? 'page' : undefined}
          className={cn(
            'interactive-ring grid size-8 place-items-center rounded-[10px]',
            route === 'settings'
              ? 'bg-accent text-accent-ink'
              : 'text-faint hover:bg-[var(--glass-hover)] hover:text-ink',
          )}
        >
          <Settings2 className="size-[16px]" strokeWidth={1.8} aria-hidden />
        </button>
        <button
          type="button"
          onClick={() => {
            if (security?.configured) void lockNow();
            else openSettings('security');
          }}
          title={security?.configured ? t('rail.lock') : t('settings.enableLock')}
          aria-label={security?.configured ? t('rail.lock') : t('settings.enableLock')}
          className="interactive-ring grid size-8 place-items-center rounded-[10px] text-faint hover:bg-[var(--glass-hover)] hover:text-ink"
        >
          <LockKeyhole className="size-[16px]" strokeWidth={1.8} aria-hidden />
        </button>
      </div>
    </nav>
  );
}
