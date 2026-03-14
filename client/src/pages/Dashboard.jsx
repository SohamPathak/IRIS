import { useState, useEffect, useCallback } from 'react';
import { get } from '../services/api';
import {
  AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip,
  ResponsiveContainer, Legend,
} from 'recharts';

const PERIOD_OPTIONS = [
  { label: '7 Days', days: 7 },
  { label: '30 Days', days: 30 },
  { label: '90 Days', days: 90 },
];

function formatINR(amount) {
  if (amount == null) return '₹0';
  return '₹' + Number(amount).toLocaleString('en-IN', {
    minimumFractionDigits: 0,
    maximumFractionDigits: 0,
  });
}

function severityColor(severity) {
  const map = { low: 'bg-blue-100 text-blue-800', medium: 'bg-yellow-100 text-yellow-800', high: 'bg-orange-100 text-orange-800', critical: 'bg-red-100 text-red-800' };
  return map[severity] || 'bg-gray-100 text-gray-800';
}

function riskColor(category) {
  const map = { low: 'bg-green-100 text-green-800', medium: 'bg-yellow-100 text-yellow-800', high: 'bg-red-100 text-red-800' };
  return map[category] || 'bg-gray-100 text-gray-800';
}

function dateRange(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - days);
  return {
    start: start.toISOString().split('T')[0],
    end: end.toISOString().split('T')[0],
  };
}

// --- Sub-components ---

function MetricCard({ title, value, format, highlight }) {
  const display = format === 'percent'
    ? `${(Number(value) || 0).toFixed(1)}%`
    : formatINR(value);

  let valueClass = 'text-2xl font-bold text-gray-900';
  if (highlight === 'positive' && Number(value) >= 0) valueClass = 'text-2xl font-bold text-green-600';
  if (highlight === 'positive' && Number(value) < 0) valueClass = 'text-2xl font-bold text-red-600';

  return (
    <div className="bg-white rounded-lg shadow p-4 flex flex-col">
      <span className="text-sm text-gray-500">{title}</span>
      <span className={valueClass}>{display}</span>
      {format === 'percent' && (
        <div className="mt-2 w-full bg-gray-200 rounded-full h-2">
          <div
            className="bg-indigo-500 h-2 rounded-full"
            style={{ width: `${Math.min(Math.max(Number(value) || 0, 0), 100)}%` }}
          />
        </div>
      )}
    </div>
  );
}

function MetricsRow({ metrics, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
        {Array.from({ length: 5 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow p-4 animate-pulse h-20" />
        ))}
      </div>
    );
  }
  return (
    <div className="grid grid-cols-2 md:grid-cols-5 gap-4">
      <MetricCard title="Total Receivables" value={metrics.total_receivables} />
      <MetricCard title="Total Collected" value={metrics.total_collected} />
      <MetricCard title="Total Refunded" value={metrics.total_refunded} />
      <MetricCard title="Net Position" value={metrics.net_position} highlight="positive" />
      <MetricCard title="Collection Rate" value={metrics.collection_rate} format="percent" />
    </div>
  );
}

function CashFlowChart({ period, setPeriod, transactions, loading }) {
  const chartData = (transactions || []).map((tx) => ({
    date: tx.created_at?.split('T')[0] || tx.created_at,
    incoming: tx.type === 'incoming' ? Number(tx.amount) : 0,
    outgoing: tx.type === 'outgoing' ? Number(tx.amount) : 0,
    balance: Number(tx.running_balance ?? 0),
  }));

  // Aggregate by date
  const byDate = {};
  chartData.forEach(({ date, incoming, outgoing, balance }) => {
    if (!byDate[date]) byDate[date] = { date, incoming: 0, outgoing: 0, balance: 0 };
    byDate[date].incoming += incoming;
    byDate[date].outgoing += outgoing;
    byDate[date].balance = balance; // last running balance for the day
  });
  const aggregated = Object.values(byDate).sort((a, b) => a.date.localeCompare(b.date));

  return (
    <div className="bg-white rounded-lg shadow p-4 flex flex-col">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Net Cash Flow</h2>
        <div className="flex gap-1">
          {PERIOD_OPTIONS.map((opt) => (
            <button
              key={opt.days}
              onClick={() => setPeriod(opt.days)}
              className={`px-3 py-1 text-xs rounded-full ${
                period === opt.days
                  ? 'bg-indigo-600 text-white'
                  : 'bg-gray-100 text-gray-600 hover:bg-gray-200'
              }`}
            >
              {opt.label}
            </button>
          ))}
        </div>
      </div>
      {loading ? (
        <div className="h-64 flex items-center justify-center text-gray-400">Loading chart…</div>
      ) : aggregated.length === 0 ? (
        <div className="h-64 flex items-center justify-center text-gray-400">No transaction data for this period.</div>
      ) : (
        <ResponsiveContainer width="100%" height={260}>
          <AreaChart data={aggregated}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => formatINR(v)} />
            <Legend />
            <Area type="monotone" dataKey="incoming" stackId="1" stroke="#22c55e" fill="#bbf7d0" name="Incoming" />
            <Area type="monotone" dataKey="outgoing" stackId="2" stroke="#ef4444" fill="#fecaca" name="Outgoing" />
          </AreaChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function QuickSummary({ summary, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4 animate-pulse h-full">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="space-y-2">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i} className="h-3 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg shadow p-4 flex flex-col h-full">
      <div className="flex items-center justify-between mb-3">
        <h2 className="text-lg font-semibold text-gray-900">Quick Summary</h2>
        {summary?.wordCount != null && (
          <span className="text-xs bg-indigo-100 text-indigo-700 px-2 py-0.5 rounded-full">
            {summary.wordCount} words
          </span>
        )}
      </div>
      <p className="text-sm text-gray-700 leading-relaxed whitespace-pre-line flex-1">
        {summary?.summary || 'No summary available.'}
      </p>
    </div>
  );
}

function ThreatsPanel({ threats, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-12 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">Active Threats</h2>
      {(!threats || threats.length === 0) ? (
        <p className="text-sm text-gray-400">No active threats.</p>
      ) : (
        <ul className="space-y-3">
          {threats.map((t) => (
            <li key={t.id} className="border rounded-lg p-3 flex items-start gap-3">
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full whitespace-nowrap ${severityColor(t.severity)}`}>
                {t.severity}
              </span>
              <div className="min-w-0">
                <p className="text-sm font-medium text-gray-800 capitalize">{(t.threat_type || '').replace(/_/g, ' ')}</p>
                <p className="text-xs text-gray-500 mt-0.5">{t.description}</p>
              </div>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

function RiskAlerts({ customers, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4 animate-pulse">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="space-y-3">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-200 rounded" />
          ))}
        </div>
      </div>
    );
  }
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-3">High-Risk Customers</h2>
      {(!customers || customers.length === 0) ? (
        <p className="text-sm text-gray-400">No high-risk customers.</p>
      ) : (
        <ul className="space-y-2">
          {customers.map((c) => (
            <li key={c.id} className="flex items-center justify-between border rounded-lg p-3">
              <div>
                <p className="text-sm font-medium text-gray-800">{c.name}</p>
                <p className="text-xs text-gray-500">Risk Score: {Number(c.risk_score).toFixed(0)}</p>
              </div>
              <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${riskColor(c.risk_category)}`}>
                {c.risk_category}
              </span>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}

// --- Main Dashboard ---

export default function Dashboard() {
  const [metrics, setMetrics] = useState({});
  const [summary, setSummary] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [threats, setThreats] = useState([]);
  const [riskCustomers, setRiskCustomers] = useState([]);
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState({ metrics: true, summary: true, chart: true, threats: true, risk: true });
  const [error, setError] = useState(null);

  const fetchMetrics = useCallback(async () => {
    try {
      setLoading((l) => ({ ...l, metrics: true }));
      const res = await get('/dashboard/metrics');
      setMetrics(res.data || res);
    } catch (e) {
      setError((prev) => prev || e.message);
    } finally {
      setLoading((l) => ({ ...l, metrics: false }));
    }
  }, []);

  const fetchSummary = useCallback(async () => {
    try {
      setLoading((l) => ({ ...l, summary: true }));
      const res = await get('/dashboard/summary');
      setSummary(res.data || res);
    } catch (e) {
      setError((prev) => prev || e.message);
    } finally {
      setLoading((l) => ({ ...l, summary: false }));
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading((l) => ({ ...l, chart: true }));
      const { start, end } = dateRange(period);
      const res = await get(`/treasury/transactions?start_date=${start}&end_date=${end}`);
      setTransactions(res.data || res || []);
    } catch (e) {
      setError((prev) => prev || e.message);
    } finally {
      setLoading((l) => ({ ...l, chart: false }));
    }
  }, [period]);

  const fetchThreats = useCallback(async () => {
    try {
      setLoading((l) => ({ ...l, threats: true }));
      const res = await get('/threats?status=active');
      setThreats(res.data || res || []);
    } catch (e) {
      setError((prev) => prev || e.message);
    } finally {
      setLoading((l) => ({ ...l, threats: false }));
    }
  }, []);

  const fetchRiskCustomers = useCallback(async () => {
    try {
      setLoading((l) => ({ ...l, risk: true }));
      const res = await get('/customers?sort=risk_score&order=desc&limit=5');
      setRiskCustomers(res.data || res || []);
    } catch (e) {
      setError((prev) => prev || e.message);
    } finally {
      setLoading((l) => ({ ...l, risk: false }));
    }
  }, []);

  useEffect(() => { fetchMetrics(); fetchSummary(); fetchThreats(); fetchRiskCustomers(); }, [fetchMetrics, fetchSummary, fetchThreats, fetchRiskCustomers]);
  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Dashboard</h1>
        <p className="mt-1 text-sm text-gray-500">Overview of your financial health.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-red-600">Dismiss</button>
        </div>
      )}

      {/* Row 1: Metrics */}
      <MetricsRow metrics={metrics} loading={loading.metrics} />

      {/* Row 2: Chart + Summary */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className="lg:col-span-2">
          <CashFlowChart period={period} setPeriod={setPeriod} transactions={transactions} loading={loading.chart} />
        </div>
        <div className="lg:col-span-1">
          <QuickSummary summary={summary} loading={loading.summary} />
        </div>
      </div>

      {/* Row 3: Threats + Risk Customers */}
      <div className="grid grid-cols-1 md:grid-cols-2 gap-6">
        <ThreatsPanel threats={threats} loading={loading.threats} />
        <RiskAlerts customers={riskCustomers} loading={loading.risk} />
      </div>
    </div>
  );
}
