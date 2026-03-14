import { useState, useEffect, useCallback } from 'react';
import { get } from '../services/api.js';

const AGENT_TYPES = [
  { value: '', label: 'All Agents' },
  { value: 'collection_agent', label: 'Collection Agent' },
  { value: 'deduction_agent', label: 'Deduction Agent' },
];

const AGENT_BADGE = {
  collection_agent: 'bg-blue-100 text-blue-800',
  deduction_agent: 'bg-purple-100 text-purple-800',
};

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric', hour: '2-digit', minute: '2-digit' });
}

function formatAgentLabel(type) {
  if (!type) return '—';
  return type.replace(/_/g, ' ').replace(/\b\w/g, (c) => c.toUpperCase());
}

function tryParseJSON(str) {
  if (!str) return null;
  if (typeof str === 'object') return str;
  try { return JSON.parse(str); } catch { return str; }
}

function JSONBlock({ data, label }) {
  const parsed = tryParseJSON(data);
  if (!parsed) return <p className="text-sm text-gray-400 italic">No {label.toLowerCase()} recorded.</p>;

  if (typeof parsed === 'string') {
    return <p className="text-sm text-gray-700 whitespace-pre-wrap">{parsed}</p>;
  }

  return (
    <div className="bg-gray-50 rounded-lg p-3 overflow-x-auto">
      <pre className="text-xs text-gray-700 whitespace-pre-wrap">{JSON.stringify(parsed, null, 2)}</pre>
    </div>
  );
}

/* ─── Single Log Entry (expandable) ─── */
function LogEntry({ entry }) {
  const [expanded, setExpanded] = useState(false);
  const agentColor = AGENT_BADGE[entry.agent_type] || 'bg-gray-100 text-gray-800';

  return (
    <div className="border border-gray-200 rounded-lg overflow-hidden">
      {/* Collapsed row */}
      <button
        onClick={() => setExpanded((v) => !v)}
        className="w-full flex items-center gap-3 px-4 py-3 text-left hover:bg-gray-50 transition-colors"
      >
        <svg
          className={`w-4 h-4 text-gray-400 shrink-0 transition-transform ${expanded ? 'rotate-90' : ''}`}
          fill="none" viewBox="0 0 24 24" stroke="currentColor"
        >
          <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M9 5l7 7-7 7" />
        </svg>

        <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium shrink-0 ${agentColor}`}>
          {formatAgentLabel(entry.agent_type)}
        </span>

        <span className="text-sm font-medium text-gray-900 capitalize truncate">
          {(entry.decision_type || '—').replace(/_/g, ' ')}
        </span>

        <span className="ml-auto text-sm text-gray-600 shrink-0 capitalize">
          {(entry.outcome || '—').replace(/_/g, ' ')}
        </span>

        <span className="text-xs text-gray-400 shrink-0 w-40 text-right">
          {formatDate(entry.created_at)}
        </span>
      </button>

      {/* Expanded detail */}
      {expanded && (
        <div className="border-t border-gray-100 bg-gray-50/50 px-6 py-4 space-y-4">
          {/* Reasoning */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Reasoning</h4>
            <p className="text-sm text-gray-700">{entry.reasoning || <span className="italic text-gray-400">No reasoning recorded.</span>}</p>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4">
            {/* Inputs */}
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Inputs</h4>
              <JSONBlock data={entry.inputs} label="inputs" />
            </div>

            {/* Policy Rules Applied */}
            <div>
              <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Policy Rules Applied</h4>
              <JSONBlock data={entry.policy_rules_applied} label="policy rules" />
            </div>
          </div>

          {/* Outcome */}
          <div>
            <h4 className="text-xs font-semibold text-gray-500 uppercase tracking-wider mb-1">Outcome</h4>
            <span className="inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium bg-green-100 text-green-800 capitalize">
              {(entry.outcome || '—').replace(/_/g, ' ')}
            </span>
          </div>
        </div>
      )}
    </div>
  );
}

/* ─── Main Action Log Page ─── */
export default function ActionLog() {
  const [logs, setLogs] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);

  // Filters
  const [agentType, setAgentType] = useState('');
  const [decisionSearch, setDecisionSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');

  const fetchLogs = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (agentType) params.set('agent_type', agentType);
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      const qs = params.toString();
      const res = await get(`/dashboard/action-log${qs ? `?${qs}` : ''}`);
      setLogs(res.data || res || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [agentType, startDate, endDate]);

  useEffect(() => { fetchLogs(); }, [fetchLogs]);

  // Client-side decision type text filter
  const filtered = decisionSearch
    ? logs.filter((l) =>
        (l.decision_type || '').toLowerCase().includes(decisionSearch.toLowerCase())
      )
    : logs;

  return (
    <div className="space-y-6">
      {/* Header */}
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Action Log</h1>
        <p className="mt-1 text-sm text-gray-500">Audit trail of all autonomous agent decisions.</p>
      </div>

      {/* Error */}
      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-red-600">Dismiss</button>
        </div>
      )}

      {/* Filters */}
      <div className="flex flex-wrap items-end gap-4">
        {/* Agent Type */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Agent Type</label>
          <select
            value={agentType}
            onChange={(e) => setAgentType(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm bg-white focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          >
            {AGENT_TYPES.map((t) => (
              <option key={t.value} value={t.value}>{t.label}</option>
            ))}
          </select>
        </div>

        {/* Decision Type Search */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Decision Type</label>
          <input
            type="text"
            placeholder="Filter by decision type…"
            value={decisionSearch}
            onChange={(e) => setDecisionSearch(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-56 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* Date Range */}
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">Start Date</label>
          <input
            type="date"
            value={startDate}
            onChange={(e) => setStartDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>
        <div>
          <label className="block text-xs font-medium text-gray-500 mb-1">End Date</label>
          <input
            type="date"
            value={endDate}
            onChange={(e) => setEndDate(e.target.value)}
            className="px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
          />
        </div>

        {/* Clear Filters */}
        {(agentType || decisionSearch || startDate || endDate) && (
          <button
            onClick={() => { setAgentType(''); setDecisionSearch(''); setStartDate(''); setEndDate(''); }}
            className="px-3 py-2 text-sm text-gray-500 hover:text-gray-700 underline"
          >
            Clear filters
          </button>
        )}
      </div>

      {/* Results count */}
      {!loading && (
        <p className="text-xs text-gray-400">{filtered.length} {filtered.length === 1 ? 'entry' : 'entries'}</p>
      )}

      {/* Log List */}
      <div className="space-y-2">
        {loading ? (
          <div className="text-center py-12 text-gray-500">Loading action log…</div>
        ) : filtered.length === 0 ? (
          <div className="text-center py-12 text-gray-400">No action log entries found.</div>
        ) : (
          filtered.map((entry) => <LogEntry key={entry.id} entry={entry} />)
        )}
      </div>
    </div>
  );
}
