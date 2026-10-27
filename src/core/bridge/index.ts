import { isTauriRuntime } from '../../lib/platform';
import { mockBridge } from './mock';
import { nativeBridge } from './native';
import type { MesveeBridge } from './types';

/**
 * Runtime bridge selection. The production webview always resolves to Tauri;
 * the mock is only used when the React app is opened in a plain browser for
 * design review and automated UI tests.
 */
export const bridge: MesveeBridge = isTauriRuntime() ? nativeBridge : mockBridge;

export type { MesveeBridge } from './types';
