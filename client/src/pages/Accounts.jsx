import { useState, useEffect } from 'react';
import { get } from '../services/api';

const STATUS_COLORS = { 'at_risk': 'bg-red-100 text-red-700 border-red-200', 'need_reminders': 'bg-yellow-100 text-yellow-700 border-yellow-200', 'on_time': 'bg-green-100 text-green-700 border-green-200' };
const STATUS_LABELS = { 'at_risk': '🔴 At Risk', 'need_reminders': '🟡 Need Reminders', 'on_time': '🟢 On Time' };
const ACTION_COLORS = { 'none': 'text-gray-500', 'weekly_reminder': 'text-yellow-600', 'daily_reminder': 'text-orange-600', 'human_escalation': 'text-red-600' };

export default function Accounts() {
  const [accounts, setAccounts] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedBuyer, setSelectedBuyer] = useState(null);
  const [buyerDetail, setBuyerDetail] = useState(null);
  const [transactions, setTransactions] = useState([]);
  const [error, setError] = useState('');

  useEffect(() => { fetchAccounts(); }, []);

  async function fetchAccounts() {
    try {
      const res = await get('/accounts');
      setAccounts(res.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function selectBuyer(buyerId) {
    setSelectedBuyer(buyerId); setError('');
    try {
      const [detail, txns] = await Promise.all([get(`/accounts/${buyerId}`), get(`/accounts/${buyerId}/transactions`)]);
      setBuyerDetail(detail.data || detail);
      setTransactions(txns.data || []);
    } catch (e) { setError(e.message); }
  }

  if (loading) return <p className="text-gray-500">Loading accounts…</p>;

  return (
    <div>
      <div className="mb-6">
        <h2 className="text-2xl font-bold text-gray-900">Buyer Accounts</h2>
        <p className="text-sm text-gray-500 mt-1">Individual buyer status, confidence scores, and transaction history</p>
      </div>
      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={selectedBuyer ? 'lg:col-span-1' : 'lg:col-span-3'}>
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <div className="divide-y">
              {accounts.map(a => (
                <div key={a.buyer_id} onClick={() => selectBuyer(a.buyer_id)} className={`px-4 py-3 cursor-pointer hover:bg-gray-50 ${selectedBuyer === a.buyer_id ? 'bg-indigo-50 border-l-4 border-indigo-600' : ''}`}>
                  <div className="flex items-center justify-between">
                    <span className="font-medium text-gray-900 text-sm">{a.name || `Buyer #${a.buyer_id}`}</span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium border ${STATUS_COLORS[a.account_status] || 'bg-gray-100'}`}>{STATUS_LABELS[a.account_status] || a.account_status}</span>
                  </div>
                  <div className="flex gap-4 mt-1 text-xs text-gray-500">
                    <span>Txns: {a.net_transactions || 0}</span>
                    <span>Due: ₹{Number(a.net_payment_due || 0).toLocaleString()}</span>
                    <span>Score: {a.confidence_score ?? '—'}</span>
                  </div>
                </div>
              ))}
              {accounts.length === 0 && <div className="px-4 py-8 text-center text-gray-400 text-sm">No buyer accounts found</div>}
            </div>
          </div>
        </div>

        {selectedBuyer && buyerDetail && (
          <div className="lg:col-span-2 space-y-4">
            <div className="bg-white rounded-xl shadow-sm border p-5">
              <div className="flex justify-between items-start mb-4">
                <h3 className="text-lg font-bold text-gray-900">{buyerDetail.name || `Buyer #${selectedBuyer}`}</h3>
                <button onClick={() => { setSelectedBuyer(null); setBuyerDetail(null); }} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="grid grid-cols-2 md:grid-cols-4 gap-4">
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Net Transactions</p>
                  <p className="text-xl font-bold text-gray-900">{buyerDetail.net_transactions || 0}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Net Payment Due</p>
                  <p className="text-xl font-bold text-gray-900">₹{Number(buyerDetail.net_payment_due || 0).toLocaleString()}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Account Status</p>
                  <p className={`text-sm font-bold mt-1 ${STATUS_COLORS[buyerDetail.account_status]?.split(' ')[1] || ''}`}>{STATUS_LABELS[buyerDetail.account_status] || buyerDetail.account_status}</p>
                </div>
                <div className="bg-gray-50 rounded-lg p-3">
                  <p className="text-xs text-gray-500">Confidence Score</p>
                  <p className="text-xl font-bold text-gray-900">{buyerDetail.confidence_score ?? '—'}<span className="text-xs text-gray-400">/100</span></p>
                </div>
              </div>
            </div>

            <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
              <div className="px-4 py-3 border-b bg-gray-50">
                <h4 className="font-bold text-sm text-gray-700">Transaction History</h4>
              </div>
              <table className="w-full text-sm">
                <thead className="bg-gray-50 border-b">
                  <tr>
                    <th className="text-left px-4 py-2 font-medium text-gray-600">Description</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-600">Status</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-600">Course of Action</th>
                    <th className="text-right px-4 py-2 font-medium text-gray-600">Amount</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-600">Shipping</th>
                    <th className="text-center px-4 py-2 font-medium text-gray-600">Past Due</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {transactions.map((tx, i) => (
                    <tr key={i} className="hover:bg-gray-50">
                      <td className="px-4 py-2 text-gray-900">{tx.description || `Transaction #${tx.id}`}</td>
                      <td className="px-4 py-2 text-center">
                        <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${tx.payment_status === 'paid' ? 'bg-green-100 text-green-700' : tx.payment_status === 'overdue' ? 'bg-red-100 text-red-700' : 'bg-yellow-100 text-yellow-700'}`}>{tx.payment_status || tx.status}</span>
                      </td>
                      <td className={`px-4 py-2 text-center text-xs font-medium ${ACTION_COLORS[tx.course_of_action] || 'text-gray-500'}`}>{(tx.course_of_action || 'none').replace(/_/g, ' ')}</td>
                      <td className="px-4 py-2 text-right font-medium">₹{Number(tx.total_amount || tx.amount_recovered || 0).toLocaleString()}</td>
                      <td className="px-4 py-2 text-center text-gray-600">{tx.shipping_date ? new Date(tx.shipping_date).toLocaleDateString() : '—'}</td>
                      <td className="px-4 py-2 text-center">
                        {tx.past_due_days > 0 ? <span className="text-red-600 font-medium">{tx.past_due_days}d</span> : <span className="text-green-600">—</span>}
                      </td>
                    </tr>
                  ))}
                  {transactions.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-400">No transactions found</td></tr>}
                </tbody>
              </table>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
