import { useState, useEffect, useCallback } from 'react';
import { get, post, patch } from '../services/api.js';

const STATUS_TABS = ['all', 'pending', 'overdue', 'paid', 'partial'];
const STATUS_COLORS = {
  pending: 'bg-blue-100 text-blue-800',
  overdue: 'bg-red-100 text-red-800',
  paid: 'bg-green-100 text-green-800',
  partial: 'bg-yellow-100 text-yellow-800',
};

function formatINR(amount) {
  return `₹${Number(amount || 0).toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

function formatDate(d) {
  if (!d) return '—';
  return new Date(d).toLocaleDateString('en-IN', { day: '2-digit', month: 'short', year: 'numeric' });
}

function StatusBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${STATUS_COLORS[status] || 'bg-gray-100 text-gray-800'}`}>
      {status}
    </span>
  );
}

/* ─── Invoice Table ─── */
function InvoiceTable({ invoices, loading, onRowClick }) {
  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading invoices…</div>;
  }
  if (!invoices.length) {
    return <div className="text-center py-12 text-gray-400">No invoices found.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {['ID', 'Customer', 'Amount', 'Balance Due', 'Status', 'Due Date', 'Created'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {invoices.map((inv) => (
            <tr key={inv.id} onClick={() => onRowClick(inv)} className="hover:bg-gray-50 cursor-pointer">
              <td className="px-4 py-3 text-sm text-gray-900">#{inv.id}</td>
              <td className="px-4 py-3 text-sm text-gray-700">{inv.customer_name || `Customer #${inv.customer_id}`}</td>
              <td className="px-4 py-3 text-sm text-gray-900 font-medium">{formatINR(inv.amount)}</td>
              <td className="px-4 py-3 text-sm text-gray-900">{formatINR(inv.balance_due)}</td>
              <td className="px-4 py-3 text-sm"><StatusBadge status={inv.status} /></td>
              <td className="px-4 py-3 text-sm text-gray-600">{formatDate(inv.due_date)}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{formatDate(inv.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Invoice Detail Modal ─── */
function InvoiceDetailModal({ invoice, onClose, onPayFull, onPayPartial }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [partialAmount, setPartialAmount] = useState('');
  const [showPartialInput, setShowPartialInput] = useState(false);
  const [actionLoading, setActionLoading] = useState(false);

  useEffect(() => {
    if (!invoice) return;
    setLoading(true);
    get(`/invoices/${invoice.id}`)
      .then((res) => setDetail(res.data || res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [invoice]);

  if (!invoice) return null;

  const canPay = detail && (detail.status === 'pending' || detail.status === 'overdue' || detail.status === 'partial');

  const handlePayFull = async () => {
    setActionLoading(true);
    try {
      await onPayFull(invoice.id);
      onClose();
    } catch { /* handled upstream */ }
    setActionLoading(false);
  };

  const handlePayPartial = async () => {
    const amt = parseFloat(partialAmount);
    if (!amt || amt <= 0) return;
    setActionLoading(true);
    try {
      await onPayPartial(invoice.id, amt);
      onClose();
    } catch { /* handled upstream */ }
    setActionLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Invoice #{invoice.id}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Loading details…</div>
        ) : detail ? (
          <div className="p-6 space-y-6">
            {/* Summary */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Amount:</span> <span className="font-medium">{formatINR(detail.amount)}</span></div>
              <div><span className="text-gray-500">Balance Due:</span> <span className="font-medium">{formatINR(detail.balance_due)}</span></div>
              <div><span className="text-gray-500">Status:</span> <StatusBadge status={detail.status} /></div>
              <div><span className="text-gray-500">Due Date:</span> {formatDate(detail.due_date)}</div>
              <div><span className="text-gray-500">Customer:</span> {detail.customer_name || `#${detail.customer_id}`}</div>
              <div><span className="text-gray-500">Created:</span> {formatDate(detail.created_at)}</div>
            </div>

            {/* Line Items */}
            {detail.line_items && detail.line_items.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Line Items</h3>
                <table className="min-w-full divide-y divide-gray-200 text-sm">
                  <thead className="bg-gray-50">
                    <tr>
                      <th className="px-3 py-2 text-left text-xs font-medium text-gray-500 uppercase">Description</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Qty</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Unit Price</th>
                      <th className="px-3 py-2 text-right text-xs font-medium text-gray-500 uppercase">Total</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-gray-100">
                    {detail.line_items.map((li, i) => (
                      <tr key={i}>
                        <td className="px-3 py-2 text-gray-700">{li.description}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{li.quantity}</td>
                        <td className="px-3 py-2 text-right text-gray-600">{formatINR(li.unit_price)}</td>
                        <td className="px-3 py-2 text-right font-medium text-gray-900">{formatINR(li.total)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            )}

            {/* Status History Timeline */}
            {detail.status_history && detail.status_history.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Status History</h3>
                <div className="space-y-3">
                  {detail.status_history.map((sh, i) => (
                    <div key={i} className="flex items-start gap-3">
                      <div className="mt-1 w-2 h-2 rounded-full bg-indigo-400 shrink-0" />
                      <div className="text-sm">
                        <span className="font-medium text-gray-800">{sh.old_status || '—'}</span>
                        <span className="text-gray-400 mx-1">→</span>
                        <span className="font-medium text-gray-800">{sh.new_status}</span>
                        {sh.reason && <span className="text-gray-500 ml-2">({sh.reason})</span>}
                        <div className="text-xs text-gray-400">{formatDate(sh.changed_at)}</div>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Payment Actions */}
            {canPay && (
              <div className="flex flex-wrap gap-3 pt-2 border-t">
                <button
                  onClick={handlePayFull}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Processing…' : 'Record Full Payment'}
                </button>
                {!showPartialInput ? (
                  <button
                    onClick={() => setShowPartialInput(true)}
                    className="px-4 py-2 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600"
                  >
                    Record Partial Payment
                  </button>
                ) : (
                  <div className="flex items-center gap-2">
                    <span className="text-sm text-gray-500">₹</span>
                    <input
                      type="number"
                      min="1"
                      step="0.01"
                      value={partialAmount}
                      onChange={(e) => setPartialAmount(e.target.value)}
                      placeholder="Amount"
                      className="w-32 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                    />
                    <button
                      onClick={handlePayPartial}
                      disabled={actionLoading || !partialAmount}
                      className="px-3 py-2 bg-yellow-500 text-white text-sm font-medium rounded-lg hover:bg-yellow-600 disabled:opacity-50"
                    >
                      Pay
                    </button>
                    <button onClick={() => { setShowPartialInput(false); setPartialAmount(''); }} className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
                  </div>
                )}
              </div>
            )}
          </div>
        ) : (
          <div className="p-6 text-center text-red-500">Failed to load invoice details.</div>
        )}
      </div>
    </div>
  );
}

/* ─── Create Invoice Modal ─── */
function CreateInvoiceModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ merchant_id: 1, customer_id: '', amount: '', due_date: '', line_items: [{ description: '', quantity: 1, unit_price: '' }] });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);
  const [customers, setCustomers] = useState([]);

  useEffect(() => {
    get('/customers').then(res => setCustomers(res.data || [])).catch(() => {});
  }, []);

  const updateField = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const updateLineItem = (idx, field, value) => {
    setForm((f) => {
      const items = [...f.line_items];
      items[idx] = { ...items[idx], [field]: value };
      return { ...f, line_items: items };
    });
  };

  const addLineItem = () => setForm((f) => ({ ...f, line_items: [...f.line_items, { description: '', quantity: 1, unit_price: '' }] }));

  const removeLineItem = (idx) => {
    if (form.line_items.length <= 1) return;
    setForm((f) => ({ ...f, line_items: f.line_items.filter((_, i) => i !== idx) }));
  };

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    const lineItems = form.line_items.map((li) => ({
      description: li.description,
      quantity: Number(li.quantity),
      unit_price: Number(li.unit_price),
      total: Number(li.quantity) * Number(li.unit_price),
    }));
    const totalAmount = Number(form.amount) || lineItems.reduce((s, li) => s + li.total, 0);
    const body = {
      merchant_id: Number(form.merchant_id),
      customer_id: Number(form.customer_id),
      amount: totalAmount,
      due_date: form.due_date,
      line_items: lineItems,
    };
    setSubmitting(true);
    try {
      await post('/invoices', body);
      onCreated();
      onClose();
    } catch (err) {
      setError(err.message);
    }
    setSubmitting(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-lg w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Create Invoice</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer</label>
              <select required value={form.customer_id} onChange={(e) => updateField('customer_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500">
                <option value="">Select Customer</option>
                {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
              </select>
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Due Date</label>
              <input type="date" required value={form.due_date} onChange={(e) => updateField('due_date', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Amount (₹) <span className="text-gray-400 font-normal">— leave blank to auto-sum line items</span></label>
            <input type="number" min="0" step="0.01" value={form.amount} onChange={(e) => updateField('amount', e.target.value)}
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          </div>

          {/* Line Items */}
          <div>
            <div className="flex items-center justify-between mb-2">
              <label className="text-sm font-medium text-gray-700">Line Items</label>
              <button type="button" onClick={addLineItem} className="text-xs text-indigo-600 hover:text-indigo-800 font-medium">+ Add Item</button>
            </div>
            <div className="space-y-2">
              {form.line_items.map((li, idx) => (
                <div key={idx} className="flex items-center gap-2">
                  <input type="text" required placeholder="Description" value={li.description} onChange={(e) => updateLineItem(idx, 'description', e.target.value)}
                    className="flex-1 px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                  <input type="number" required min="1" placeholder="Qty" value={li.quantity} onChange={(e) => updateLineItem(idx, 'quantity', e.target.value)}
                    className="w-16 px-2 py-2 border border-gray-300 rounded-lg text-sm text-center focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                  <input type="number" required min="0" step="0.01" placeholder="Price" value={li.unit_price} onChange={(e) => updateLineItem(idx, 'unit_price', e.target.value)}
                    className="w-24 px-2 py-2 border border-gray-300 rounded-lg text-sm text-right focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
                  {form.line_items.length > 1 && (
                    <button type="button" onClick={() => removeLineItem(idx)} className="text-red-400 hover:text-red-600 text-lg leading-none">&times;</button>
                  )}
                </div>
              ))}
            </div>
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={submitting}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? 'Creating…' : 'Create Invoice'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Main Invoices Page ─── */
export default function Invoices() {
  const [invoices, setInvoices] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [startDate, setStartDate] = useState('');
  const [endDate, setEndDate] = useState('');
  const [selectedInvoice, setSelectedInvoice] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchInvoices = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (activeTab !== 'all') params.set('status', activeTab);
      if (startDate) params.set('start_date', startDate);
      if (endDate) params.set('end_date', endDate);
      const qs = params.toString();
      const res = await get(`/invoices${qs ? `?${qs}` : ''}`);
      setInvoices(res.data || res || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [activeTab, startDate, endDate]);

  useEffect(() => { fetchInvoices(); }, [fetchInvoices]);

  const filtered = search
    ? invoices.filter((inv) => {
        const q = search.toLowerCase();
        return (
          String(inv.id).includes(q) ||
          (inv.customer_name || '').toLowerCase().includes(q) ||
          String(inv.amount).includes(q)
        );
      })
    : invoices;

  const handlePayFull = async (id) => {
    await patch(`/invoices/${id}/pay`);
    fetchInvoices();
  };

  const handlePayPartial = async (id, amount) => {
    await patch(`/invoices/${id}/partial-pay`, { amount });
    fetchInvoices();
  };

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Invoices</h1>
          <p className="mt-1 text-sm text-gray-500">Manage and track all invoices.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
          + New Invoice
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 text-sm rounded-lg p-3">
          {error}
          <button onClick={() => setError(null)} className="ml-2 underline text-red-600">Dismiss</button>
        </div>
      )}

      {/* Status Tabs */}
      <div className="flex gap-1 bg-gray-100 rounded-lg p-1 w-fit">
        {STATUS_TABS.map((tab) => (
          <button key={tab} onClick={() => setActiveTab(tab)}
            className={`px-4 py-1.5 text-sm font-medium rounded-md capitalize transition-colors ${
              activeTab === tab ? 'bg-white text-gray-900 shadow-sm' : 'text-gray-500 hover:text-gray-700'
            }`}>
            {tab}
          </button>
        ))}
      </div>

      {/* Search + Date Range */}
      <div className="flex flex-wrap items-center gap-3">
        <input
          type="text"
          placeholder="Search by ID, customer, amount…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-64 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
        <div className="flex items-center gap-2 text-sm text-gray-500">
          <span>From</span>
          <input type="date" value={startDate} onChange={(e) => setStartDate(e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
          <span>To</span>
          <input type="date" value={endDate} onChange={(e) => setEndDate(e.target.value)}
            className="px-2 py-1.5 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
        </div>
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <InvoiceTable invoices={filtered} loading={loading} onRowClick={setSelectedInvoice} />
      </div>

      {/* Detail Modal */}
      <InvoiceDetailModal
        invoice={selectedInvoice}
        onClose={() => setSelectedInvoice(null)}
        onPayFull={handlePayFull}
        onPayPartial={handlePayPartial}
      />

      {/* Create Modal */}
      {showCreate && (
        <CreateInvoiceModal onClose={() => setShowCreate(false)} onCreated={fetchInvoices} />
      )}
    </div>
  );
}
