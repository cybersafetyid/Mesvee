import { useEffect, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  ArrowRight,
  BellRing,
  Check,
  Globe2,
  LockKeyhole,
  Maximize2,
  Minus,
  Monitor,
  Moon,
  ShieldCheck,
  Sparkles,
  Sun,
  X,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { setLanguage } from '../../core/i18n';
import { applyTheme } from '../../lib/appearance';
import { cn } from '../../lib/cn';
import { Button, IconButton } from '../../ui/Button';
import { Switch } from '../../ui/Controls';
import { Logo } from '../../ui/Logo';
import { ServiceIcon } from '../../ui/ServiceIcon';
import type { Language, Theme } from '../../core/types';
import { detectPlatform } from '../../lib/platform';

/** Three-step first-run journey. */
const STEPS = [0, 1, 2] as const;

/**
 * First-run experience. It runs before the shell exists, so it owns its own
 * drag strip and window controls to keep a frameless window usable.
 */
export function Onboarding() {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const navigate = useAppStore((state) => state.navigate);
  const setAddServiceOpen = useAppStore((state) => state.setAddServiceOpen);
  const toast = useAppStore((state) => state.toast);
  const bridge = useAppStore((state) => state.bridge);

  const [step, setStep] = useState(0);
  const [language, setLocalLanguage] = useState<Language>(settings?.appearance.language ?? 'id');
  const [theme, setTheme] = useState<Theme>(settings?.appearance.theme ?? 'dark');
  const [notifications, setNotifications] = useState(settings?.notifications.enabled ?? true);
  const [saving, setSaving] = useState(false);
  const platform = detectPlatform();
  const isMac = platform === 'macos';

  /** Theme selection previews instantly and is persisted on finish. */
  useEffect(() => {
    applyTheme(theme);
  }, [theme]);

  /** Language changes apply immediately to the i18n instance. */
  useEffect(() => {
    void setLanguage(language);
  }, [language]);

  /** Persists every onboarding choice in one atomic settings patch. */
  const finish = async () => {
    if (!settings || saving) return;
    setSaving(true);
    try {
      await saveSettings({
        onboarded: true,
        appearance: { ...settings.appearance, language, theme },
        notifications: { ...settings.notifications, enabled: notifications },
      });
      navigate('home');
      setAddServiceOpen(true);
    } catch (error) {
      toast({ tone: 'error', title: t('toasts.storageError'), description: String(error) });
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="app-canvas h-full overflow-y-auto">
      <div className="mx-auto flex min-h-full w-full max-w-[1180px] flex-col px-7 py-6 lg:px-10">
        <header className="relative flex items-center justify-between gap-4">
          <div data-tauri-drag-region className="absolute inset-x-0 -top-6 h-10" />
          <Logo size={26} withWordmark />
          <div className="relative z-10 flex items-center gap-3">
            <span className="mono text-[10px] tracking-[0.14em] text-faint uppercase">
              {t('onboarding.step', { current: step + 1, total: STEPS.length })}
            </span>
            {!isMac && (
              <div className="flex items-center">
                <IconButton
                  label={t('titlebar.minimize')}
                  size="sm"
                  onClick={() => void bridge.minimizeWindow()}
                >
                  <Minus />
                </IconButton>
                <IconButton
                  label={t('titlebar.maximize')}
                  size="sm"
                  onClick={() => void bridge.toggleMaximize()}
                >
                  <Maximize2 />
                </IconButton>
                <IconButton
                  label={t('titlebar.close')}
                  size="sm"
                  onClick={() => void bridge.closeWindow()}
                >
                  <X />
                </IconButton>
              </div>
            )}
          </div>
        </header>

        <main className="grid flex-1 grid-cols-1 items-center gap-10 py-10 xl:grid-cols-[1.04fr_0.96fr] xl:gap-16">
          <section key={step} className="enter-rise min-w-0">
            {step === 0 && (
              <>
                <p className="eyebrow">{t('onboarding.welcomeEyebrow')}</p>
                <h1 className="display mt-4 max-w-[540px]">
                  {t('onboarding.welcomeTitleA')}
                  <span className="mt-1 block text-[var(--text-tertiary)]">
                    {t('onboarding.welcomeTitleB')}
                  </span>
                </h1>
                <p className="mt-5 max-w-[450px] text-pretty text-[13.5px] leading-relaxed text-soft">
                  {t('onboarding.welcomeDesc')}
                </p>

                <div className="mt-8 grid max-w-[520px] gap-2 sm:grid-cols-3">
                  <Feature
                    icon={<Sparkles />}
                    title={t('onboarding.featureNative')}
                    description={t('onboarding.featureNativeDesc')}
                  />
                  <Feature
                    icon={<ShieldCheck />}
                    title={t('onboarding.featureIsolation')}
                    description={t('onboarding.featureIsolationDesc')}
                  />
                  <Feature
                    icon={<Globe2 />}
                    title={t('onboarding.featureLocal')}
                    description={t('onboarding.featureLocalDesc')}
                  />
                </div>

                <div className="mt-8 flex flex-wrap items-center gap-3">
                  <Button
                    variant="primary"
                    size="lg"
                    iconRight={<ArrowRight />}
                    onClick={() => setStep(1)}
                  >
                    {t('onboarding.start')}
                  </Button>
                  <span className="text-[10.5px] text-faint">{t('onboarding.privacyNote')}</span>
                </div>
              </>
            )}

            {step === 1 && (
              <>
                <p className="eyebrow">{t('onboarding.personalizeEyebrow')}</p>
                <h1 className="mt-4 max-w-[500px] text-[42px] leading-[0.98] font-medium tracking-[-0.055em] text-ink">
                  {t('onboarding.personalizeTitle')}
                </h1>
                <p className="mt-4 max-w-[440px] text-pretty text-[13.5px] leading-relaxed text-soft">
                  {t('onboarding.personalizeDesc')}
                </p>

                <div className="mt-8 max-w-[480px] space-y-5">
                  <div>
                    <p className="mb-2 flex items-center gap-2 text-[11.5px] font-medium text-soft">
                      <Globe2 className="size-3.5" aria-hidden />
                      {t('settings.language')}
                    </p>
                    <div className="inline-flex rounded-[12px] border border-line bg-[var(--glass)] p-[3px]">
                      {(['id', 'en'] as Language[]).map((option) => (
                        <button
                          key={option}
                          type="button"
                          onClick={() => setLocalLanguage(option)}
                          aria-pressed={language === option}
                          className={cn(
                            'h-8 rounded-[9px] px-4 text-[12px] font-medium transition-colors duration-200',
                            language === option
                              ? 'bg-accent text-accent-ink'
                              : 'text-soft hover:text-ink',
                          )}
                        >
                          {option === 'id' ? 'Bahasa Indonesia' : 'English'}
                        </button>
                      ))}
                    </div>
                  </div>

                  <div>
                    <p className="mb-2 text-[11.5px] font-medium text-soft">
                      {t('settings.theme')}
                    </p>
                    <div className="grid grid-cols-3 gap-2.5">
                      <ThemeCard
                        label={t('settings.dark')}
                        icon={<Moon />}
                        active={theme === 'dark'}
                        onClick={() => setTheme('dark')}
                        tone="dark"
                      />
                      <ThemeCard
                        label={t('settings.light')}
                        icon={<Sun />}
                        active={theme === 'light'}
                        onClick={() => setTheme('light')}
                        tone="light"
                      />
                      <ThemeCard
                        label={t('settings.system')}
                        icon={<Monitor />}
                        active={theme === 'system'}
                        onClick={() => setTheme('system')}
                        tone="split"
                      />
                    </div>
                  </div>
                  <p className="text-[10.5px] text-faint">{t('onboarding.personalizeNote')}</p>
                </div>

                <div className="mt-8 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="lg"
                    icon={<ArrowLeft />}
                    onClick={() => setStep(0)}
                  >
                    {t('onboarding.back')}
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    iconRight={<ArrowRight />}
                    onClick={() => setStep(2)}
                  >
                    {t('common.continue')}
                  </Button>
                </div>
              </>
            )}

            {step === 2 && (
              <>
                <p className="eyebrow">{t('onboarding.readyEyebrow')}</p>
                <h1 className="mt-4 max-w-[480px] text-[42px] leading-[0.98] font-medium tracking-[-0.055em] text-ink">
                  {t('onboarding.readyTitle')}
                </h1>
                <p className="mt-4 max-w-[440px] text-pretty text-[13.5px] leading-relaxed text-soft">
                  {t('onboarding.readyDesc')}
                </p>

                <div className="mt-7 max-w-[500px] space-y-2.5">
                  <div className="glass flex items-center gap-3 rounded-[16px] p-3.5">
                    <span className="grid size-9 place-items-center rounded-[11px] border border-line bg-[var(--glass)] text-ink">
                      <BellRing className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-ink">
                        {t('onboarding.notificationsTitle')}
                      </p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
                        {t('onboarding.notificationsDesc')}
                      </p>
                    </div>
                    <Switch
                      checked={notifications}
                      onChange={setNotifications}
                      label={t('onboarding.notificationsTitle')}
                    />
                  </div>

                  <div className="glass flex items-center gap-3 rounded-[16px] p-3.5">
                    <span className="grid size-9 place-items-center rounded-[11px] border border-line bg-[var(--glass)] text-ink">
                      <LockKeyhole className="size-4" aria-hidden />
                    </span>
                    <div className="min-w-0 flex-1">
                      <p className="text-[12.5px] font-medium text-ink">
                        {t('onboarding.lockTitle')}
                      </p>
                      <p className="mt-0.5 text-[10.5px] leading-relaxed text-faint">
                        {t('onboarding.lockDesc')}
                      </p>
                    </div>
                    <span className="rounded-full border border-line px-2 py-1 text-[9.5px] text-faint">
                      {t('onboarding.lockCta')}
                    </span>
                  </div>

                  <div className="flex items-center gap-3 rounded-[16px] border border-dashed border-[var(--border)] p-3.5">
                    <ShieldCheck className="size-4 shrink-0 text-soft" aria-hidden />
                    <div>
                      <p className="text-[12px] font-medium text-ink">
                        {t('onboarding.privacyTitle')}
                      </p>
                      <p className="mt-0.5 text-[10.5px] text-faint">{t('onboarding.privacyDesc')}</p>
                    </div>
                  </div>
                </div>

                <div className="mt-7 flex items-center gap-2">
                  <Button
                    variant="ghost"
                    size="lg"
                    icon={<ArrowLeft />}
                    onClick={() => setStep(1)}
                  >
                    {t('onboarding.back')}
                  </Button>
                  <Button
                    variant="primary"
                    size="lg"
                    icon={<Check />}
                    loading={saving}
                    onClick={() => void finish()}
                  >
                    {t('onboarding.finish')}
                  </Button>
                </div>
              </>
            )}
          </section>

          <section className="relative hidden min-h-[430px] xl:block" aria-hidden>
            {step === 0 && <WelcomeVisual />}
            {step === 1 && <PreviewVisual />}
            {step === 2 && <PrivacyVisual />}
          </section>
        </main>

        <footer className="flex items-center justify-between gap-4 border-t border-[var(--border)] pt-4 pb-1">
          <div className="flex items-center gap-1.5">
            {STEPS.map((index) => (
              <button
                key={index}
                type="button"
                onClick={() => index <= step && setStep(index)}
                aria-label={t('onboarding.step', { current: index + 1, total: STEPS.length })}
                aria-current={index === step ? 'step' : undefined}
                className={cn(
                  'h-[3px] rounded-full transition-all duration-500',
                  index === step
                    ? 'w-7 bg-accent'
                    : index < step
                      ? 'w-3 bg-[var(--text-tertiary)]'
                      : 'w-3 bg-[var(--border-strong)]',
                )}
              />
            ))}
          </div>
          <span className="inline-flex items-center gap-1.5 text-[10px] text-faint">
            <ShieldCheck className="size-3" aria-hidden />
            {t('onboarding.privacyNote')}
          </span>
        </footer>
      </div>
    </div>
  );
}

/** Small feature tile on the welcome step. */
function Feature({
  icon,
  title,
  description,
}: {
  icon: React.ReactNode;
  title: string;
  description: string;
}) {
  return (
    <div className="glass rounded-[14px] p-3">
      <span className="grid size-7 place-items-center rounded-lg border border-line text-soft [&_svg]:size-3.5">
        {icon}
      </span>
      <p className="mt-2.5 text-[11.5px] font-medium text-ink">{title}</p>
      <p className="mt-1 text-[10px] leading-relaxed text-faint">{description}</p>
    </div>
  );
}

/** Selectable theme tile with a tiny palette preview. */
function ThemeCard({
  label,
  icon,
  active,
  onClick,
  tone,
}: {
  label: string;
  icon: React.ReactNode;
  active: boolean;
  onClick: () => void;
  tone: 'dark' | 'light' | 'split';
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      aria-pressed={active}
      className={cn(
        'group relative overflow-hidden rounded-[14px] border p-2.5 text-left transition-all duration-300',
        active
          ? 'border-[var(--text-tertiary)] bg-[var(--glass-strong)]'
          : 'border-line bg-[var(--glass)] hover:border-line-strong',
      )}
    >
      <div
        className={cn(
          'relative flex h-[52px] w-full items-end gap-1 overflow-hidden rounded-[8px] border border-line p-1.5',
          tone === 'dark' && 'bg-[#0b0b0d]',
          tone === 'light' && 'bg-[#f0f0ec]',
          tone === 'split' && 'bg-gradient-to-r from-[#0b0b0d] to-[#f0f0ec]',
        )}
      >
        <span
          className={cn(
            'h-4 w-2 rounded-[2px]',
            tone === 'light' ? 'bg-black/10' : 'bg-white/10',
          )}
        />
        <span className="flex flex-1 flex-col gap-1">
          <span
            className={cn('h-1.5 w-3/4 rounded-full', tone === 'light' ? 'bg-black/15' : 'bg-white/20')}
          />
          <span
            className={cn('h-1.5 w-1/2 rounded-full', tone === 'light' ? 'bg-black/10' : 'bg-white/10')}
          />
        </span>
      </div>
      <div className="mt-2 flex items-center gap-1.5 text-[11px] font-medium text-soft">
        <span className="[&_svg]:size-3">{icon}</span>
        {label}
      </div>
      {active && (
        <span className="absolute top-2 right-2 grid size-4 place-items-center rounded-full bg-accent text-accent-ink">
          <Check className="size-2.5" aria-hidden />
        </span>
      )}
    </button>
  );
}

/** Welcome orbit composition. */
function WelcomeVisual() {
  const brands = ['whatsapp', 'telegram', 'instagram', 'discord', 'slack', 'x'];
  const positions = [
    'top-[6%] left-[20%]',
    'top-[12%] right-[16%]',
    'top-[46%] left-[4%]',
    'top-[42%] right-[3%]',
    'bottom-[9%] left-[22%]',
    'bottom-[13%] right-[18%]',
  ];
  return (
    <div className="absolute inset-0">
      <div className="absolute top-1/2 left-1/2 size-[390px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border)]" />
      <div className="absolute top-1/2 left-1/2 size-[290px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border)]" />
      <div className="absolute top-1/2 left-1/2 size-[190px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border-strong)]" />
      <div className="orbit absolute top-1/2 left-1/2 size-[390px] -translate-x-1/2 -translate-y-1/2 rounded-full">
        <span className="absolute top-[4%] left-[26%] size-1.5 rounded-full bg-[var(--text-secondary)]" />
      </div>
      <div className="orbit-reverse absolute top-1/2 left-1/2 size-[290px] -translate-x-1/2 -translate-y-1/2 rounded-full">
        <span className="absolute right-[9%] bottom-[7%] size-1 rounded-full bg-[var(--text-tertiary)]" />
      </div>

      <div className="glass-strong absolute top-1/2 left-1/2 grid size-[146px] -translate-x-1/2 -translate-y-1/2 place-items-center rounded-full shadow-[0_40px_100px_-50px_rgba(0,0,0,0.95)]">
        <span className="lock-aura absolute inset-3 rounded-full border border-[var(--border-strong)]" />
        <Logo size={52} />
      </div>

      {brands.map((kind, index) => (
        <span
          key={kind}
          className={cn(
            'glass-strong float-slow absolute grid size-11 place-items-center rounded-[14px] text-soft shadow-[0_20px_50px_-30px_rgba(0,0,0,0.9)]',
            positions[index],
          )}
          style={{ animationDelay: `${index * 0.55}s` }}
        >
          <ServiceIcon kind={kind} size={19} />
        </span>
      ))}

      <div className="glass absolute bottom-0 left-1/2 flex -translate-x-1/2 items-center gap-2 rounded-full px-3 py-1.5 text-[9.5px] text-faint">
        <span className="size-1 rounded-full bg-[var(--success)]" />
        Local-first · End-to-end OS encryption
      </div>
    </div>
  );
}

/** A miniature Mesvee window used to preview appearance choices. */
function PreviewVisual() {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="glass-strong relative w-full max-w-[430px] overflow-hidden rounded-[22px] shadow-[0_50px_130px_-60px_rgba(0,0,0,0.95)]">
        <div className="flex h-8 items-center gap-1.5 border-b border-[var(--border)] px-3">
          <span className="size-1.5 rounded-full bg-[var(--text-tertiary)]" />
          <span className="size-1.5 rounded-full bg-[var(--text-tertiary)]" />
          <span className="size-1.5 rounded-full bg-[var(--text-tertiary)]" />
          <span className="ml-2 text-[8px] tracking-[0.12em] text-faint uppercase">mesvee</span>
        </div>
        <div className="flex h-[286px]">
          <div className="flex w-12 flex-col items-center gap-2 border-r border-[var(--border)] py-3">
            <span className="grid size-7 place-items-center rounded-lg bg-accent text-accent-ink">
              <Logo size={13} />
            </span>
            {['whatsapp', 'telegram', 'instagram', 'slack'].map((kind, index) => (
              <span
                key={kind}
                className={cn(
                  'grid size-7 place-items-center rounded-lg border text-soft',
                  index === 1
                    ? 'border-[var(--border-strong)] bg-[var(--glass-hover)] text-ink'
                    : 'border-transparent',
                )}
              >
                <ServiceIcon kind={kind} size={12} />
              </span>
            ))}
          </div>
          <div className="flex-1 p-4">
            <p className="eyebrow">{t('home.workspaceTitle')}</p>
            <p className="mt-2 text-[17px] leading-tight font-medium tracking-[-0.04em] text-ink">
              {t('home.headlineOne')}
              <br />
              <span className="text-[var(--text-tertiary)]">{t('home.headlineTwo')}</span>
            </p>
            <div className="mt-4 grid grid-cols-2 gap-2">
              {['whatsapp', 'telegram'].map((kind, index) => (
                <div key={kind} className="glass rounded-[11px] p-2.5">
                  <div className="flex items-center justify-between">
                    <span className="grid size-6 place-items-center rounded-md border border-line">
                      <ServiceIcon kind={kind} size={11} />
                    </span>
                    <span className="mono text-[8px] text-faint">0{index + 3}</span>
                  </div>
                  <p className="mt-3 text-[9px] font-medium text-ink">
                    {kind === 'whatsapp' ? 'WhatsApp' : 'Telegram'}
                  </p>
                  <p className="mt-0.5 text-[7.5px] text-faint">{t('titlebar.connected')}</p>
                </div>
              ))}
            </div>
            <div className="mt-2 flex items-center gap-2 rounded-[9px] border border-line px-2.5 py-2">
              <ShieldCheck className="size-3 text-soft" aria-hidden />
              <span className="text-[8px] text-faint">{t('home.footerPrivacy')}</span>
            </div>
          </div>
        </div>
      </div>
    </div>
  );
}

/** Lock-focused composition for the final step. */
function PrivacyVisual() {
  const { t } = useTranslation();
  return (
    <div className="absolute inset-0 flex items-center justify-center">
      <div className="relative flex size-[380px] items-center justify-center rounded-full border border-[var(--border)]">
        <div className="absolute inset-8 rounded-full border border-[var(--border)]" />
        <div className="absolute inset-20 rounded-full border border-[var(--border-strong)]" />
        <div className="orbit absolute inset-0 rounded-full">
          <span className="absolute top-[9%] left-[18%] size-1.5 rounded-full bg-[var(--text-secondary)]" />
          <span className="absolute right-[12%] bottom-[20%] size-1 rounded-full bg-[var(--text-tertiary)]" />
        </div>
        <div className="glass-strong relative z-10 flex w-[240px] flex-col items-center rounded-[26px] p-6 shadow-[0_40px_100px_-50px_rgba(0,0,0,0.95)]">
          <span className="grid size-12 place-items-center rounded-2xl border border-line bg-[var(--glass)] text-ink">
            <LockKeyhole className="size-5" aria-hidden />
          </span>
          <p className="mt-4 text-center text-[13px] font-medium text-ink">{t('lock.title')}</p>
          <p className="mt-1 text-center text-[10px] leading-relaxed text-faint">
            {t('lock.subtitle')}
          </p>
          <div className="mt-5 flex gap-2">
            {[0, 1, 2, 3].map((dot) => (
              <span
                key={dot}
                className={cn(
                  'size-2 rounded-full border',
                  dot < 3
                    ? 'border-transparent bg-accent'
                    : 'border-[var(--border-strong)] bg-transparent',
                )}
              />
            ))}
          </div>
          <div className="mt-5 grid w-full grid-cols-3 gap-1.5">
            {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
              <span
                key={digit}
                className="grid h-7 place-items-center rounded-md border border-line bg-[var(--glass)] font-mono text-[9px] text-soft"
              >
                {digit}
              </span>
            ))}
          </div>
        </div>
      </div>
    </div>
  );
}
