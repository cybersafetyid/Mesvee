import { useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Copy, KeyRound, ShieldCheck } from 'lucide-react';
import { useAppStore } from '../../core/store';
import { toCommandError } from '../../core/types';
import { cn } from '../../lib/cn';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Field, Input } from '../../ui/Form';
import { copyText } from '../../lib/clipboard';

/** Which security operation the shared dialog is performing. */
export type SecurityDialogKind = 'enable' | 'disable' | 'change-pin' | 'regenerate';

/** Props for the security flow dialog. */
export interface SecurityDialogProps {
  kind: SecurityDialogKind;
  open: boolean;
  onClose: () => void;
}

/**
 * One dialog driving every PIN flow. Backend remains the source of truth for
 * verification; this component only collects input and renders the result.
 */
export function SecurityDialog({ kind, open, onClose }: SecurityDialogProps) {
  const { t } = useTranslation();
  const bridge = useAppStore((state) => state.bridge);
  const refreshSecurity = useAppStore((state) => state.refreshSecurity);
  const toast = useAppStore((state) => state.toast);

  const [pin, setPin] = useState('');
  const [newPin, setNewPin] = useState('');
  const [confirm, setConfirm] = useState('');
  const [recoveryCode, setRecoveryCode] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  /** Clears transient state whenever the dialog is (re)opened. */
  const reset = () => {
    setPin('');
    setNewPin('');
    setConfirm('');
    setRecoveryCode(null);
    setError(null);
  };

  const handleClose = () => {
    reset();
    onClose();
  };

  /** Runs the requested operation against Rust. */
  const submit = async () => {
    if (busy) return;
    setBusy(true);
    setError(null);
    try {
      if (kind === 'enable') {
        if (newPin !== confirm) throw new Error(t('settings.pinMismatch'));
        const result = await bridge.enableLock(newPin);
        setRecoveryCode(result.recoveryCode);
        await refreshSecurity();
        toast({ tone: 'success', title: t('settings.enableSuccess') });
      } else if (kind === 'disable') {
        await bridge.disableLock(pin);
        await refreshSecurity();
        toast({ tone: 'success', title: t('settings.disabledSuccess') });
        handleClose();
        return;
      } else if (kind === 'change-pin') {
        if (newPin !== confirm) throw new Error(t('settings.pinMismatch'));
        await bridge.changePin(pin, newPin);
        await refreshSecurity();
        toast({ tone: 'success', title: t('settings.changeSuccess') });
        handleClose();
        return;
      } else {
        const result = await bridge.regenerateRecovery(pin);
        setRecoveryCode(result.recoveryCode);
        await refreshSecurity();
        toast({ tone: 'success', title: t('settings.regenerateSuccess') });
      }
      // Recovery-code flows stay open so the user can copy the new code.
      setPin('');
      setNewPin('');
      setConfirm('');
    } catch (caught) {
      setError(toCommandError(caught).message);
    } finally {
      setBusy(false);
    }
  };

  const titles: Record<SecurityDialogKind, string> = {
    enable: t('settings.setPin'),
    disable: t('settings.disableLock'),
    'change-pin': t('settings.changePin'),
    regenerate: t('settings.regenerateRecovery'),
  };

  // After a successful enable/regenerate we show the one-time code.
  if (recoveryCode) {
    return (
      <Modal
        open={open}
        onClose={handleClose}
        title={t('settings.recoveryCodeTitle')}
        description={t('settings.recoveryCodeDesc')}
        size="sm"
        dismissible={false}
        footer={
          <Button variant="primary" onClick={handleClose}>
            {t('settings.recoverySaved')}
          </Button>
        }
      >
        <div className="mono rounded-[14px] border border-line bg-[var(--glass)] p-4 text-center text-[17px] tracking-[0.14em] text-ink select-all">
          {recoveryCode}
        </div>
        <Button
          variant="secondary"
          className="mt-3 w-full"
          icon={<Copy />}
          onClick={() => {
            void copyText(recoveryCode).then((ok) =>
              toast({
                tone: ok ? 'success' : 'error',
                title: ok ? t('toasts.copied') : t('toasts.copyFailed'),
              }),
            );
          }}
        >
          {t('settings.copyRecovery')}
        </Button>
      </Modal>
    );
  }

  const needsNewPin = kind === 'enable' || kind === 'change-pin';

  return (
    <Modal
      open={open}
      onClose={handleClose}
      title={titles[kind]}
      description={
        kind === 'disable'
          ? t('settings.disableConfirm')
          : kind === 'regenerate'
            ? t('settings.recoveryPending')
            : t('settings.pinPolicy')
      }
      size="sm"
      footer={
        <>
          <Button variant="ghost" onClick={handleClose}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            loading={busy}
            disabled={
              kind === 'disable' || kind === 'regenerate' ? pin.length < 4 : newPin.length < 4 || newPin !== confirm
            }
            onClick={() => void submit()}
          >
            {t('common.save')}
          </Button>
        </>
      }
    >
      <div className="space-y-3.5">
        {(kind === 'disable' || kind === 'change-pin' || kind === 'regenerate') && (
          <Field label={t('settings.currentPin')}>
            <Input
              type="password"
              inputMode="numeric"
              autoComplete="current-password"
              value={pin}
              onChange={(event) => setPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
              placeholder={t('settings.currentPin')}
              className={cn('h-10', pin && 'font-mono tracking-[0.2em] text-[14px]')}
              data-autofocus
            />
          </Field>
        )}
        {needsNewPin && (
          <>
            <Field label={t('settings.newPin')} hint={t('settings.pinPolicy')}>
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={newPin}
                onChange={(event) => setNewPin(event.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder={t('settings.newPin')}
                className={cn('h-10', newPin && 'font-mono tracking-[0.2em] text-[14px]')}
                data-autofocus={kind === 'enable' ? true : undefined}
              />
            </Field>
            <Field
              label={t('settings.confirmPin')}
              error={confirm.length > 0 && confirm !== newPin ? t('settings.pinMismatch') : undefined}
            >
              <Input
                type="password"
                inputMode="numeric"
                autoComplete="new-password"
                value={confirm}
                onChange={(event) => setConfirm(event.target.value.replace(/\D/g, '').slice(0, 8))}
                placeholder={t('settings.confirmPin')}
                className={cn('h-10', confirm && 'font-mono tracking-[0.2em] text-[14px]')}
                invalid={confirm.length > 0 && confirm !== newPin}
              />
            </Field>
          </>
        )}
        <div className="flex items-start gap-2.5 rounded-[12px] border border-line bg-[var(--glass)] p-3">
          <ShieldCheck className="mt-0.5 size-4 shrink-0 text-soft" aria-hidden />
          <p className="text-[11px] leading-relaxed text-faint">{t('settings.keychainNote')}</p>
        </div>
        {error && (
          <p role="alert" className="text-[11.5px] text-danger">
            {error}
          </p>
        )}
      </div>
    </Modal>
  );
}

/** Small status chip summarizing the lock state. */
export function LockStatusChip({ enabled }: { enabled: boolean }) {
  const { t } = useTranslation();
  return (
    <span
      className={
        enabled
          ? 'inline-flex items-center gap-1.5 rounded-full border border-line bg-[var(--glass)] px-2.5 py-1 text-[10px] text-soft'
          : 'inline-flex items-center gap-1.5 rounded-full border border-dashed border-line px-2.5 py-1 text-[10px] text-faint'
      }
    >
      <KeyRound className="size-3" aria-hidden />
      {enabled ? t('settings.lockEnabled') : t('settings.lockDisabled')}
    </span>
  );
}
