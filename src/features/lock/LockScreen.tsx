import { useCallback, useEffect, useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import {
  ArrowLeft,
  Delete,
  KeyRound,
  LockKeyhole,
  Maximize2,
  Minus,
  ShieldCheck,
  Unlock,
  X,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { toCommandError } from '../../core/types';
import { Button, IconButton } from '../../ui/Button';
import { Input } from '../../ui/Form';
import { Logo } from '../../ui/Logo';
import { cn } from '../../lib/cn';
import { copyText } from '../../lib/clipboard';
import { detectPlatform } from '../../lib/platform';

/** Full-screen lock experience shown whenever Rust reports a locked workspace. */
export function LockScreen() {
  const { t } = useTranslation();
  const bridge = useAppStore((state) => state.bridge);
  const security = useAppStore((state) => state.security);
  const setSecurity = useAppStore((state) => state.setSecurity);
  const toast = useAppStore((state) => state.toast);

  const [mode, setMode] = useState<'pin' | 'recovery' | 'recovery-code'>('pin');
  const [pin, setPin] = useState('');
  const [recovery, setRecovery] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirmPin, setConfirmPin] = useState('');
  const [newRecovery, setNewRecovery] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [attempts, setAttempts] = useState<number | null>(null);
  const [busy, setBusy] = useState(false);
  const [shake, setShake] = useState(0);

  /** Countdown for the lockout period, driven by the backend timestamp. */
  const remaining = useMemo(() => {
    if (!security?.lockoutUntil) return 0;
    const delta = new Date(security.lockoutUntil).getTime() - Date.now();
    return Math.max(0, Math.ceil(delta / 1000));
  }, [security?.lockoutUntil, shake]);

  useEffect(() => {
    if (remaining <= 0) return undefined;
    const timer = window.setInterval(() => setShake((value) => value + 1), 1000);
    return () => window.clearInterval(timer);
  }, [remaining]);

  /** Verifies the PIN with Rust and unlocks on success. */
  const unlock = useCallback(async () => {
    if (pin.length < 4 || busy) return;
    setBusy(true);
    setError(null);
    try {
      const status = await bridge.unlockApp(pin);
      setSecurity(status);
      setPin('');
    } catch (caught) {
      const normalized = toCommandError(caught);
      const detailAttempts = (normalized.details as { attemptsRemaining?: number } | undefined)
        ?.attemptsRemaining;
      setError(normalized.message);
      if (typeof detailAttempts === 'number') setAttempts(detailAttempts);
      setPin('');
      setShake((value) => value + 1);
      void securityRefresh();
    } finally {
      setBusy(false);
    }
  }, [pin, busy, bridge, setSecurity]);

  /** Pulls the authoritative security status after a failed attempt. */
  const securityRefresh = async () => {
    try {
      const status = await bridge.securityStatus();
      setSecurity(status);
    } catch {
      /* non-critical */
    }
  };

  /** Resets the PIN using a valid recovery code. */
  const resetWithRecovery = async () => {
    if (busy || !recovery || newPin.length < 4 || newPin !== confirmPin) return;
    setBusy(true);
    setError(null);
    try {
      const result = await bridge.resetPinWithRecovery(recovery.trim(), newPin);
      setSecurity(result.status);
      setNewRecovery(result.recoveryCode);
      setMode('recovery-code');
      setRecovery('');
      setNewPin('');
      setConfirmPin('');
    } catch (caught) {
      setError(toCommandError(caught).message);
      setShake((value) => value + 1);
    } finally {
      setBusy(false);
    }
  };

  /** Handles keypad presses and keyboard input. */
  const press = (digit: string) => {
    setPin((value) => (value.length >= 8 ? value : value + digit));
    setError(null);
  };

  useEffect(() => {
    const handler = (event: KeyboardEvent) => {
      if (mode !== 'pin') return;
      if (/^[0-9]$/.test(event.key)) press(event.key);
      else if (event.key === 'Backspace') setPin((value) => value.slice(0, -1));
      else if (event.key === 'Enter') void unlock();
    };
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  });

  const lockedOut = remaining > 0;
  const platform = detectPlatform();

  return (
    <div className="app-canvas fixed inset-0 z-[80] flex items-center justify-center p-6">
      {/* Ambient rings */}
      <div aria-hidden className="pointer-events-none absolute inset-0 overflow-hidden">
        <div className="absolute top-1/2 left-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border)] opacity-50" />
        <div className="absolute top-1/2 left-1/2 size-[380px] -translate-x-1/2 -translate-y-1/2 rounded-full border border-[var(--border)] opacity-70" />
        <div className="orbit absolute top-1/2 left-1/2 size-[560px] -translate-x-1/2 -translate-y-1/2 rounded-full">
          <span className="absolute top-[6%] left-[22%] size-1.5 rounded-full bg-[var(--text-tertiary)]" />
          <span className="absolute right-[16%] bottom-[10%] size-1 rounded-full bg-[var(--text-tertiary)]" />
        </div>
      </div>

      {/* Frameless window controls stay reachable while locked. */}
      <div className="absolute top-0 right-0 flex items-center gap-1 p-2">
        {!platform || platform === 'web' ? null : platform !== 'macos' ? (
          <>
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
            <IconButton label={t('titlebar.close')} size="sm" onClick={() => void bridge.closeWindow()}>
              <X />
            </IconButton>
          </>
        ) : null}
      </div>

      <div className="relative z-10 grid w-full max-w-[820px] grid-cols-1 items-center gap-10 md:grid-cols-[1fr_360px]">
        {/* Brand column */}
        <div className="enter-rise hidden md:block">
          <Logo size={34} withWordmark />
          <h1 className="mt-8 text-[38px] leading-[0.98] font-medium tracking-[-0.055em] text-ink">
            {t('lock.title')}
          </h1>
          <p className="mt-3 max-w-[300px] text-pretty text-[13px] leading-relaxed text-soft">
            {t('lock.subtitle')}
          </p>
          <div className="mt-8 flex items-center gap-2.5 rounded-[14px] border border-line bg-[var(--glass)] p-3">
            <ShieldCheck className="size-4 shrink-0 text-soft" aria-hidden />
            <p className="text-[10.5px] leading-relaxed text-faint">{t('lock.storageNote')}</p>
          </div>
        </div>

        {/* Lock card */}
        <div className="glass-strong enter-scale w-full rounded-[26px] p-6 shadow-[0_50px_140px_-60px_rgba(0,0,0,0.95)]">
          <div className="flex flex-col items-center text-center">
            <span className="grid size-11 place-items-center rounded-[14px] border border-line bg-[var(--glass)] text-ink shadow-xs">
              <LockKeyhole className="size-5" aria-hidden />
            </span>
          </div>

          {mode === 'pin' && (
            <div key={shake} className={cn('mt-6', shake > 0 && error && 'shake')}>
              <p className="text-center text-[14px] font-medium text-ink">{t('lock.enterPin')}</p>
              <div className="mt-4 flex justify-center gap-2.5">
                {Array.from({ length: Math.max(4, pin.length) }).map((_, index) => (
                  <span
                    key={index}
                    className={cn(
                      'pin-dot size-3 rounded-full border',
                      index < pin.length
                        ? 'border-transparent bg-accent scale-110'
                        : 'border-[var(--border-strong)] bg-transparent',
                    )}
                  />
                ))}
              </div>

              <div className="mt-6 grid grid-cols-3 gap-2">
                {[1, 2, 3, 4, 5, 6, 7, 8, 9].map((digit) => (
                  <button
                    key={digit}
                    type="button"
                    disabled={lockedOut}
                    onClick={() => press(String(digit))}
                    className="interactive-ring grid h-11 place-items-center rounded-[13px] border border-line bg-[var(--glass)] font-mono text-[16px] text-ink hover:bg-[var(--glass-hover)] disabled:opacity-40"
                  >
                    {digit}
                  </button>
                ))}
                <button
                  type="button"
                  disabled={lockedOut}
                  onClick={() => setPin((value) => value.slice(0, -1))}
                  aria-label={t('lock.delete')}
                  className="interactive-ring grid h-11 place-items-center rounded-[13px] border border-line bg-[var(--glass)] text-soft hover:bg-[var(--glass-hover)] disabled:opacity-40"
                >
                  <Delete className="size-4" aria-hidden />
                </button>
                <button
                  type="button"
                  disabled={lockedOut}
                  onClick={() => press('0')}
                  className="interactive-ring grid h-11 place-items-center rounded-[13px] border border-line bg-[var(--glass)] font-mono text-[16px] text-ink hover:bg-[var(--glass-hover)] disabled:opacity-40"
                >
                  0
                </button>
                <button
                  type="button"
                  disabled={lockedOut || pin.length < 4 || busy}
                  onClick={() => void unlock()}
                  aria-label={t('lock.unlock')}
                  className="interactive-ring grid h-11 place-items-center rounded-[13px] border border-transparent bg-accent text-accent-ink hover:opacity-90 disabled:opacity-40"
                >
                  <Unlock className="size-4" aria-hidden />
                </button>
              </div>

              {lockedOut ? (
                <p className="mt-4 text-center text-[11.5px] text-danger">
                  {t('lock.lockedFor', { time: t('lock.seconds', { count: remaining }) })}
                </p>
              ) : error ? (
                <p role="alert" className="mt-4 text-center text-[11.5px] text-danger">
                  {error}
                  {attempts !== null && ` — ${t('lock.attempts', { count: attempts })}`}
                </p>
              ) : (
                <p className="mt-4 text-center text-[10.5px] text-faint">{t('lock.pinHint')}</p>
              )}

              <button
                type="button"
                onClick={() => {
                  setMode('recovery');
                  setError(null);
                }}
                className="mt-4 w-full text-center text-[11px] text-faint underline decoration-[var(--border-strong)] underline-offset-4 hover:text-soft"
              >
                {t('lock.recoveryLink')}
              </button>
            </div>
          )}

          {mode === 'recovery' && (
            <div className="mt-6">
              <button
                type="button"
                onClick={() => {
                  setMode('pin');
                  setError(null);
                }}
                className="inline-flex items-center gap-1.5 text-[11px] text-faint hover:text-soft"
              >
                <ArrowLeft className="size-3" aria-hidden />
                {t('lock.backToPin')}
              </button>
              <p className="mt-4 text-[14px] font-medium text-ink">{t('lock.recoveryTitle')}</p>
              <p className="mt-1 text-pretty text-[11.5px] leading-relaxed text-faint">
                {t('lock.recoveryDesc')}
              </p>
              <div className="mt-4 space-y-3">
                <Input
                  value={recovery}
                  onChange={(event) => setRecovery(event.target.value.toUpperCase())}
                  placeholder={t('lock.recoveryPlaceholder')}
                  className="mono h-10 tracking-[0.1em]"
                  data-autofocus
                />
                <Input
                  type="password"
                  inputMode="numeric"
                  value={newPin}
                  onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder={t('lock.newPin')}
                  className={cn('h-10', newPin && 'font-mono tracking-[0.2em] text-[14px]')}
                />
                <Input
                  type="password"
                  inputMode="numeric"
                  value={confirmPin}
                  onChange={(event) => setConfirmPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                  placeholder={t('lock.confirmPin')}
                  className={cn('h-10', confirmPin && 'font-mono tracking-[0.2em] text-[14px]')}
                  invalid={confirmPin.length > 0 && confirmPin !== newPin}
                />
              </div>
              {error && (
                <p role="alert" className="mt-3 text-[11px] text-danger">
                  {error}
                </p>
              )}
              <Button
                variant="primary"
                size="lg"
                className="mt-5 w-full"
                loading={busy}
                disabled={!recovery || newPin.length < 4 || newPin !== confirmPin}
                onClick={() => void resetWithRecovery()}
              >
                {t('lock.resetUnlock')}
              </Button>
            </div>
          )}

          {mode === 'recovery-code' && newRecovery && (
            <div className="mt-6">
              <span className="grid size-10 place-items-center rounded-[13px] border border-line bg-[var(--glass)] text-ink">
                <KeyRound className="size-5" aria-hidden />
              </span>
              <p className="mt-4 text-[14px] font-medium text-ink">{t('lock.newRecoveryTitle')}</p>
              <p className="mt-1 text-pretty text-[11.5px] leading-relaxed text-faint">
                {t('lock.newRecoveryDesc')}
              </p>
              <div className="mono mt-4 rounded-[13px] border border-line bg-[var(--glass)] p-4 text-center text-[16px] tracking-[0.14em] text-ink">
                {newRecovery}
              </div>
              <div className="mt-4 flex gap-2">
                <Button
                  variant="secondary"
                  className="flex-1"
                  onClick={() => {
                    void copyText(newRecovery).then((ok) =>
                      toast({
                        tone: ok ? 'success' : 'error',
                        title: ok ? t('lock.copiedToast') : t('toasts.clipboardUnavailable'),
                      }),
                    );
                  }}
                >
                  {t('common.copy')}
                </Button>
                <Button
                  variant="primary"
                  className="flex-1"
                  onClick={() => {
                    setMode('pin');
                    setNewRecovery(null);
                  }}
                >
                  {t('common.done')}
                </Button>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
