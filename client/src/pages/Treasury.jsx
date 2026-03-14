import { useState, useEffect, useCallback } from 'react';
import { get } from '../services/api';
import {
  LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip,
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

function BalanceCards({ balance, loading }) {
  if (loading) {
    return (
      <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
        {Array.from({ length: 3 }).map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow p-4 animate-pulse h-20" />
        ))}
      </div>
    );
  }

  const netValue = Number(balance.net_balance || 0);
  const netColor = netValue >= 0 ? 'text-green-600' : 'text-red-600';

  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-4">
      <div className="bg-white rounded-lg shadow p-4 flex flex-col">
        <span className="text-sm text-gray-500">Total Incoming</span>
        <span className="text-2xl font-bold text-green-600">{formatINR(balance.total_incoming)}</span>
      </div>
      <div className="bg-white rounded-lg shadow p-4 flex flex-col">
        <span className="text-sm text-gray-500">Total Outgoing</span>
        <span className="text-2xl font-bold text-red-600">{formatINR(balance.total_outgoing)}</span>
      </div>
      <div className="bg-white rounded-lg shadow p-4 flex flex-col">
        <span className="text-sm text-gray-500">Net Balance</span>
        <span className={`text-2xl font-bold ${netColor}`}>{formatINR(balance.net_balance)}</span>
      </div>
    </div>
  );
}

function PredictionChart({ predictions, loading }) {
  const chartData = (predictions || []).map((p) => ({
    date: p.prediction_date,
    incoming: Number(p.predicted_incoming || 0),
    outgoing: Number(p.predicted_outgoing || 0),
    net: Number(p.predicted_net || 0),
  }));

  return (
    <div className="bg-white rounded-lg shadow p-4">
      <h2 className="text-lg font-semibold text-gray-900 mb-4">Cash Flow Forecast (90 Days)</h2>
      {loading ? (
        <div className="h-72 flex items-center justify-center text-gray-400">Loading chart…</div>
      ) : chartData.length === 0 ? (
        <div className="h-72 flex items-center justify-center text-gray-400">No prediction data available.</div>
      ) : (
        <ResponsiveContainer width="100%" height={300}>
          <LineChart data={chartData}>
            <CartesianGrid strokeDasharray="3 3" />
            <XAxis dataKey="date" tick={{ fontSize: 11 }} />
            <YAxis tick={{ fontSize: 11 }} tickFormatter={(v) => `₹${(v / 1000).toFixed(0)}k`} />
            <Tooltip formatter={(v) => formatINR(v)} />
            <Legend />
            <Line type="monotone" dataKey="incoming" stroke="#22c55e" name="Predicted Incoming" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="outgoing" stroke="#ef4444" name="Predicted Outgoing" dot={false} strokeWidth={2} />
            <Line type="monotone" dataKey="net" stroke="#3b82f6" name="Predicted Net" dot={false} strokeWidth={2} />
          </LineChart>
        </ResponsiveContainer>
      )}
    </div>
  );
}

function RiskAlerts({ predictions, loading }) {
  if (loading) {
    return (
      <div className="bg-white rounded-lg shadow p-4 animate-pulse h-24">
        <div className="h-4 bg-gray-200 rounded w-1/3 mb-3" />
        <div className="h-3 bg-gray-200 rounded w-2/3" />
      </div>
    );
  }

  const negatives = (predictions || []).filter((p) => Number(p.predicted_net) < 0);
  if (negatives.length === 0) {
    return (
      <div className="bg-green-50 border border-green-200 rounded-lg shadow p-4">
        <div className="flex items-center gap-2">
          <span className="text-green-600 text-lg">✓</span>
          <h2 className="text-lg font-semibold text-green-800">No Cash Flow Risks</h2>
        </div>
        <p className="text-sm text-green-700 mt-1">All predictions show positive net cash flow for the next 90 days.</p>
      </div>
    );
  }

  const first = negatives[0];
  return (
    <div className="bg-red-50 border border-red-200 rounded-lg shadow p-4">
      <div className="flex items-center gap-2">
        <span className="text-red-600 text-lg">⚠</span>
        <h2 className="text-lg font-semibold text-red-800">Cash Flow Risk Alert</h2>
      </div>
      <p className="text-sm text-red-700 mt-1">
        Negative net cash flow of <span className="font-semibold">{formatINR(first.predicted_net)}</span> predicted
        on <span className="font-semibold">{first.prediction_date}</span>.
      </p>
      {negatives.length > 1 && (
        <p className="text-xs text-red-600 mt-1">
          {negatives.length} days with negative cash flow predicted in the next 90 days.
        </p>
      )}
    </div>
  );
}

function TransactionTimeline({ transactions, period, setPeriod, loading }) {
  return (
    <div className="bg-white rounded-lg shadow p-4">
      <div className="flex items-center justify-between mb-4">
        <h2 className="text-lg font-semibold text-gray-900">Money Movement Timeline</h2>
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
        <div className="space-y-3">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="h-10 bg-gray-100 rounded animate-pulse" />
          ))}
        </div>
      ) : (!transactions || transactions.length === 0) ? (
        <p className="text-sm text-gray-400 py-4 text-center">No transactions for this period.</p>
      ) : (
        <div className="overflow-x-auto">
          <table className="w-full text-sm">
            <thead>
              <tr className="border-b text-left text-gray-500">
                <th className="pb-2 pr-4">Date</th>
                <th className="pb-2 pr-4">Type</th>
                <th className="pb-2 pr-4 text-right">Amount</th>
                <th className="pb-2 pr-4">Reference</th>
                <th className="pb-2 text-right">Running Balance</th>
              </tr>
            </thead>
            <tbody>
              {transactions.map((tx, i) => (
                <tr key={tx.id || i} className="border-b last:border-0 hover:bg-gray-50">
                  <td className="py-2 pr-4 text-gray-700">
                    {tx.created_at ? new Date(tx.created_at).toLocaleDateString('en-IN') : '—'}
                  </td>
                  <td className="py-2 pr-4">
                    <span className={`text-xs font-medium px-2 py-0.5 rounded-full ${
                      tx.type === 'incoming'
                        ? 'bg-green-100 text-green-800'
                        : 'bg-red-100 text-red-800'
                    }`}>
                      {tx.type}
                    </span>
                  </td>
                  <td className={`py-2 pr-4 text-right font-medium ${
                    tx.type === 'incoming' ? 'text-green-600' : 'text-red-600'
                  }`}>
                    {tx.type === 'incoming' ? '+' : '-'}{formatINR(tx.amount)}
                  </td>
                  <td className="py-2 pr-4 text-gray-500 text-xs">
                    {tx.pine_labs_ref || `${tx.reference_type || ''}#${tx.reference_id || ''}`}
                  </td>
                  <td className="py-2 text-right font-medium text-gray-800">
                    {formatINR(tx.running_balance)}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
    </div>
  );
}

// --- Main Treasury Page ---

export default function Treasury() {
  const [balance, setBalance] = useState({});
  const [predictions, setPredictions] = useState([]);
  const [transactions, setTransactions] = useState([]);
  const [period, setPeriod] = useState(30);
  const [loading, setLoading] = useState({ balance: true, predictions: true, transactions: true });
  const [error, setError] = useState(null);

  const fetchBalance = useCallback(async () => {
    try {
      setLoading((l) => ({ ...l, balance: true }));
      const res = await get('/treasury/net-balance');
      setBalance(res.data || res);
    } catch (e) {
      setError((prev) => prev || e.message);
    } finally {
      setLoading((l) => ({ ...l, balance: false }));
    }
  }, []);

  const fetchPredictions = useCallback(async () => {
    try {
      setLoading((l) => ({ ...l, predictions: true }));
      const res = await get('/treasury/predictions');
      setPredictions(res.data || res || []);
    } catch (e) {
      setError((prev) => prev || e.message);
    } finally {
      setLoading((l) => ({ ...l, predictions: false }));
    }
  }, []);

  const fetchTransactions = useCallback(async () => {
    try {
      setLoading((l) => ({ ...l, transactions: true }));
      const { start, end } = dateRange(period);
      const res = await get(`/treasury/transactions?start_date=${start}&end_date=${end}`);
      setTransactions(res.data || res || []);
    } catch (e) {
      setError((prev) => prev || e.message);
    } finally {
      setLoading((l) => ({ ...l, transactions: false }));
    }
  }, [period]);

  useEffect(() => { fetchBalance(); fetchPredictions(); }, [fetchBalance, fetchPredictions]);
  useEffect(() => { fetchTransactions(); }, [fetchTransactions]);

  return (
    <div className="space-y-6">
      <div>
        <h1 className="text-2xl font-bold text-gray-900">Treasury</h1>
        <p className="mt-1 text-sm text-gray-500">Money movement and cash flow predictions.</p>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-red-600">Dismiss</button>
        </div>
      )}

      {/* Row 1: Balance Summary Cards */}
      <BalanceCards balance={balance} loading={loading.balance} />

      {/* Row 2: Prediction Chart */}
      <PredictionChart predictions={predictions} loading={loading.predictions} />

      {/* Row 3: Risk Alerts */}
      <RiskAlerts predictions={predictions} loading={loading.predictions} />

      {/* Row 4: Transaction Timeline */}
      <TransactionTimeline
        transactions={transactions}
        period={period}
        setPeriod={setPeriod}
        loading={loading.transactions}
      />
    </div>
  );
}
