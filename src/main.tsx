import { StrictMode } from 'react';
import { createRoot } from 'react-dom/client';
import './core/i18n';
import './index.css';
import { App } from './App';
import { ErrorBoundary } from './app/ErrorBoundary';
import { applyTheme } from './lib/appearance';

/**
 * Renderer entrypoint. Applies a default dark palette before the first paint
 * to avoid a flash, then mounts the guarded React tree.
 */
applyTheme('system');

const container = document.getElementById('root');
if (!container) {
  throw new Error('Mesvee root container is missing from index.html');
}

createRoot(container).render(
  <StrictMode>
    <ErrorBoundary>
      <App />
    </ErrorBoundary>
  </StrictMode>,
);
