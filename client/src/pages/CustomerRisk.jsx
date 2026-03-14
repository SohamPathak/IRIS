import { useState, useEffect, useCallback } from 'react';
import { get } from '../services/api.js';

const RISK_TABS = ['all', 'high', 'medium', 'low'];
const RISK_COLORS = {
  high: 'bg-red-100 text-red-800',
  medium: 'bg-yellow-100 text-yellow-800',
  low: 'bg-green-100 text-green-800',
};

function formatINR(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function RiskBadge({ category }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${RISK_COLORS[category] || 'bg-gray-100 text-gray-800'}`}>
      {category || 'unknown'}
    </span>
  );
}

function RiskScoreDisplay({ score, category }) {
  const color = category === 'high' ? 'text-red-600' : category === 'medium' ? 'text-yellow-600' : 'text-green-600';
  return (
    <span className={`font-bold ${color}`}>{Math.round(score ?? 0)}</span>
  );
}

/* ─── Customer Table ─── */
function CustomerTable({ customers, loading, sortField, sortOrder, onSort, onRowClick }) {
  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading customers…</div>;
  }
  if (!customers.length) {
    return <div className="text-center py-12 text-gray-400">No customers found.</div>;
  }

  const SortHeader = ({ field, children }) => {
    const active = sortField === field;
    return (
      <th
        className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider cursor-pointer hover:text-gray-700 select-none"
        onClick={() => onSort(field)}
      >
        {children}
        {active && <span className="ml-1">{sortOrder === 'asc' ? '↑' : '↓'}</span>}
      </th>
    );
  };

  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">ID</th>
            <SortHeader field="name">Name</SortHeader>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Email</th>
            <SortHeader field="risk_score">Risk Score</SortHeader>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Risk Category</th>
            <th className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">Phone</th>
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {customers.map((c) => (
            <tr key={c.id} onClick={() => onRowClick(c)} className="hover:bg-gray-50 cursor-pointer">
              <td className="px-4 py-3 text-sm text-gray-900">#{c.id}</td>
              <td className="px-4 py-3 text-sm text-gray-900 font-medium">{c.name}</td>
              <td className="px-4 py-3 text-sm text-gray-600">{c.email || '—'}</td>
              <td className="px-4 py-3 text-sm"><RiskScoreDisplay score={c.risk_score} category={c.risk_category} /></td>
              <td className="px-4 py-3 text-sm"><RiskBadge category={c.risk_category} /></td>
              <td className="px-4 py-3 text-sm text-gray-600">{c.phone || '—'}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Customer Detail Modal ─── */
function CustomerDetailModal({ customer, onClose }) {
  const [detail, setDetail] = useState(null);
  const [riskHistory, setRiskHistory] = useState([]);
  const [loading, setLoading] = useState(true);

  useEffect(() => {
    if (!customer) return;
    setLoading(true);
    Promise.all([
      get(`/customers/${customer.id}`).then((res) => res.data || res).catch(() => null),
      get(`/customers/${customer.id}/risk-history`).then((res) => res.data || res).catch(() => ({ history: [] })),
    ]).then(([d, rh]) => {
      setDetail(d);
      setRiskHistory(rh?.history || []);
      setLoading(false);
    });
  }, [customer]);

  if (!customer) return null;

  const overdueInvoices = detail?.invoice_summary
    ? { count: detail.invoice_summary.overdue, outstanding: detail.invoice_summary.total_outstanding }
    : null;

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">{customer.name}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Loading details…</div>
        ) : detail ? (
          <div className="p-6 space-y-6">
            {/* Customer Info + Risk Score */}
            <div className="flex items-start justify-between">
              <div className="grid grid-cols-2 gap-x-8 gap-y-2 text-sm flex-1">
                <div><span className="text-gray-500">Email:</span> <span className="text-gray-900">{detail.email || '—'}</span></div>
                <div><span className="text-gray-500">Phone:</span> <span className="text-gray-900">{detail.phone || '—'}</span></div>
                <div><span className="text-gray-500">Category:</span> <RiskBadge category={detail.risk_category} /></div>
                <div><span className="text-gray-500">Customer Since:</span> <span className="text-gray-900">{formatDate(detail.created_at)}</span></div>
              </div>
              <div className="text-center ml-6 shrink-0">
                <div className={`text-4xl font-bold ${
                  detail.risk_category === 'high' ? 'text-red-600' : detail.risk_category === 'medium' ? 'text-yellow-600' : 'text-green-600'
                }`}>
                  {Math.round(detail.risk_score ?? 0)}
                </div>
                <div className="text-xs text-gray-500 mt-1">Risk Score</div>
              </div>
            </div>

            {/* Invoice Summary */}
            {detail.invoice_summary && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Invoice Summary</h3>
                <div className="grid grid-cols-3 gap-3">
                  {[
                    { label: 'Total Invoices', value: detail.invoice_summary.total },
                    { label: 'Overdue', value: detail.invoice_summary.overdue, highlight: detail.invoice_summary.overdue > 0 },
                    { label: 'Outstanding', value: formatINR(detail.invoice_summary.total_outstanding), highlight: detail.invoice_summary.total_outstanding > 0 },
                    { label: 'Paid', value: detail.invoice_summary.paid },
                    { label: 'Pending', value: detail.invoice_summary.pending },
                    { label: 'Partial', value: detail.invoice_summary.partial },
                  ].map((item) => (
                    <div key={item.label} className={`rounded-lg p-3 text-sm ${item.highlight ? 'bg-red-50 border border-red-200' : 'bg-gray-50'}`}>
                      <div className="text-gray-500 text-xs">{item.label}</div>
                      <div className={`font-semibold ${item.highlight ? 'text-red-700' : 'text-gray-900'}`}>{item.value}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment Plans */}
            {detail.payment_plans && detail.payment_plans.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Payment Plans</h3>
                <div className="space-y-2">
                  {detail.payment_plans.map((pp) => (
                    <div key={pp.id} className="flex items-center justify-between bg-gray-50 rounded-lg px-4 py-2 text-sm">
                      <div>
                        <span className="text-gray-700">Plan #{pp.id}</span>
                        <span className="text-gray-400 mx-2">·</span>
                        <span className="text-gray-600">{pp.num_installments} installments of {formatINR(pp.installment_amount)}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                        pp.status === 'active' ? 'bg-blue-100 text-blue-800' :
                        pp.status === 'completed' ? 'bg-green-100 text-green-800' :
                        'bg-red-100 text-red-800'
                      }`}>{pp.status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Recent Reminders (Payment History proxy) */}
            {detail.recent_reminders && detail.recent_reminders.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Recent Reminders</h3>
                <div className="space-y-2">
                  {detail.recent_reminders.map((r) => (
                    <div key={r.id} className="flex items-center justify-between text-sm bg-gray-50 rounded-lg px-4 py-2">
                      <div>
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium capitalize ${
                          r.escalation_level === 'final' ? 'bg-red-100 text-red-800' :
                          r.escalation_level === 'firm' ? 'bg-yellow-100 text-yellow-800' :
                          'bg-blue-100 text-blue-800'
                        }`}>{r.escalation_level}</span>
                        <span className="text-gray-400 mx-2">via</span>
                        <span className="text-gray-600 capitalize">{r.channel}</span>
                      </div>
                      <div className="text-gray-400 text-xs">{formatDate(r.sent_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Risk History */}
            {riskHistory.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Risk Score History</h3>
                <div className="space-y-3">
                  {riskHistory.map((entry) => (
                    <div key={entry.id} className="border-l-2 border-indigo-300 pl-4 py-1">
                      <div className="flex items-center gap-3 text-sm">
                        <span className="font-semibold text-gray-800">Score: {Math.round(entry.risk_score ?? 0)}</span>
                        {entry.total_overdue != null && (
                          <span className="text-gray-500">Overdue: {formatINR(entry.total_overdue)}</span>
                        )}
                      </div>
                      {entry.reasoning && (
                        <p className="text-xs text-gray-500 mt-1">{entry.reasoning}</p>
                      )}
                      <div className="text-xs text-gray-400 mt-1">{formatDate(entry.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Contributing Factors */}
            {detail.risk_category && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Contributing Factors</h3>
                <ul className="space-y-1 text-sm text-gray-600">
                  {detail.invoice_summary?.overdue > 0 && (
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                      {detail.invoice_summary.overdue} overdue invoice{detail.invoice_summary.overdue > 1 ? 's' : ''} ({formatINR(detail.invoice_summary.total_outstanding)} outstanding)
                    </li>
                  )}
                  {detail.recent_reminders?.length > 0 && (
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-yellow-400 shrink-0" />
                      {detail.recent_reminders.length} reminder{detail.recent_reminders.length > 1 ? 's' : ''} sent recently
                    </li>
                  )}
                  {detail.payment_plans?.some((pp) => pp.status === 'defaulted') && (
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-red-400 shrink-0" />
                      Has defaulted payment plan(s)
                    </li>
                  )}
                  {detail.risk_category === 'low' && detail.invoice_summary?.paid > 0 && (
                    <li className="flex items-center gap-2">
                      <span className="w-1.5 h-1.5 rounded-full bg-green-400 shrink-0" />
                      Good payment history ({detail.invoice_summary.paid} paid invoices)
                    </li>
                  )}
                </ul>
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 text-center text-red-500">Failed to load customer details.</div>
        )}
      </div>
    </div>
  );
}

/* ─── Main Customer Risk Page ─── */
export default function CustomerRisk() {
  const [customers, setCustomers] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [sortField, setSortField] = useState('risk_score');
  const [sortOrder, setSortOrder] = useState('desc');
  const [selectedCustomer, setSelectedCustomer] = useState(null);

  const fetchCustomers = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (activeTab !== 'all') params.set('risk_category', activeTab);
      const qs = params.toString();
      const res = await get(`/customers${qs ? `?${qs}` : ''}`);
      setCustomers(res.data || res || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [activeTab]);

  useEffect(() => { fetchCustomers(); }, [fetchCustomers]);

  // Client-side sort
  const sorted = [...customers].sort((a, b) => {
    let aVal = a[sortField];
    let bVal = b[sortField];
    if (typeof aVal === 'string') aVal = aVal.toLowerCase();
    if (typeof bVal === 'string') bVal = bVal.toLowerCase();
    if (aVal < bVal) return sortOrder === 'asc' ? -1 : 1;
    if (aVal > bVal) return sortOrder === 'asc' ? 1 : -1;
    return 0;
  });

  // Client-side search
  const filtered = search
    ? sorted.filter((c) => {
        const q = search.toLowerCase();
        return (
          String(c.id).includes(q) ||
          (c.name || '').toLowerCase().includes(q) ||
          (c.email || '').toLowerCase().includes(q) ||
          (c.phone || '').toLowerCase().includes(q)
        );
      })
    : sorted;

  const handleSort = (field) => {
    if (sortField === field) {
      setSortOrder((o) => (o === 'asc' ? 'desc' : 'asc'));
    } else {
      setSortField(field);
      setSortOrder(field === 'risk_score' ? 'desc' : 'asc');
    }
  };

  // Summary counts
  const counts = {
    all: customers.length,
    high: customers.filter((c) => c.risk_category === 'high').length,
    medium: customers.filter((c) => c.risk_category === 'medium').length,
    low: customers.filter((c) => c.risk_category === 'low').length,
  };

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Customer Risk</h1>
        <p className="mt-1 text-sm text-gray-500">Risk scores and profiles for all customers.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-red-600">Dismiss</button>
        </div>
      )}

      {/* Risk Category Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {RISK_TABS.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab} ({counts[tab]})
          </button>
        ))}
      </div>

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by name, email, phone…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-72 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <CustomerTable
          customers={filtered}
          loading={loading}
          sortField={sortField}
          sortOrder={sortOrder}
          onSort={handleSort}
          onRowClick={setSelectedCustomer}
        />
      </div>

      {/* Detail Modal */}
      <CustomerDetailModal
        customer={selectedCustomer}
        onClose={() => setSelectedCustomer(null)}
      />
    </div>
  );
}
