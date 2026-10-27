import { Component } from 'react';
import type { ErrorInfo, ReactNode } from 'react';
import { CircleAlert, Copy, RotateCcw } from 'lucide-react';
import i18n from '../core/i18n';
import { bridge } from '../core/bridge';
import { copyText } from '../lib/clipboard';
import { Logo } from '../ui/Logo';
import { Button } from '../ui/Button';

/** Props for the renderer crash boundary. */
interface ErrorBoundaryProps {
  children: ReactNode;
}

/** State captured when React aborts a render tree. */
interface ErrorBoundaryState {
  error: Error | null;
  info: ErrorInfo | null;
  copied: boolean;
}

/**
 * Last line of defence for the renderer. Native crashes are handled by Rust and
 * the panic hook; this catches React render failures, persists them to the log
 * file, and gives the user a calm path back instead of a white screen.
 */
export class ErrorBoundary extends Component<ErrorBoundaryProps, ErrorBoundaryState> {
  state: ErrorBoundaryState = { error: null, info: null, copied: false };

  /** Captures the error and forwards a redacted summary to the native logger. */
  static getDerivedStateFromError(error: Error): Partial<ErrorBoundaryState> {
    return { error };
  }

  /** Records the component stack once React has unwound the tree. */
  componentDidCatch(error: Error, info: ErrorInfo): void {
    this.setState({ info });
    const context = `${error.stack ?? error.message}\n${info.componentStack ?? ''}`.slice(0, 4000);
    void bridge.log('error', 'renderer boundary caught an error', context).catch(() => undefined);
  }

  /** Copies technical details for a support ticket. */
  private readonly copyDetails = async (): Promise<void> => {
    const { error, info } = this.state;
    const details = `${error?.stack ?? error?.message ?? 'Unknown error'}\n\n${info?.componentStack ?? ''}`;
    const copied = await copyText(details);
    this.setState({ copied });
  };

  /** Renders the fallback UI or the protected application tree. */
  render(): ReactNode {
    const { error, info, copied } = this.state;

    if (!error) return this.props.children;

    return (
      <div className="app-canvas flex h-full items-center justify-center p-8">
        <div className="glass-strong enter-rise w-full max-w-[560px] rounded-[28px] p-8">
          <Logo size={30} withWordmark />
          <div className="mt-8 flex size-12 items-center justify-center rounded-2xl border border-line bg-[var(--glass)] text-danger">
            <CircleAlert className="size-5" aria-hidden />
          </div>
          <h1 className="mt-5 text-[26px] font-semibold tracking-[-0.04em] text-ink">
            {i18n.t('errors.boundaryTitle')}
          </h1>
          <p className="mt-2 max-w-md text-pretty text-[13px] leading-relaxed text-soft">
            {i18n.t('errors.boundaryDesc')}
          </p>

          <div className="mt-6 flex flex-wrap gap-2">
            <Button
              variant="primary"
              icon={<RotateCcw />}
              onClick={() => window.location.reload()}
            >
              {i18n.t('errors.reload')}
            </Button>
            <Button
              variant="secondary"
              icon={<Copy />}
              onClick={() => void this.copyDetails()}
            >
              {copied ? i18n.t('common.copied') : i18n.t('errors.copyDetails')}
            </Button>
          </div>

          <details className="group mt-7 rounded-xl border border-line bg-[var(--glass)] p-3">
            <summary className="cursor-pointer list-none text-[11px] font-medium text-faint">
              {i18n.t('errors.details')}
            </summary>
            <pre className="mt-3 max-h-44 overflow-auto whitespace-pre-wrap break-words font-mono text-[10px] leading-relaxed text-soft">
              {error.stack ?? error.message}
              {info?.componentStack}
            </pre>
          </details>
        </div>
      </div>
    );
  }
}
