import { useState, useEffect } from 'react';
import { get, post, patch } from '../services/api';
import NegotiationChat from '../components/NegotiationChat';

const STATUS_COLORS = { submitted: 'bg-blue-100 text-blue-700', negotiating: 'bg-yellow-100 text-yellow-700', approved: 'bg-green-100 text-green-700', rejected: 'bg-red-100 text-red-700', expired: 'bg-gray-100 text-gray-600' };
const STATUSES = ['all', 'submitted', 'negotiating', 'approved', 'rejected', 'expired'];

export default function Bids() {
  const [bids, setBids] = useState([]);
  const [loading, setLoading] = useState(true);
  const [filter, setFilter] = useState('all');
  const [selectedBid, setSelectedBid] = useState(null);
  const [bidDetail, setBidDetail] = useState(null);
  const [error, setError] = useState('');
  const [showNewBid, setShowNewBid] = useState(false);
  const [newBidForm, setNewBidForm] = useState({ buyer_id: '', commodity_id: '', requested_quantity: '', offered_price_per_unit: '' });
  const [customers, setCustomers] = useState([]);
  const [commodities, setCommodities] = useState([]);

  useEffect(() => { fetchBids(); fetchDropdowns(); }, []);

  async function fetchDropdowns() {
    try {
      const [custRes, commRes] = await Promise.all([get('/customers'), get('/commodities')]);
      setCustomers(custRes.data || []);
      setCommodities(commRes.data || []);
    } catch (e) { /* dropdowns will be empty */ }
  }

  async function fetchBids() {
    try {
      const res = await get('/bids');
      setBids(res.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  async function selectBid(bid) {
    setSelectedBid(bid);
    try {
      const res = await get(`/bids/${bid.id}`);
      setBidDetail(res.data || res);
    } catch (e) { setError(e.message); }
  }

  async function handleApprove(bidId) {
    try {
      await patch(`/bids/${bidId}/approve`);
      fetchBids(); setSelectedBid(null); setBidDetail(null);
    } catch (e) { setError(e.message); }
  }

  async function handleNewBid(e) {
    e.preventDefault(); setError('');
    try {
      const bidPayload = {
        buyer_id: Number(newBidForm.buyer_id), commodity_id: Number(newBidForm.commodity_id),
        requested_quantity: Number(newBidForm.requested_quantity),
        offered_price_per_unit: Number(newBidForm.offered_price_per_unit),
      };
      const res = await post('/bids', bidPayload);
      const bidResult = res.data || res;

      setShowNewBid(false);

      // Build the first buyer message from form inputs
      const selectedCommodity = commodities.find(c => c.id === bidPayload.commodity_id);
      const commodityName = selectedCommodity?.name || 'the commodity';
      const unit = selectedCommodity?.unit || 'units';
      const firstMessage = `Hi, I'd like to buy ${bidPayload.requested_quantity} ${unit} of ${commodityName} at ₹${bidPayload.offered_price_per_unit} per ${unit}. Is this price workable?`;

      // If bid is negotiating, auto-send the first message and open the chat
      if (bidResult.status === 'negotiating' && bidResult.session?.id) {
        try {
          await post(`/negotiations/${bidResult.session.id}/messages`, { message: firstMessage });
        } catch { /* first message send failed, buyer can still type manually */ }

        // Refresh bids and auto-select the new bid
        await fetchBids();
        const freshBid = await get(`/bids/${bidResult.bid.id}`);
        const detail = freshBid.data || freshBid;
        setSelectedBid(detail);
        setBidDetail(detail);
      } else {
        await fetchBids();
      }

      setNewBidForm({ buyer_id: '', commodity_id: '', requested_quantity: '', offered_price_per_unit: '' });
    } catch (e) { setError(e.message); }
  }

  const filtered = filter === 'all' ? bids : bids.filter(b => b.status === filter);
  const sessionId = bidDetail?.negotiation?.id || bidDetail?.negotiation_session_id || selectedBid?.negotiation_session_id;

  if (loading) return <p className="text-gray-500">Loading bids…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Bids</h2>
          <p className="text-sm text-gray-500 mt-1">Manage incoming buyer bids and negotiations</p>
        </div>
        <button onClick={() => setShowNewBid(true)} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">+ New Bid</button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      {showNewBid && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <form onSubmit={handleNewBid} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold">Buyer Conversation Window <span className="text-gray-400 font-normal">— Mock</span></h3>
            <select required value={newBidForm.buyer_id} onChange={e => setNewBidForm({...newBidForm, buyer_id: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select Buyer</option>
              {customers.map(c => <option key={c.id} value={c.id}>{c.name}</option>)}
            </select>
            <select required value={newBidForm.commodity_id} onChange={e => setNewBidForm({...newBidForm, commodity_id: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm">
              <option value="">Select Commodity</option>
              {commodities.map(c => <option key={c.id} value={c.id}>{c.name} (₹{c.min_price_per_unit}–₹{c.max_price_per_unit}/{c.unit})</option>)}
            </select>
            <div className="grid grid-cols-2 gap-3">
              <input required type="number" min="0.01" step="0.01" placeholder="Quantity" value={newBidForm.requested_quantity} onChange={e => setNewBidForm({...newBidForm, requested_quantity: e.target.value})} className="border rounded-lg px-3 py-2 text-sm" />
              <input required type="number" min="0.01" step="0.01" placeholder="Price per unit (₹)" value={newBidForm.offered_price_per_unit} onChange={e => setNewBidForm({...newBidForm, offered_price_per_unit: e.target.value})} className="border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowNewBid(false)} className="px-4 py-2 text-sm text-gray-600">Cancel</button>
              <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">Submit Bid</button>
            </div>
          </form>
        </div>
      )}

      <div className="flex gap-2 mb-4">
        {STATUSES.map(s => (
          <button key={s} onClick={() => setFilter(s)} className={`px-3 py-1.5 rounded-lg text-xs font-medium capitalize ${filter === s ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-600 hover:bg-gray-200'}`}>{s}</button>
        ))}
      </div>

      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        <div className={`${selectedBid ? 'lg:col-span-1' : 'lg:col-span-3'}`}>
          <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
            <table className="w-full text-sm">
              <thead className="bg-gray-50 border-b">
                <tr>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Buyer</th>
                  <th className="text-left px-4 py-3 font-medium text-gray-600">Commodity</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Qty</th>
                  <th className="text-right px-4 py-3 font-medium text-gray-600">Offered ₹</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Status</th>
                  <th className="text-center px-4 py-3 font-medium text-gray-600">Actions</th>
                </tr>
              </thead>
              <tbody className="divide-y">
                {filtered.map(b => (
                  <tr key={b.id} className={`hover:bg-gray-50 cursor-pointer ${selectedBid?.id === b.id ? 'bg-indigo-50' : ''}`} onClick={() => selectBid(b)}>
                    <td className="px-4 py-3 text-gray-900">{b.buyer_name || `Buyer #${b.buyer_id}`}</td>
                    <td className="px-4 py-3 text-gray-600">{b.commodity_name || `Commodity #${b.commodity_id}`}</td>
                    <td className="px-4 py-3 text-right">{Number(b.requested_quantity).toFixed(1)}</td>
                    <td className="px-4 py-3 text-right">₹{Number(b.offered_price_per_unit).toFixed(2)}</td>
                    <td className="px-4 py-3 text-center"><span className={`px-2 py-1 rounded-full text-xs font-medium ${STATUS_COLORS[b.status] || 'bg-gray-100'}`}>{b.status}</span></td>
                    <td className="px-4 py-3 text-center">
                      {(b.status === 'submitted' || b.status === 'negotiating') && (
                        <button onClick={(e) => { e.stopPropagation(); handleApprove(b.id); }} className="text-green-600 hover:text-green-800 text-xs font-medium">Approve</button>
                      )}
                    </td>
                  </tr>
                ))}
                {filtered.length === 0 && <tr><td colSpan="6" className="px-4 py-8 text-center text-gray-400">No bids found</td></tr>}
              </tbody>
            </table>
          </div>
        </div>

        {selectedBid && (
          <div className="lg:col-span-2">
            <div className="bg-white rounded-xl shadow-sm border p-4 mb-4">
              <div className="flex justify-between items-start mb-3">
                <h3 className="font-bold text-gray-900">Bid #{selectedBid.id}</h3>
                <button onClick={() => { setSelectedBid(null); setBidDetail(null); }} className="text-gray-400 hover:text-gray-600">✕</button>
              </div>
              <div className="grid grid-cols-2 gap-3 text-sm">
                <div><span className="text-gray-500">Buyer:</span> <span className="font-medium">{selectedBid.buyer_name || `#${selectedBid.buyer_id}`}</span></div>
                <div><span className="text-gray-500">Commodity:</span> <span className="font-medium">{selectedBid.commodity_name || `#${selectedBid.commodity_id}`}</span></div>
                <div><span className="text-gray-500">Quantity:</span> <span className="font-medium">{Number(selectedBid.requested_quantity).toFixed(1)}</span></div>
                <div><span className="text-gray-500">Offered Price:</span> <span className="font-medium">₹{Number(selectedBid.offered_price_per_unit).toFixed(2)}</span></div>
                <div><span className="text-gray-500">Status:</span> <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_COLORS[selectedBid.status]}`}>{selectedBid.status}</span></div>
                <div><span className="text-gray-500">Created:</span> <span className="font-medium">{new Date(selectedBid.created_at).toLocaleDateString()}</span></div>
              </div>
              {bidDetail?.negotiation?.id && !sessionId && (
                <p className="text-xs text-gray-400 mt-2">Negotiation session: #{bidDetail.negotiation.id}</p>
              )}
            </div>
            {sessionId ? (
              <NegotiationChat sessionId={sessionId} />
            ) : (selectedBid.status === 'negotiating' || selectedBid.status === 'approved') ? (
              <div className="bg-yellow-50 border border-yellow-200 rounded-xl p-4 text-sm text-yellow-700">No negotiation session found for this bid.</div>
            ) : null}
          </div>
        )}
      </div>
    </div>
  );
}
