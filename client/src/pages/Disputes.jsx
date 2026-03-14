import { useState, useEffect, useCallback } from 'react';
import { get, post, patch } from '../services/api.js';

const STATUS_TABS = ['all', 'open', 'verifying', 'resolved', 'reopened'];
const STATUS_COLORS = {
  open: 'bg-blue-100 text-blue-800',
  verifying: 'bg-yellow-100 text-yellow-800',
  resolved: 'bg-green-100 text-green-800',
  reopened: 'bg-orange-100 text-orange-800',
};
const VERIFICATION_COLORS = {
  pending: 'bg-gray-100 text-gray-800',
  verified: 'bg-green-100 text-green-800',
  needs_info: 'bg-yellow-100 text-yellow-800',
  failed: 'bg-red-100 text-red-800',
};

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

function VerificationBadge({ status }) {
  return (
    <span className={`inline-flex items-center px-2.5 py-0.5 rounded-full text-xs font-medium capitalize ${VERIFICATION_COLORS[status] || 'bg-gray-100 text-gray-800'}`}>
      {status || '—'}
    </span>
  );
}

/* ─── Dispute Table ─── */
function DisputeTable({ disputes, loading, onRowClick }) {
  if (loading) {
    return <div className="text-center py-12 text-gray-500">Loading disputes…</div>;
  }
  if (!disputes.length) {
    return <div className="text-center py-12 text-gray-400">No disputes found.</div>;
  }
  return (
    <div className="overflow-x-auto">
      <table className="min-w-full divide-y divide-gray-200">
        <thead className="bg-gray-50">
          <tr>
            {['ID', 'Customer', 'Invoice', 'Status', 'Verification', 'Resolution', 'Created'].map((h) => (
              <th key={h} className="px-4 py-3 text-left text-xs font-medium text-gray-500 uppercase tracking-wider">{h}</th>
            ))}
          </tr>
        </thead>
        <tbody className="bg-white divide-y divide-gray-200">
          {disputes.map((d) => (
            <tr key={d.id} onClick={() => onRowClick(d)} className="hover:bg-gray-50 cursor-pointer">
              <td className="px-4 py-3 text-sm text-gray-900">#{d.id}</td>
              <td className="px-4 py-3 text-sm text-gray-700">{d.customer_name || `Customer #${d.customer_id}`}</td>
              <td className="px-4 py-3 text-sm text-gray-700">#{d.invoice_id}</td>
              <td className="px-4 py-3 text-sm"><StatusBadge status={d.status} /></td>
              <td className="px-4 py-3 text-sm"><VerificationBadge status={d.verification_status} /></td>
              <td className="px-4 py-3 text-sm text-gray-600 capitalize">{d.resolution_type ? d.resolution_type.replace(/_/g, ' ') : '—'}</td>
              <td className="px-4 py-3 text-sm text-gray-500">{formatDate(d.created_at)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/* ─── Dispute Detail Modal ─── */
function DisputeDetailModal({ dispute, onClose, onRefresh }) {
  const [detail, setDetail] = useState(null);
  const [loading, setLoading] = useState(true);
  const [actionLoading, setActionLoading] = useState(false);
  const [showReEval, setShowReEval] = useState(false);
  const [newInfo, setNewInfo] = useState('');
  const [artifactDesc, setArtifactDesc] = useState('');
  const [artifactType, setArtifactType] = useState('document');
  const [reviewResult, setReviewResult] = useState(null);
  const [showManualResolve, setShowManualResolve] = useState(false);
  const [manualResolution, setManualResolution] = useState('valid');
  const [merchantNotes, setMerchantNotes] = useState('');

  useEffect(() => {
    if (!dispute) return;
    setLoading(true);
    setShowReEval(false);
    setNewInfo('');
    setArtifactDesc('');
    setArtifactType('document');
    setReviewResult(null);
    setShowManualResolve(false);
    setMerchantNotes('');
    get(`/disputes/${dispute.id}`)
      .then((res) => setDetail(res.data || res))
      .catch(() => {})
      .finally(() => setLoading(false));
  }, [dispute]);

  if (!dispute) return null;

  const handleResolve = async () => {
    setActionLoading(true);
    try {
      await post(`/disputes/${dispute.id}/resolve`);
      onRefresh();
      onClose();
    } catch { /* handled upstream */ }
    setActionLoading(false);
  };

  const handleReEvaluate = async () => {
    if (!newInfo.trim()) return;
    setActionLoading(true);
    try {
      await post(`/disputes/${dispute.id}/re-evaluate`, { claim_details: newInfo.trim() });
      onRefresh();
      onClose();
    } catch { /* handled upstream */ }
    setActionLoading(false);
  };

  const canResolve = detail && (detail.status === 'open' || detail.status === 'verifying');
  const canReEval = detail && (detail.status === 'resolved' || detail.status === 'reopened');

  const handleUploadArtifact = async () => {
    if (!artifactDesc.trim()) return;
    setActionLoading(true);
    try {
      await post(`/disputes/${dispute.id}/artifacts`, { artifact_type: artifactType, description: artifactDesc.trim() });
      setArtifactDesc('');
      const res = await get(`/disputes/${dispute.id}`);
      setDetail(res.data || res);
    } catch { /* handled upstream */ }
    setActionLoading(false);
  };

  const handleAIReview = async () => {
    setActionLoading(true);
    setReviewResult(null);
    try {
      const res = await post(`/disputes/${dispute.id}/artifact-review`);
      setReviewResult(res.data || res);
      onRefresh();
    } catch { /* handled upstream */ }
    setActionLoading(false);
  };

  const handleManualResolve = async () => {
    setActionLoading(true);
    try {
      await post(`/disputes/${dispute.id}/manual-resolve`, { resolution: manualResolution, merchant_notes: merchantNotes.trim() });
      onRefresh();
      onClose();
    } catch { /* handled upstream */ }
    setActionLoading(false);
  };

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40" onClick={onClose}>
      <div className="bg-white rounded-xl shadow-xl max-w-2xl w-full mx-4 max-h-[90vh] overflow-y-auto" onClick={(e) => e.stopPropagation()}>
        <div className="flex items-center justify-between px-6 py-4 border-b">
          <h2 className="text-lg font-semibold text-gray-900">Dispute #{dispute.id}</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>

        {loading ? (
          <div className="p-6 text-center text-gray-500">Loading details…</div>
        ) : detail ? (
          <div className="p-6 space-y-6">
            {/* Summary Grid */}
            <div className="grid grid-cols-2 gap-4 text-sm">
              <div><span className="text-gray-500">Customer:</span> <span className="font-medium">{detail.customer_name || `#${detail.customer_id}`}</span></div>
              <div><span className="text-gray-500">Invoice:</span> <span className="font-medium">#{detail.invoice_id}</span></div>
              <div><span className="text-gray-500">Status:</span> <StatusBadge status={detail.status} /></div>
              <div><span className="text-gray-500">Verification:</span> <VerificationBadge status={detail.verification_status} /></div>
              <div><span className="text-gray-500">Created:</span> {formatDate(detail.created_at)}</div>
              {detail.resolved_at && <div><span className="text-gray-500">Resolved:</span> {formatDate(detail.resolved_at)}</div>}
            </div>

            {/* Claim Details */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Claim Details</h3>
              <p className="text-sm text-gray-600 bg-gray-50 rounded-lg p-3">{detail.claim_details || 'No details provided.'}</p>
            </div>

            {/* Resolution Details */}
            {detail.resolution_type && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Resolution</h3>
                <div className="bg-green-50 border border-green-200 rounded-lg p-3 space-y-1">
                  <div className="text-sm"><span className="text-gray-500">Type:</span> <span className="font-medium text-gray-800 capitalize">{detail.resolution_type.replace(/_/g, ' ')}</span></div>
                  {detail.resolution_details && (
                    <div className="text-sm text-gray-600">{detail.resolution_details}</div>
                  )}
                </div>
              </div>
            )}

            {/* Action Log */}
            {detail.action_logs && detail.action_logs.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Action Log</h3>
                <div className="space-y-3">
                  {detail.action_logs.map((log, i) => (
                    <div key={i} className="border-l-2 border-indigo-300 pl-4 py-1">
                      <div className="flex items-center gap-2 text-sm">
                        <span className="font-medium text-gray-800 capitalize">{(log.decision_type || '').replace(/_/g, ' ')}</span>
                        <span className="text-xs px-2 py-0.5 rounded-full bg-indigo-50 text-indigo-700">{log.agent_type}</span>
                      </div>
                      {log.reasoning && <p className="text-xs text-gray-500 mt-1">{log.reasoning}</p>}
                      <div className="text-xs text-gray-400 mt-1">{formatDate(log.created_at)}</div>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Artifacts */}
            {detail.artifacts && detail.artifacts.length > 0 && (
              <div>
                <h3 className="text-sm font-semibold text-gray-700 mb-2">Dispute Artifacts</h3>
                <div className="space-y-2">
                  {detail.artifacts.map((a, i) => (
                    <div key={i} className="flex items-center justify-between bg-gray-50 rounded-lg p-2 text-sm">
                      <div className="flex items-center gap-2">
                        <span className="text-gray-400">{a.artifact_type === 'photo' ? '📷' : a.artifact_type === 'receipt' ? '🧾' : '📄'}</span>
                        <span className="text-gray-700">{a.description}</span>
                      </div>
                      <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${a.review_status === 'reviewed' ? 'bg-green-100 text-green-700' : 'bg-gray-100 text-gray-600'}`}>{a.review_status}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}

            {/* Upload Artifact */}
            <div>
              <h3 className="text-sm font-semibold text-gray-700 mb-2">Upload Artifact</h3>
              <div className="flex gap-2">
                <select value={artifactType} onChange={e => setArtifactType(e.target.value)} className="border rounded-lg px-3 py-2 text-sm">
                  <option value="document">Document</option><option value="photo">Photo</option><option value="receipt">Receipt</option><option value="other">Other</option>
                </select>
                <input value={artifactDesc} onChange={e => setArtifactDesc(e.target.value)} placeholder="Artifact description…" className="flex-1 border rounded-lg px-3 py-2 text-sm" />
                <button onClick={handleUploadArtifact} disabled={actionLoading || !artifactDesc.trim()} className="bg-indigo-600 text-white px-3 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700 disabled:opacity-50">Upload</button>
              </div>
            </div>

            {/* AI Review */}
            {reviewResult && (
              <div className="bg-purple-50 border border-purple-200 rounded-lg p-3">
                <h3 className="text-sm font-semibold text-purple-800 mb-2">🤖 AI Review Assessment</h3>
                <div className="grid grid-cols-3 gap-2 text-sm">
                  <div><span className="text-gray-500">Validity:</span> <span className="font-medium">{reviewResult.validity || '—'}</span></div>
                  <div><span className="text-gray-500">Support:</span> <span className="font-medium">{reviewResult.support_level || '—'}</span></div>
                  <div><span className="text-gray-500">Recommendation:</span> <span className="font-medium">{reviewResult.recommendation || '—'}</span></div>
                </div>
                {reviewResult.reasoning && <p className="text-xs text-gray-600 mt-2">{reviewResult.reasoning}</p>}
              </div>
            )}

            {/* Manual Resolution */}
            {showManualResolve && (
              <div className="border border-gray-200 rounded-lg p-3 space-y-3">
                <h3 className="text-sm font-semibold text-gray-700">Manual Resolution</h3>
                <select value={manualResolution} onChange={e => setManualResolution(e.target.value)} className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="valid">Valid Deduction — Issue Refund</option>
                  <option value="invalid">Invalid Deduction — Reject Claim</option>
                  <option value="partial">Partial — Partial Refund</option>
                </select>
                <textarea value={merchantNotes} onChange={e => setMerchantNotes(e.target.value)} placeholder="Merchant notes…" rows={2} className="w-full border rounded-lg px-3 py-2 text-sm" />
                <div className="flex gap-2">
                  <button onClick={handleManualResolve} disabled={actionLoading} className="bg-green-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-green-700 disabled:opacity-50">{actionLoading ? 'Processing…' : 'Submit Resolution'}</button>
                  <button onClick={() => setShowManualResolve(false)} className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
                </div>
              </div>
            )}

            {/* Action Buttons */}
            <div className="flex flex-wrap gap-3 pt-2 border-t">
              {canResolve && (
                <button
                  onClick={handleResolve}
                  disabled={actionLoading}
                  className="px-4 py-2 bg-green-600 text-white text-sm font-medium rounded-lg hover:bg-green-700 disabled:opacity-50"
                >
                  {actionLoading ? 'Processing…' : 'Resolve Dispute'}
                </button>
              )}
              <button onClick={handleAIReview} disabled={actionLoading} className="px-4 py-2 bg-purple-600 text-white text-sm font-medium rounded-lg hover:bg-purple-700 disabled:opacity-50">
                {actionLoading ? 'Reviewing…' : '🤖 AI Review'}
              </button>
              {!showManualResolve && (
                <button onClick={() => setShowManualResolve(true)} className="px-4 py-2 bg-gray-600 text-white text-sm font-medium rounded-lg hover:bg-gray-700">
                  Manual Resolution
                </button>
              )}
              {canReEval && !showReEval && (
                <button
                  onClick={() => setShowReEval(true)}
                  className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600"
                >
                  Re-evaluate
                </button>
              )}
              {showReEval && (
                <div className="w-full space-y-2">
                  <textarea
                    value={newInfo}
                    onChange={(e) => setNewInfo(e.target.value)}
                    placeholder="Enter new information for re-evaluation…"
                    rows={3}
                    className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
                  />
                  <div className="flex gap-2">
                    <button
                      onClick={handleReEvaluate}
                      disabled={actionLoading || !newInfo.trim()}
                      className="px-4 py-2 bg-orange-500 text-white text-sm font-medium rounded-lg hover:bg-orange-600 disabled:opacity-50"
                    >
                      {actionLoading ? 'Submitting…' : 'Submit Re-evaluation'}
                    </button>
                    <button onClick={() => { setShowReEval(false); setNewInfo(''); }} className="text-gray-400 hover:text-gray-600 text-sm">Cancel</button>
                  </div>
                </div>
              )}
            </div>
          </div>
        ) : (
          <div className="p-6 text-center text-red-500">Failed to load dispute details.</div>
        )}
      </div>
    </div>
  );
}

/* ─── Create Dispute Modal ─── */
function CreateDisputeModal({ onClose, onCreated }) {
  const [form, setForm] = useState({ merchant_id: 1, customer_id: '', invoice_id: '', claim_details: '' });
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState(null);

  const updateField = (field, value) => setForm((f) => ({ ...f, [field]: value }));

  const handleSubmit = async (e) => {
    e.preventDefault();
    setError(null);
    setSubmitting(true);
    try {
      await post('/disputes', {
        merchant_id: Number(form.merchant_id),
        customer_id: Number(form.customer_id),
        invoice_id: Number(form.invoice_id),
        claim_details: form.claim_details,
      });
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
          <h2 className="text-lg font-semibold text-gray-900">Create Dispute</h2>
          <button onClick={onClose} className="text-gray-400 hover:text-gray-600 text-xl leading-none">&times;</button>
        </div>
        <form onSubmit={handleSubmit} className="p-6 space-y-4">
          {error && <div className="text-sm text-red-600 bg-red-50 border border-red-200 rounded-lg p-2">{error}</div>}

          <div className="grid grid-cols-2 gap-4">
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Customer ID</label>
              <input type="number" required min="1" value={form.customer_id} onChange={(e) => updateField('customer_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
            <div>
              <label className="block text-sm font-medium text-gray-700 mb-1">Invoice ID</label>
              <input type="number" required min="1" value={form.invoice_id} onChange={(e) => updateField('invoice_id', e.target.value)}
                className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" />
            </div>
          </div>

          <div>
            <label className="block text-sm font-medium text-gray-700 mb-1">Claim Details</label>
            <textarea
              required
              rows={4}
              value={form.claim_details}
              onChange={(e) => updateField('claim_details', e.target.value)}
              placeholder="Describe the issue in detail…"
              className="w-full px-3 py-2 border border-gray-300 rounded-lg text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
            />
          </div>

          <div className="flex justify-end gap-3 pt-2">
            <button type="button" onClick={onClose} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
            <button type="submit" disabled={submitting}
              className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700 disabled:opacity-50">
              {submitting ? 'Submitting…' : 'Submit Dispute'}
            </button>
          </div>
        </form>
      </div>
    </div>
  );
}

/* ─── Main Disputes Page ─── */
export default function Disputes() {
  const [disputes, setDisputes] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [activeTab, setActiveTab] = useState('all');
  const [search, setSearch] = useState('');
  const [selectedDispute, setSelectedDispute] = useState(null);
  const [showCreate, setShowCreate] = useState(false);

  const fetchDisputes = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const params = new URLSearchParams();
      if (activeTab !== 'all') params.set('status', activeTab);
      const qs = params.toString();
      const res = await get(`/disputes${qs ? `?${qs}` : ''}`);
      setDisputes(res.data || res || []);
    } catch (err) {
      setError(err.message);
    }
    setLoading(false);
  }, [activeTab]);

  useEffect(() => { fetchDisputes(); }, [fetchDisputes]);

  const filtered = search
    ? disputes.filter((d) => {
        const q = search.toLowerCase();
        return (
          String(d.id).includes(q) ||
          (d.customer_name || '').toLowerCase().includes(q) ||
          String(d.invoice_id).includes(q) ||
          (d.claim_details || '').toLowerCase().includes(q)
        );
      })
    : disputes;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-bold text-gray-900">Disputes</h1>
          <p className="mt-1 text-sm text-gray-500">Track and resolve customer disputes.</p>
        </div>
        <button onClick={() => setShowCreate(true)}
          className="px-4 py-2 bg-indigo-600 text-white text-sm font-medium rounded-lg hover:bg-indigo-700">
          + New Dispute
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

      {/* Search */}
      <div className="flex items-center gap-3">
        <input
          type="text"
          placeholder="Search by ID, customer, invoice…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
          className="px-3 py-2 border border-gray-300 rounded-lg text-sm w-72 focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500"
        />
      </div>

      {/* Table */}
      <div className="bg-white rounded-xl shadow-sm border border-gray-200">
        <DisputeTable disputes={filtered} loading={loading} onRowClick={setSelectedDispute} />
      </div>

      {/* Detail Modal */}
      <DisputeDetailModal
        dispute={selectedDispute}
        onClose={() => setSelectedDispute(null)}
        onRefresh={fetchDisputes}
      />

      {/* Create Modal */}
      {showCreate && (
        <CreateDisputeModal onClose={() => setShowCreate(false)} onCreated={fetchDisputes} />
      )}
    </div>
  );
}
