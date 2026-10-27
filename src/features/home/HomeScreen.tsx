import { useTranslation } from 'react-i18next';
import {
  ArrowUpRight,
  Bell,
  BellRing,
  CloudDownload,
  LockKeyhole,
  Plus,
  ShieldCheck,
  VolumeX,
  Wifi,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { Button } from '../../ui/Button';
import { Switch } from '../../ui/Controls';
import { Logo } from '../../ui/Logo';
import { ServiceIcon } from '../../ui/ServiceIcon';
import { cn } from '../../lib/cn';

/** Returns the localized greeting for the current part of the day. */
function greetingKey(): 'home.greetingMorning' | 'home.greetingAfternoon' | 'home.greetingEvening' {
  const hour = new Date().getHours();
  if (hour < 11) return 'home.greetingMorning';
  if (hour < 18) return 'home.greetingAfternoon';
  return 'home.greetingEvening';
}

/**
 * Home dashboard: Option A layout.
 * Productive glass hub that fits left-right seamlessly with Rail and Titlebar.
 * Active services take main stage on the left, with the Orbit visual and quiet
 * controls stacked on the right.
 */
export function HomeScreen() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const catalog = useAppStore((state) => state.catalog);
  const serviceStates = useAppStore((state) => state.serviceStates);
  const security = useAppStore((state) => state.security);
  const app = useAppStore((state) => state.app);
  const updateInfo = useAppStore((state) => state.updateInfo);
  const openService = useAppStore((state) => state.openService);
  const openSettings = useAppStore((state) => state.openSettings);
  const setAddServiceOpen = useAppStore((state) => state.setAddServiceOpen);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const toast = useAppStore((state) => state.toast);

  if (!settings) return null;

  const services = settings.services;
  const totalUnread = services.reduce(
    (total, service) => total + (service.muted ? 0 : (serviceStates[service.id]?.unread ?? 0)),
    0,
  );
  const focusMode = settings.notifications.focusMode;
  const orbitKinds = services.length
    ? services.slice(0, 5).map((service) => service.kind)
    : ['whatsapp', 'telegram', 'instagram', 'discord', 'x'];

  /** Updates focus mode from the notification summary card. */
  const toggleFocus = async () => {
    try {
      await saveSettings({
        notifications: { ...settings.notifications, focusMode: !focusMode },
      });
    } catch (error) {
      toast({ tone: 'error', title: t('toasts.storageError'), description: String(error) });
    }
  };

  return (
    <div className="h-full overflow-y-auto px-3.5 pt-3 pb-6 lg:px-5">
      <div className="flex w-full flex-col gap-4">
        {/* Streamlined Top Control Header */}
        <header className="glass enter-rise flex flex-wrap items-center justify-between gap-4 rounded-[20px] px-5 py-4">
          <div className="flex items-center gap-3.5">
            <div>
              <div className="flex flex-wrap items-center gap-2">
                <h1 className="text-[17px] font-semibold tracking-[-0.03em] text-ink">
                  {t(greetingKey())}
                </h1>
                <span className="text-[11px] text-faint">·</span>
                <span className="text-[12.5px] font-medium text-soft">
                  {totalUnread > 0 ? t('home.unreadTotal', { count: totalUnread }) : t('home.quiet')}
                </span>
              </div>
              <p className="mt-0.5 text-[11px] text-faint">
                {t('home.eyebrow')} · {t('home.serviceCount', { count: services.length })}
              </p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <Button
              variant="primary"
              size="sm"
              icon={<Plus />}
              onClick={() => setAddServiceOpen(true)}
            >
              {t('home.addService')}
            </Button>
          </div>
        </header>

        {/* Main 2-Column Content: Services (Left) + Orbit Widget & Controls (Right) */}
        <div className="grid grid-cols-1 items-start gap-4 lg:grid-cols-[1.55fr_1fr] xl:grid-cols-[1.75fr_1fr]">
          {/* Left Column: Workspace Services */}
          <section className="flex min-w-0 flex-col gap-3">
            <header className="flex items-end justify-between px-1">
              <div>
                <h2 className="text-[14px] font-semibold tracking-[-0.02em] text-ink">
                  {t('home.workspaceTitle')}
                </h2>
                <p className="mt-0.5 text-[11px] text-faint">{t('home.workspaceDesc')}</p>
              </div>
              <span className="mono text-[10.5px] text-faint">
                {t('home.serviceCount', { count: services.length })}
              </span>
            </header>

            {services.length === 0 ? (
              <div className="glass enter-fade flex min-h-[260px] flex-col items-center justify-center rounded-[20px] p-8 text-center">
                <span className="grid size-12 place-items-center rounded-2xl border border-line bg-[var(--glass)] text-soft">
                  <ServiceIcon kind="whatsapp" size={22} />
                </span>
                <h3 className="mt-4 text-[15px] font-medium tracking-[-0.02em] text-ink">
                  {t('home.noServicesTitle')}
                </h3>
                <p className="mt-1.5 max-w-[330px] text-pretty text-[12px] leading-relaxed text-faint">
                  {t('home.noServicesDesc')}
                </p>
                <Button
                  variant="secondary"
                  size="sm"
                  className="mt-4"
                  icon={<Plus />}
                  onClick={() => setAddServiceOpen(true)}
                >
                  {t('home.addService')}
                </Button>
              </div>
            ) : (
              <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 xl:grid-cols-3">
                {services.map((service, index) => {
                  const state = serviceStates[service.id];
                  const definition = catalog.find((entry) => entry.kind === service.kind);
                  const unread = service.muted ? 0 : (state?.unread ?? 0);
                  return (
                    <button
                      key={service.id}
                      type="button"
                      onClick={() => void openService(service.id)}
                      style={{ animationDelay: `${index * 45}ms` }}
                      className="glass glass-hover enter-rise group relative flex h-[120px] flex-col justify-between overflow-hidden rounded-[18px] p-3.5 text-left"
                    >
                      <div
                        aria-hidden
                        className="absolute -top-10 -right-10 size-28 rounded-full bg-[var(--glass-hover)] opacity-0 blur-2xl transition-opacity duration-500 group-hover:opacity-100"
                      />
                      <div className="relative flex items-start justify-between gap-2.5">
                        <div className="flex min-w-0 items-center gap-2.5">
                          <span className="grid size-9 shrink-0 place-items-center rounded-[11px] border border-line bg-[var(--glass)] text-ink">
                            <ServiceIcon kind={service.kind} size={18} />
                          </span>
                          <div className="min-w-0">
                            <p className="truncate text-[13px] font-medium tracking-[-0.015em] text-ink">
                              {service.label}
                            </p>
                            <p className="mt-0.5 truncate text-[10.5px] text-faint">
                              {definition?.name ?? service.kind}
                            </p>
                          </div>
                        </div>
                        <ArrowUpRight className="size-3.5 shrink-0 text-faint opacity-0 transition-all duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5 group-hover:opacity-100" />
                      </div>

                      <div className="relative flex items-center justify-between gap-2">
                        <span className="inline-flex items-center gap-1.5 text-[10px] text-faint">
                          <span
                            className={cn(
                              'size-1.5 rounded-full',
                              state?.error
                                ? 'bg-danger'
                                : state?.loading
                                  ? 'animate-pulse bg-[var(--text-tertiary)]'
                                  : 'bg-[var(--success)]',
                            )}
                          />
                          {state?.loading
                            ? t('service.waiting')
                            : state?.error
                              ? t('common.unavailable')
                              : t('titlebar.connected')}
                          {service.muted && (
                            <VolumeX className="ml-1 size-3" aria-label={t('service.muted')} />
                          )}
                        </span>
                        {unread > 0 ? (
                          <span className="mono rounded-full border border-line bg-[var(--glass-strong)] px-2 py-0.5 text-[10px] font-medium text-ink">
                            {unread > 99 ? '99+' : unread}
                          </span>
                        ) : (
                          <span className="text-[10px] text-faint opacity-60">
                            {t('titlebar.allQuiet')}
                          </span>
                        )}
                      </div>
                    </button>
                  );
                })}

                <button
                  type="button"
                  onClick={() => setAddServiceOpen(true)}
                  className="group flex min-h-[120px] flex-col items-center justify-center gap-2 rounded-[18px] border border-dashed border-[var(--border-strong)] text-faint transition-colors duration-200 hover:border-[var(--text-tertiary)] hover:bg-[var(--glass)] hover:text-ink"
                >
                  <span className="grid size-8 place-items-center rounded-[10px] border border-line bg-[var(--glass)] transition-transform duration-300 group-hover:scale-105">
                    <Plus className="size-4" aria-hidden />
                  </span>
                  <span className="text-[11px] font-medium">{t('home.addService')}</span>
                </button>
              </div>
            )}
          </section>

          {/* Right Column: Orbit Visual Widget & Status Controls */}
          <aside className="flex flex-col gap-3.5">
            {/* Live Workspace Orbit Widget */}
            <div className="glass enter-fade relative overflow-hidden rounded-[22px] p-4.5 shadow-[var(--shadow-glass)]">
              <div aria-hidden className="dot-grid absolute inset-0 opacity-25" />
              <div
                aria-hidden
                className="absolute -top-24 -right-24 size-[280px] rounded-full border border-[var(--border)] opacity-60"
              />
              <div
                aria-hidden
                className="absolute top-1/2 left-1/2 size-[240px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border)]"
              />
              <div
                aria-hidden
                className="orbit absolute top-1/2 left-1/2 size-[240px] -translate-x-1/2 -translate-y-1/2 rounded-full"
              >
                <span className="absolute top-[7%] left-[16%] size-1 rounded-full bg-[var(--text-tertiary)]" />
              </div>
              <div
                aria-hidden
                className="absolute top-1/2 left-1/2 size-[320px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border)] opacity-35"
              />

              <header className="relative z-10 flex items-center justify-between">
                <p className="eyebrow">{t('home.workspaceTitle')}</p>
                <span className="inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--glass)] px-2.5 py-0.5 text-[9.5px] font-medium text-soft">
                  <Wifi className="size-2.5" aria-hidden />
                  {t('titlebar.connected')}
                </span>
              </header>

              <div className="relative z-10 flex h-[190px] items-center justify-center">
                <div className="float-slow absolute top-[8%] left-[8%]">
                  <OrbitChip kind={orbitKinds[0] ?? 'whatsapp'} delay="0s" small />
                </div>
                <div className="float-slow absolute top-[10%] right-[10%]">
                  <OrbitChip kind={orbitKinds[1] ?? 'telegram'} delay="0.8s" small />
                </div>
                <div className="float-slow absolute bottom-[12%] left-[12%]">
                  <OrbitChip kind={orbitKinds[2] ?? 'instagram'} delay="1.6s" small />
                </div>
                <div className="float-slow absolute bottom-[10%] right-[10%]">
                  <OrbitChip kind={orbitKinds[3] ?? 'discord'} delay="2.2s" small />
                </div>
                <div className="float-slow absolute top-[44%] -left-1 hidden sm:block">
                  <OrbitChip kind={orbitKinds[4] ?? 'x'} delay="1.1s" small />
                </div>

                <div className="glass-strong relative flex size-[128px] flex-col items-center justify-center gap-1.5 rounded-full text-center shadow-[0_24px_60px_-30px_rgba(0,0,0,0.9)]">
                  <span
                    aria-hidden
                    className="pulse-soft absolute inset-1.5 rounded-full border border-[var(--border-strong)]"
                  />
                  <Logo size={24} />
                  <div>
                    {totalUnread > 0 && (
                      <p className="mono text-[17px] leading-none font-medium tracking-[-0.04em] text-ink">
                        {totalUnread > 99 ? '99+' : totalUnread}
                      </p>
                    )}
                    <p
                      className={cn(
                        'text-[8.5px] tracking-[0.1em] text-faint uppercase',
                        totalUnread > 0 && 'mt-1',
                      )}
                    >
                      {totalUnread > 0 ? t('home.unreadSummary') : t('titlebar.allQuiet')}
                    </p>
                  </div>
                </div>
              </div>

              <footer className="relative z-10 flex items-center justify-between pt-1">
                <div className="flex -space-x-1.5">
                  {orbitKinds.slice(0, 5).map((kind) => (
                    <span
                      key={kind}
                      className="grid size-5 place-items-center rounded-full border border-[var(--border)] bg-[var(--bg-raised)] text-soft"
                    >
                      <ServiceIcon kind={kind} size={9} />
                    </span>
                  ))}
                </div>
                <p className="mono text-[8.5px] tracking-[0.14em] text-faint uppercase">
                  {t('settings.localFirst')}
                </p>
              </footer>
            </div>

            {/* Quick Status Cards */}
            <div className="grid grid-cols-1 gap-2.5 sm:grid-cols-2 lg:grid-cols-1">
              {/* Security Status Card */}
              <button
                type="button"
                onClick={() => openSettings('security')}
                className="glass glass-hover group relative overflow-hidden rounded-[18px] p-3.5 text-left"
              >
                <div className="flex items-start justify-between gap-3">
                  <span className="grid size-8 place-items-center rounded-[10px] border border-line bg-[var(--glass)] text-ink">
                    <LockKeyhole className="size-4" aria-hidden />
                  </span>
                  <ArrowUpRight className="size-3.5 text-faint transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
                </div>
                <p className="mt-2.5 text-[12.5px] font-medium text-ink">{t('home.securityTitle')}</p>
                <p className="mt-0.5 text-pretty text-[10.5px] leading-relaxed text-faint">
                  {security?.lockEnabled ? t('home.securityDescOn') : t('home.securityDescOff')}
                </p>
                <p className="mt-2 inline-flex items-center gap-1.5 text-[10px] text-soft">
                  <span
                    className={cn(
                      'size-1.5 rounded-full',
                      security?.lockEnabled ? 'bg-[var(--success)]' : 'bg-[var(--text-tertiary)]',
                    )}
                  />
                  {security?.lockEnabled ? t('home.securityOn') : t('home.securityOff')}
                </p>
              </button>

              {/* Focus Mode Switch Card */}
              <div className="glass rounded-[18px] p-3.5">
                <div className="flex items-center justify-between gap-3">
                  <span className="grid size-8 place-items-center rounded-[10px] border border-line bg-[var(--glass)] text-ink">
                    {focusMode ? (
                      <Bell className="size-4" aria-hidden />
                    ) : (
                      <BellRing className="size-4" aria-hidden />
                    )}
                  </span>
                  <Switch
                    checked={focusMode}
                    onChange={() => void toggleFocus()}
                    label={t('home.focusTitle')}
                  />
                </div>
                <p className="mt-2.5 text-[12.5px] font-medium text-ink">{t('home.focusTitle')}</p>
                <p className="mt-0.5 text-pretty text-[10.5px] leading-relaxed text-faint">
                  {focusMode ? t('home.focusOn') : t('home.focusDesc')}
                </p>
              </div>

              {/* Updates Card */}
              <button
                type="button"
                onClick={() => openSettings('updates')}
                className="glass glass-hover group flex items-center gap-3 rounded-[18px] p-3.5 text-left sm:col-span-2 lg:col-span-1"
              >
                <span className="grid size-8 shrink-0 place-items-center rounded-[10px] border border-line bg-[var(--glass)] text-ink">
                  <CloudDownload className="size-4" aria-hidden />
                </span>
                <div className="min-w-0 flex-1">
                  <p className="text-[12.5px] font-medium text-ink">{t('home.updatesTitle')}</p>
                  <p className="mt-0.5 truncate text-[10.5px] text-faint">
                    {updateInfo
                      ? t('home.updateReady', { version: updateInfo.version })
                      : t('home.currentVersion', { version: app?.version ?? '0.1.0' })}
                  </p>
                </div>
                <ArrowUpRight className="size-3.5 shrink-0 text-faint transition-transform duration-300 group-hover:translate-x-0.5 group-hover:-translate-y-0.5" />
              </button>
            </div>
          </aside>
        </div>

        {/* Footer */}
        <footer className="mt-3 flex flex-wrap items-center justify-between gap-3 border-t border-[var(--border)] pt-3 pb-2 text-[10px] text-faint">
          <span className="inline-flex items-center gap-1.5">
            <ShieldCheck className="size-3" aria-hidden />
            {t('home.footerPrivacy')}
          </span>
          <span className="mono">mesvee · {app?.version ?? '0.1.0'}</span>
        </footer>
      </div>
    </div>
  );
}

/** Small floating brand chip used in the hero orbit composition. */
function OrbitChip({ kind, delay, small }: { kind: string; delay: string; small?: boolean }) {
  return (
    <span
      style={{ animationDelay: delay }}
      className={cn(
        'glass-strong grid place-items-center rounded-[11px] text-soft shadow-[0_16px_40px_-24px_rgba(0,0,0,0.8)]',
        small ? 'size-7' : 'size-9',
      )}
    >
      <ServiceIcon kind={kind} size={small ? 12 : 15} />
    </span>
  );
}
