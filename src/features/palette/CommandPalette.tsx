import { useEffect, useMemo, useRef, useState } from 'react';
import type { ReactNode } from 'react';
import { useTranslation } from 'react-i18next';
import { createPortal } from 'react-dom';
import {
  ArrowUpRight,
  BellOff,
  BellRing,
  Command,
  Globe2,
  LockKeyhole,
  Monitor,
  Moon,
  Plus,
  Search,
  Settings2,
  Sun,
  Home,
} from 'lucide-react';
import { useAppStore } from '../../core/store';
import { ServiceIcon } from '../../ui/ServiceIcon';
import { cn } from '../../lib/cn';
import type { Theme } from '../../core/types';

/** One searchable entry in the palette. */
interface PaletteItem {
  id: string;
  group: string;
  label: string;
  hint?: string;
  icon: ReactNode;
  keywords: string;
  run: () => void;
}

/**
 * Command palette (⌘K / Ctrl+K). It centralizes navigation and the most common
 * actions so power users never have to hunt through menus.
 */
export function CommandPalette({ open, onClose }: { open: boolean; onClose: () => void }) {
  const { t } = useTranslation();
  const settings = useAppStore((state) => state.settings);
  const catalog = useAppStore((state) => state.catalog);
  const security = useAppStore((state) => state.security);
  const openService = useAppStore((state) => state.openService);
  const openSettings = useAppStore((state) => state.openSettings);
  const goHome = useAppStore((state) => state.goHome);
  const setAddServiceOpen = useAppStore((state) => state.setAddServiceOpen);
  const saveSettings = useAppStore((state) => state.saveSettings);
  const checkForUpdate = useAppStore((state) => state.checkForUpdate);
  const lockNow = useAppStore((state) => state.lockNow);

  const [query, setQuery] = useState('');
  const [cursor, setCursor] = useState(0);
  const inputRef = useRef<HTMLInputElement>(null);
  const listRef = useRef<HTMLDivElement>(null);

  const theme = settings?.appearance.theme ?? 'dark';
  const focusMode = settings?.notifications.focusMode ?? false;

  /** Builds the full action list; recalculated when context changes. */
  const items = useMemo<PaletteItem[]>(() => {
    if (!settings) return [];
    const list: PaletteItem[] = [];

    for (const service of settings.services) {
      const runtime = useAppStore.getState().serviceStates[service.id];
      list.push({
        id: `service-${service.id}`,
        group: t('palette.services'),
        label: service.label,
        hint: runtime?.unread ? t('rail.unread', { count: runtime.unread }) : undefined,
        icon: <ServiceIcon kind={service.kind} size={16} />,
        keywords: `${service.label} ${service.kind}`,
        run: () => void openService(service.id),
      });
    }

    list.push(
      {
        id: 'home',
        group: t('palette.navigation'),
        label: t('palette.home'),
        icon: <Home size={16} strokeWidth={1.8} />,
        keywords: t('palette.home'),
        run: goHome,
      },
      {
        id: 'add',
        group: t('palette.actions'),
        label: t('palette.addService'),
        icon: <Plus size={16} strokeWidth={1.8} />,
        keywords: t('palette.addService'),
        run: () => setAddServiceOpen(true),
      },
    );

    for (const entry of catalog) {
      list.push({
        id: `catalog-${entry.kind}`,
        group: t('palette.actions'),
        label: `${t('common.add')} ${entry.name}`,
        hint: entry.name,
        icon: <ServiceIcon kind={entry.kind} size={16} />,
        keywords: `add ${entry.name} ${entry.kind}`,
        run: () => setAddServiceOpen(true),
      });
    }

    list.push(
      {
        id: 'lock',
        group: t('palette.actions'),
        label: t('palette.lockApp'),
        icon: <LockKeyhole size={16} strokeWidth={1.8} />,
        keywords: t('palette.lockApp'),
        run: () => (security?.configured ? void lockNow() : openSettings('security')),
      },
      {
        id: 'focus',
        group: t('palette.actions'),
        label: focusMode ? t('palette.focusOff') : t('palette.focusOn'),
        icon: focusMode ? <BellRing size={16} strokeWidth={1.8} /> : <BellOff size={16} strokeWidth={1.8} />,
        keywords: 'focus notifications',
        run: () => {
          void saveSettings({ notifications: { ...settings.notifications, focusMode: !focusMode } });
        },
      },
      {
        id: 'theme',
        group: t('palette.actions'),
        label:
          theme === 'system'
            ? t('palette.themeDark')
            : theme === 'dark'
              ? t('palette.themeLight')
              : t('palette.themeSystem'),
        icon:
          theme === 'system' ? (
            <Monitor size={16} strokeWidth={1.8} />
          ) : theme === 'dark' ? (
            <Moon size={16} strokeWidth={1.8} />
          ) : (
            <Sun size={16} strokeWidth={1.8} />
          ),
        keywords: 'theme dark light system',
        run: () => {
          const next: Theme = theme === 'system' ? 'dark' : theme === 'dark' ? 'light' : 'system';
          void saveSettings({ appearance: { ...settings.appearance, theme: next } });
        },
      },
      {
        id: 'update',
        group: t('palette.actions'),
        label: t('palette.checkUpdates'),
        icon: <Globe2 size={16} strokeWidth={1.8} />,
        keywords: t('palette.checkUpdates'),
        run: () => {
          openSettings('updates');
          void checkForUpdate();
        },
      },
    );

    const sections = [
      ['general', 'palette.general', 'palette.settings'],
      ['appearance', 'palette.appearance', 'palette.settings'],
      ['notifications', 'palette.notifications', 'palette.settings'],
      ['security', 'palette.security', 'palette.settings'],
      ['updates', 'palette.updates', 'palette.settings'],
      ['advanced', 'palette.advanced', 'palette.settings'],
      ['about', 'palette.about', 'palette.settings'],
    ] as const;

    for (const [section, labelKey, group] of sections) {
      list.push({
        id: `settings-${section}`,
        group: t(group),
        label: `${t('palette.settings')} — ${t(labelKey)}`,
        icon: <Settings2 size={16} strokeWidth={1.8} />,
        keywords: `${t(labelKey)} settings`,
        run: () => openSettings(section),
      });
    }

    return list;
  }, [settings, catalog, security, theme, focusMode, t, openService, openSettings, goHome, setAddServiceOpen, saveSettings, checkForUpdate, lockNow]);

  /** Simple case-insensitive substring match over label + keywords. */
  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    if (!normalized) return items.slice(0, 40);
    return items
      .filter((item) => `${item.label} ${item.keywords} ${item.group}`.toLowerCase().includes(normalized))
      .slice(0, 40);
  }, [items, query]);

  useEffect(() => {
    if (open) {
      setQuery('');
      setCursor(0);
      requestAnimationFrame(() => inputRef.current?.focus());
    }
  }, [open]);

  useEffect(() => setCursor(0), [query]);

  /** Keeps the highlighted row visible while arrowing through results. */
  useEffect(() => {
    const element = listRef.current?.querySelector<HTMLElement>(`[data-index="${cursor}"]`);
    element?.scrollIntoView({ block: 'nearest' });
  }, [cursor]);

  if (!open) return null;

  /** Runs the selected item and dismisses the palette. */
  const run = (item: PaletteItem | undefined) => {
    if (!item) return;
    item.run();
    onClose();
  };

  /** Groups the filtered results while preserving order. */
  const groups = filtered.reduce<Record<string, PaletteItem[]>>((acc, item) => {
    (acc[item.group] ??= []).push(item);
    return acc;
  }, {});

  let flatIndex = -1;

  return createPortal(
    <div
      className="modal-backdrop fixed inset-0 z-[60] flex items-start justify-center p-6 pt-[14vh]"
      onMouseDown={(event) => {
        if (event.target === event.currentTarget) onClose();
      }}
    >
      <div
        role="dialog"
        aria-modal="true"
        aria-label={t('palette.searchLabel')}
        className="glass-strong enter-scale w-full max-w-[560px] overflow-hidden rounded-[20px] shadow-[0_50px_140px_-50px_rgba(0,0,0,0.95)]"
      >
        <div className="flex items-center gap-3 border-b border-[var(--border)] px-4">
          {/* The palette row is its own field surface, so the input opts out of
              the global focus ring (`field-control`): that ring hugged the bare
              input and drew an offset rectangle over the search icon. */}
          <Search className="size-4 shrink-0 text-faint" aria-hidden />
          <input
            ref={inputRef}
            value={query}
            onChange={(event) => setQuery(event.target.value)}
            placeholder={t('palette.placeholder')}
            aria-label={t('palette.searchLabel')}
            className="field-control h-12 min-w-0 flex-1 bg-transparent text-[13.5px] text-ink outline-none placeholder:text-faint"
            onKeyDown={(event) => {
              if (event.key === 'ArrowDown') {
                event.preventDefault();
                setCursor((value) => Math.min(value + 1, filtered.length - 1));
              } else if (event.key === 'ArrowUp') {
                event.preventDefault();
                setCursor((value) => Math.max(value - 1, 0));
              } else if (event.key === 'Enter') {
                event.preventDefault();
                run(filtered[cursor]);
              } else if (event.key === 'Escape') {
                event.preventDefault();
                onClose();
              }
            }}
          />
          <span className="mono hidden rounded-md border border-line px-1.5 py-0.5 text-[9px] text-faint sm:block">
            ESC
          </span>
        </div>

        <div ref={listRef} className="scrollbar-compact max-h-[46vh] overflow-y-auto p-2">
          {filtered.length === 0 ? (
            <p className="px-3 py-8 text-center text-[12px] text-faint">
              {t('palette.noResults', { query })}
            </p>
          ) : (
            Object.entries(groups).map(([group, groupItems]) => (
              <div key={group} className="mb-1.5">
                <p className="eyebrow px-3 pt-2 pb-1">{group}</p>
                {groupItems.map((item) => {
                  flatIndex += 1;
                  const index = flatIndex;
                  return (
                    <button
                      key={item.id}
                      type="button"
                      data-index={index}
                      onMouseMove={() => setCursor(index)}
                      onClick={() => run(item)}
                      className={cn(
                        'flex w-full items-center gap-3 rounded-[11px] px-3 py-2 text-left transition-colors',
                        index === cursor ? 'bg-[var(--glass-hover)]' : 'hover:bg-[var(--glass)]',
                      )}
                    >
                      <span className="grid size-7 shrink-0 place-items-center rounded-[9px] border border-line bg-[var(--glass)] text-soft">
                        {item.icon}
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[12.5px] font-medium text-ink">
                          {item.label}
                        </span>
                        {item.hint && (
                          <span className="block truncate text-[10.5px] text-faint">{item.hint}</span>
                        )}
                      </span>
                      {index === cursor && (
                        <ArrowUpRight className="size-3.5 shrink-0 text-faint" aria-hidden />
                      )}
                    </button>
                  );
                })}
              </div>
            ))
          )}
        </div>

        <div className="flex items-center justify-between border-t border-[var(--border)] px-4 py-2.5">
          <span className="inline-flex items-center gap-1.5 text-[10px] text-faint">
            <Command className="size-3" aria-hidden />
            mesvee palette
          </span>
          <span className="flex items-center gap-3 text-[9.5px] text-faint">
            <span>↑↓ {t('palette.hintNavigate')}</span>
            <span>↵ {t('palette.hintSelect')}</span>
            <span>esc {t('palette.hintClose')}</span>
          </span>
        </div>
      </div>
    </div>,
    document.body,
  );
}
