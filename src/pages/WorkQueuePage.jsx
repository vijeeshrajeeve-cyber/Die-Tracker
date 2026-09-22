import { useEffect, useState } from 'react';
import { ArrowLeft, ChevronLeft, ChevronRight, ClipboardCheck, RefreshCw, Search, Settings2, X } from 'lucide-react';
import useWorkQueue from '../hooks/useWorkQueue';
import QueueScopes from '../components/work-queue/QueueScopes';
import DeadlineFilters from '../components/work-queue/DeadlineFilters';
import WorkQueueTable from '../components/work-queue/WorkQueueTable';
import WorkItemDetail from '../components/work-queue/WorkItemDetail';
import WorkQueueSettings from '../components/work-queue/WorkQueueSettings';
import WorkQueueInbox from '../components/work-queue/WorkQueueInbox';
import { BUCKETS } from '../components/work-queue/view';
import { BRAND } from '../utils/brand';
import '../styles/work-queue.css';

export default function WorkQueuePage({ theme = {}, user, onOpenSource }) {
  const [scope, setScope] = useState('mine');
  const [bucket, setBucket] = useState('all');
  const [plant, setPlant] = useState('');
  const [search, setSearch] = useState('');
  const [q, setQuery] = useState('');
  const [page, setPage] = useState(1);
  const [selected, setSelected] = useState(null);
  const [settings, setSettings] = useState(false);
  const { data, loading, error, refresh } = useWorkQueue({ scope, bucket, plant, q, page });
  useEffect(() => {
    const timer = setTimeout(() => { setQuery(search.trim()); setPage(1); }, 250);
    return () => clearTimeout(timer);
  }, [search]);

  function changeScope(value) { setScope(value); setPage(1); }
  function changeBucket(value) { setBucket(value); setPage(1); }
  const visibleCount = data?.items?.length || 0;
  const start = visibleCount ? ((data.page || page) - 1) * 50 + 1 : 0;
  const end = visibleCount ? start + visibleCount - 1 : 0;
  const scopeTitle = { mine: 'Your work', team: 'Team work', unassigned: 'Unassigned work' }[scope];

  return <section className="work-queue" data-theme={theme.isDark ? 'dark' : 'light'} style={{
    '--wq-bg': theme.bg, '--wq-surface': theme.cardBg, '--wq-raised': theme.inputBg,
    '--wq-text': theme.text, '--wq-muted': theme.textMuted, '--wq-line': theme.border || theme.cardBorder,
    '--wq-hover': theme.rowHover, '--wq-accent': BRAND.navy,
  }}>
    <header className="wq-header">
      <div className="wq-heading"><div className="wq-icon-tile"><ClipboardCheck size={25} /></div><div><h1>{settings ? 'Deadline rules' : 'Work queue'}</h1><p>{settings ? 'Configure ownership, working calendars and coordination access.' : 'A clear next action. A named owner. An explainable deadline.'}</p></div></div>
      <div className="wq-actions">
        {settings ? <button type="button" className="wq-button" onClick={() => { setSettings(false); refresh(); }}><ArrowLeft size={16} />Back to queue</button> : <>
          <WorkQueueInbox onSelect={setSelected} />
          <button type="button" className="wq-button" onClick={refresh} disabled={loading}><RefreshCw size={16} className={loading ? 'wq-spin' : ''} />Refresh</button>
          {(data?.isAdmin || user?.role === 'admin') && <button type="button" className="wq-button" onClick={() => setSettings(true)}><Settings2 size={16} />Deadline rules</button>}
        </>}
      </div>
    </header>
    {settings ? <WorkQueueSettings theme={theme} onChanged={refresh} /> : <>
      <div className="wq-scope-row"><QueueScopes scope={scope} counts={data?.counts} onChange={changeScope} /><p className="wq-help">{scope === 'team' ? 'All current work you have permission to view.' : scope === 'unassigned' ? 'Work that needs an eligible named owner.' : 'Items assigned to you, including eligible approval work.'}</p></div>
      <DeadlineFilters bucket={bucket} counts={data?.counts?.buckets} onChange={changeBucket} />
      <div className="wq-card">
        <div className="wq-toolbar"><div><h2>{scopeTitle}{bucket !== 'all' ? ` · ${BUCKETS.find(entry => entry.key === bucket)?.label}` : ''}</h2><p className="wq-help">Sorted by attention needed, then deadline.</p></div>
          <div className="wq-filters"><label className="wq-search"><Search size={17} /><span className="wq-sr-only">Search die, profile, supplier or stage</span><input value={search} onChange={event => setSearch(event.target.value)} placeholder="Search die, profile, supplier…" />{search && <button type="button" className="wq-icon-button" aria-label="Clear search" onClick={() => setSearch('')}><X size={14} /></button>}</label>
            <label className="wq-plant-filter"><span className="wq-sr-only">Filter by plant</span><select value={plant} onChange={event => { setPlant(event.target.value); setPage(1); }}><option value="">All plants</option>{(data?.plants || []).map(entry => { const name = typeof entry === 'string' ? entry : entry.name; return <option key={name} value={name}>{name}</option>; })}</select></label>
            {bucket !== 'all' && <button type="button" className="wq-button wq-button-small" onClick={() => changeBucket('all')}>All deadlines<X size={13} /></button>}
          </div>
        </div>
        {error && <div className="wq-message wq-message-error" role="alert">{data ? 'The last refresh failed. These results may be out of date. ' : ''}{error.message}<button type="button" className="wq-text-button" onClick={refresh}>Try again</button></div>}
        <div aria-busy={loading}>{!error || data ? <WorkQueueTable items={data?.items || []} loading={loading} onSelect={setSelected} scope={scope} /> : <div className="wq-empty"><p>The queue could not be loaded.</p></div>}</div>
        <footer className="wq-table-footer"><span>{loading ? 'Updating…' : `${start}–${end} of ${data?.total || 0} items`}{data?.asOf && !loading && <small> · Refreshed {new Date(data.asOf).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' })}</small>}</span>
          <div className="wq-actions"><button type="button" className="wq-button wq-button-small" disabled={loading || page <= 1} onClick={() => setPage(value => value - 1)} aria-label="Previous page"><ChevronLeft size={16} /></button><span>Page {data?.page || page} of {Math.max(1, data?.pages || 1)}</span><button type="button" className="wq-button wq-button-small" disabled={loading || page >= (data?.pages || 1)} onClick={() => setPage(value => value + 1)} aria-label="Next page"><ChevronRight size={16} /></button></div>
        </footer>
      </div>
      <p className="wq-footer-note">Deadlines use each plant’s calendar and cutoff. Open a work item to see its basis and history.</p>
    </>}
    {selected !== null && ![401, 403].includes(error?.status) && <WorkItemDetail key={selected} id={selected} theme={theme} user={user} onClose={() => setSelected(null)} onChanged={refresh} onOpenSource={onOpenSource} />}
  </section>;
}
