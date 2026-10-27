import { useMemo, useState } from 'react';
import { useTranslation } from 'react-i18next';
import { Check, Plus, Search } from 'lucide-react';
import { useAppStore } from '../../core/store';
import { Modal } from '../../ui/Modal';
import { Button } from '../../ui/Button';
import { Input } from '../../ui/Form';
import { ServiceIcon } from '../../ui/ServiceIcon';
import { cn } from '../../lib/cn';
import type { ServiceCategory } from '../../core/types';

/** Hard cap mirrored from the Rust core. */
const MAX_SERVICES = 16;

/**
 * Maps a catalog kind to its typed description key. Keeping this explicit
 * preserves compile-time translation checking for every supported service.
 */
const CATALOG_DESC_KEYS = {
  whatsapp: 'catalog.whatsapp',
  telegram: 'catalog.telegram',
  messenger: 'catalog.messenger',
  instagram: 'catalog.instagram',
  x: 'catalog.x',
  discord: 'catalog.discord',
  slack: 'catalog.slack',
  linkedin: 'catalog.linkedin',
  teams: 'catalog.teams',
  element: 'catalog.element',
  googleChat: 'catalog.googleChat',
  facebook: 'catalog.facebook',
  threads: 'catalog.threads',
  bluesky: 'catalog.bluesky',
  tiktok: 'catalog.tiktok',
} as const;

/** Returns the translated one-line description for a catalog kind. */
function catalogDescription(kind: string, translate: (key: string) => string): string {
  const key = CATALOG_DESC_KEYS[kind as keyof typeof CATALOG_DESC_KEYS];
  return key ? translate(key) : kind;
}

/** Category filter options. */
type Filter = 'all' | ServiceCategory;

/** Dialog for adding a catalog service with an optional custom label. */
export function AddServiceDialog() {
  const { t } = useTranslation();
  const open = useAppStore((state) => state.addServiceOpen);
  const setOpen = useAppStore((state) => state.setAddServiceOpen);
  const catalog = useAppStore((state) => state.catalog);
  const settings = useAppStore((state) => state.settings);
  const addService = useAppStore((state) => state.addService);
  const openService = useAppStore((state) => state.openService);
  const toast = useAppStore((state) => state.toast);

  const [selected, setSelected] = useState<string | null>(null);
  const [label, setLabel] = useState('');
  const [query, setQuery] = useState('');
  const [filter, setFilter] = useState<Filter>('all');
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const count = settings?.services.length ?? 0;
  const full = count >= MAX_SERVICES;
  const selectedEntry = catalog.find((entry) => entry.kind === selected);

  const filtered = useMemo(() => {
    const normalized = query.trim().toLowerCase();
    return catalog.filter((entry) => {
      const matchesFilter = filter === 'all' || entry.category === filter;
      const matchesQuery =
        !normalized ||
        entry.name.toLowerCase().includes(normalized) ||
        catalogDescription(entry.kind, (key) => t(key as 'catalog.whatsapp')).toLowerCase().includes(normalized);
      return matchesFilter && matchesQuery;
    });
  }, [catalog, filter, query, t]);

  /** Adds the selected service and switches into it. */
  const submit = async () => {
    if (!selected || busy) return;
    setBusy(true);
    setError(null);
    const entry = catalog.find((item) => item.kind === selected);
    const displayName = label.trim() || entry?.name || selected;
    try {
      const result = await addService(selected, label.trim() || undefined);
      toast({ tone: 'success', title: t('toasts.serviceAdded', { name: displayName }) });
      setOpen(false);
      setSelected(null);
      setLabel('');
      void openService(result.serviceId);
    } catch (caught) {
      setError(String(caught));
    } finally {
      setBusy(false);
    }
  };

  const FILTERS: { value: Filter; label: string }[] = [
    { value: 'all', label: t('catalog.all') },
    { value: 'messaging', label: t('catalog.messaging') },
    { value: 'social', label: t('catalog.social') },
    { value: 'work', label: t('catalog.work') },
  ];

  return (
    <Modal
      open={open}
      onClose={() => setOpen(false)}
      title={t('catalog.addTitle')}
      description={t('catalog.addDesc')}
      size="lg"
      footer={
        <>
          <Button variant="ghost" onClick={() => setOpen(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            variant="primary"
            icon={<Plus />}
            loading={busy}
            disabled={!selected || full}
            onClick={() => void submit()}
          >
            {t('catalog.add')}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          placeholder={t('catalog.searchPlaceholder')}
          leading={<Search />}
          className="h-9 min-w-[200px] flex-1"
          data-autofocus
        />
        <div className="inline-flex rounded-[10px] border border-line bg-[var(--glass)] p-[3px]">
          {FILTERS.map((option) => (
            <button
              key={option.value}
              type="button"
              onClick={() => setFilter(option.value)}
              aria-pressed={filter === option.value}
              className={cn(
                'h-6 rounded-[7px] px-2.5 text-[11px] font-medium transition-colors',
                filter === option.value ? 'bg-accent text-accent-ink' : 'text-soft hover:text-ink',
              )}
            >
              {option.label}
            </button>
          ))}
        </div>
      </div>

      {full ? (
        <p className="mt-6 rounded-xl border border-line bg-[var(--glass)] p-4 text-center text-[12px] text-soft">
          {t('catalog.limitReached', { count: MAX_SERVICES })}
        </p>
      ) : (
        <>
          <div className="scrollbar-compact mt-4 grid max-h-[300px] grid-cols-2 gap-2 overflow-y-auto pr-1 sm:grid-cols-3">
            {filtered.map((entry) => {
              const active = selected === entry.kind;
              return (
                <button
                  key={entry.kind}
                  type="button"
                  onClick={() => {
                    setSelected(entry.kind);
                    setLabel('');
                  }}
                  aria-pressed={active}
                  className={cn(
                    'group relative flex flex-col items-start gap-2 rounded-[14px] border p-3 text-left transition-all duration-200',
                    active
                      ? 'border-[var(--text-tertiary)] bg-[var(--glass-strong)]'
                      : 'border-line bg-[var(--glass)] hover:border-line-strong hover:bg-[var(--glass-hover)]',
                  )}
                >
                  <span
                    className={cn(
                      'grid size-9 place-items-center rounded-[11px] border transition-colors',
                      active
                        ? 'border-transparent bg-accent text-accent-ink'
                        : 'border-line bg-[var(--glass)] text-ink',
                    )}
                  >
                    <ServiceIcon kind={entry.kind} size={17} />
                  </span>
                  <span className="min-w-0">
                    <span className="block truncate text-[12px] font-medium text-ink">
                      {entry.name}
                    </span>
                    <span className="mt-0.5 block truncate text-[10px] text-faint">
                      {catalogDescription(entry.kind, (key) => t(key as 'catalog.whatsapp'))}
                    </span>
                  </span>
                  {active && (
                    <span className="absolute top-2 right-2 grid size-4 place-items-center rounded-full bg-accent text-accent-ink">
                      <Check className="size-2.5" aria-hidden />
                    </span>
                  )}
                </button>
              );
            })}
          </div>

          {selected && selectedEntry && (
            <div className="mt-4 rounded-[14px] border border-line bg-[var(--glass)] p-3">
              <label htmlFor="service-label" className="text-[11.5px] font-medium text-ink">
                {t('catalog.label')}
              </label>
              <Input
                id="service-label"
                value={label}
                onChange={(event) => setLabel(event.target.value)}
                placeholder={selectedEntry.name}
                maxLength={40}
                className="mt-2 h-9"
              />
              <p className="mt-2 text-[10px] text-faint">{t('catalog.labelHint')}</p>
            </div>
          )}

          <p className="mt-3 text-[10.5px] leading-relaxed text-faint">
            {t('catalog.sessionNote')}
          </p>

          {error && (
            <p role="alert" className="mt-3 text-[11px] text-danger">
              {error}
            </p>
          )}
        </>
      )}
    </Modal>
  );
}
