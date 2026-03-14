import { useState, useEffect } from 'react';
import { get, post, put } from '../services/api';

const emptyForm = { name: '', description: '', unit: 'meters', available_quantity: '', min_price_per_unit: '', max_price_per_unit: '' };

export default function Inventory() {
  const [commodities, setCommodities] = useState([]);
  const [loading, setLoading] = useState(true);
  const [showForm, setShowForm] = useState(false);
  const [editing, setEditing] = useState(null);
  const [form, setForm] = useState(emptyForm);
  const [error, setError] = useState('');

  useEffect(() => { fetchCommodities(); }, []);

  async function fetchCommodities() {
    try {
      const res = await get('/commodities');
      setCommodities(res.data || []);
    } catch (e) { setError(e.message); }
    finally { setLoading(false); }
  }

  function openCreate() { setForm(emptyForm); setEditing(null); setShowForm(true); setError(''); }
  function openEdit(c) {
    setForm({ name: c.name, description: c.description || '', unit: c.unit, available_quantity: c.available_quantity, min_price_per_unit: c.min_price_per_unit, max_price_per_unit: c.max_price_per_unit });
    setEditing(c.id); setShowForm(true); setError('');
  }

  async function handleSubmit(e) {
    e.preventDefault();
    setError('');
    const payload = { ...form, available_quantity: Number(form.available_quantity), min_price_per_unit: Number(form.min_price_per_unit), max_price_per_unit: Number(form.max_price_per_unit) };
    if (payload.min_price_per_unit > payload.max_price_per_unit) { setError('Min price cannot exceed max price'); return; }
    if (payload.available_quantity < 0) { setError('Quantity cannot be negative'); return; }
    try {
      if (editing) { await put(`/commodities/${editing}`, payload); }
      else { await post('/commodities', payload); }
      setShowForm(false); fetchCommodities();
    } catch (e) { setError(e.message); }
  }

  function stockLevel(qty) {
    if (qty <= 0) return <span className="text-red-600 font-semibold">Out of Stock</span>;
    if (qty < 50) return <span className="text-yellow-600 font-semibold">Low</span>;
    return <span className="text-green-600 font-semibold">In Stock</span>;
  }

  if (loading) return <p className="text-gray-500">Loading inventory…</p>;

  return (
    <div>
      <div className="flex items-center justify-between mb-6">
        <div>
          <h2 className="text-2xl font-bold text-gray-900">Inventory</h2>
          <p className="text-sm text-gray-500 mt-1">Manage commodity stock and pricing</p>
        </div>
        <button onClick={openCreate} className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">+ Add Commodity</button>
      </div>

      {error && <div className="bg-red-50 text-red-700 p-3 rounded-lg mb-4 text-sm">{error}</div>}

      {showForm && (
        <div className="fixed inset-0 bg-black/40 flex items-center justify-center z-50">
          <form onSubmit={handleSubmit} className="bg-white rounded-xl shadow-xl p-6 w-full max-w-md space-y-4">
            <h3 className="text-lg font-bold">{editing ? 'Edit Commodity' : 'Add Commodity'}</h3>
            <input required placeholder="Name" value={form.name} onChange={e => setForm({...form, name: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" />
            <input placeholder="Description" value={form.description} onChange={e => setForm({...form, description: e.target.value})} className="w-full border rounded-lg px-3 py-2 text-sm" />
            <div className="grid grid-cols-2 gap-3">
              <select value={form.unit} onChange={e => setForm({...form, unit: e.target.value})} className="border rounded-lg px-3 py-2 text-sm">
                <option value="meters">Meters</option><option value="kg">Kg</option><option value="pieces">Pieces</option><option value="rolls">Rolls</option>
              </select>
              <input required type="number" min="0" step="0.01" placeholder="Quantity" value={form.available_quantity} onChange={e => setForm({...form, available_quantity: e.target.value})} className="border rounded-lg px-3 py-2 text-sm" />
            </div>
            <div className="grid grid-cols-2 gap-3">
              <input required type="number" min="0" step="0.01" placeholder="Min Price (₹)" value={form.min_price_per_unit} onChange={e => setForm({...form, min_price_per_unit: e.target.value})} className="border rounded-lg px-3 py-2 text-sm" />
              <input required type="number" min="0" step="0.01" placeholder="Max Price (₹)" value={form.max_price_per_unit} onChange={e => setForm({...form, max_price_per_unit: e.target.value})} className="border rounded-lg px-3 py-2 text-sm" />
            </div>
            {error && <p className="text-red-600 text-xs">{error}</p>}
            <div className="flex justify-end gap-2">
              <button type="button" onClick={() => setShowForm(false)} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button type="submit" className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm font-medium hover:bg-indigo-700">{editing ? 'Update' : 'Create'}</button>
            </div>
          </form>
        </div>
      )}

      <div className="bg-white rounded-xl shadow-sm border overflow-hidden">
        <table className="w-full text-sm">
          <thead className="bg-gray-50 border-b">
            <tr>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Name</th>
              <th className="text-left px-4 py-3 font-medium text-gray-600">Unit</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Quantity</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Min Price</th>
              <th className="text-right px-4 py-3 font-medium text-gray-600">Max Price</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Stock Level</th>
              <th className="text-center px-4 py-3 font-medium text-gray-600">Actions</th>
            </tr>
          </thead>
          <tbody className="divide-y">
            {commodities.map(c => (
              <tr key={c.id} className="hover:bg-gray-50">
                <td className="px-4 py-3 font-medium text-gray-900">{c.name}</td>
                <td className="px-4 py-3 text-gray-600">{c.unit}</td>
                <td className="px-4 py-3 text-right text-gray-900">{Number(c.available_quantity).toFixed(1)}</td>
                <td className="px-4 py-3 text-right text-gray-900">₹{Number(c.min_price_per_unit).toFixed(2)}</td>
                <td className="px-4 py-3 text-right text-gray-900">₹{Number(c.max_price_per_unit).toFixed(2)}</td>
                <td className="px-4 py-3 text-center">{stockLevel(c.available_quantity)}</td>
                <td className="px-4 py-3 text-center">
                  <button onClick={() => openEdit(c)} className="text-indigo-600 hover:text-indigo-800 text-xs font-medium">Edit</button>
                </td>
              </tr>
            ))}
            {commodities.length === 0 && <tr><td colSpan="7" className="px-4 py-8 text-center text-gray-400">No commodities found</td></tr>}
          </tbody>
        </table>
      </div>
    </div>
  );
}
