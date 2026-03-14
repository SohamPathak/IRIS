import { useState, useEffect, useCallback } from 'react';
import { get, post, put, del } from '../services/api.js';

const CONDITION_TYPES = [
  { value: 'refund_threshold', label: 'Refund Threshold' },
  { value: 'emi_eligibility', label: 'EMI Eligibility' },
  { value: 'reminder_timing', label: 'Reminder Timing' },
  { value: 'risk_threshold', label: 'Risk Threshold' },
];

const typeBadge = (type) => {
  const colors = {
    refund_threshold: 'bg-red-100 text-red-800',
    emi_eligibility: 'bg-blue-100 text-blue-800',
    reminder_timing: 'bg-yellow-100 text-yellow-800',
    risk_threshold: 'bg-orange-100 text-orange-800',
  };
  return colors[type] || 'bg-gray-100 text-gray-800';
};

const typeLabel = (type) => CONDITION_TYPES.find(t => t.value === type)?.label || type;

export default function PolicyEditor() {
  const [rules, setRules] = useState([]);
  const [templates, setTemplates] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [showForm, setShowForm] = useState(false);
  const [editingRule, setEditingRule] = useState(null);
  const [form, setForm] = useState({ name: '', condition_type: '', condition_value: '', action_type: '', action_value: '' });
  const [saving, setSaving] = useState(false);
  const [filter, setFilter] = useState('');

  const fetchRules = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await get('/policies');
      setRules(res.data || []);
    } catch (err) {
      setError(err.message || 'Failed to load policies');
    } finally {
      setLoading(false);
    }
  }, []);

  const fetchTemplates = useCallback(async () => {
    try {
      const res = await get('/policies/templates');
      setTemplates(res.data || []);
    } catch { /* templates are optional */ }
  }, []);

  useEffect(() => { fetchRules(); fetchTemplates(); }, [fetchRules, fetchTemplates]);

  const resetForm = () => {
    setForm({ name: '', condition_type: '', condition_value: '', action_type: '', action_value: '' });
    setEditingRule(null);
    setShowForm(false);
  };

  const applyTemplate = (tpl) => {
    setForm({
      name: tpl.name,
      condition_type: tpl.condition_type,
      condition_value: tpl.condition_value,
      action_type: tpl.action_type,
      action_value: tpl.action_value,
    });
    setEditingRule(null);
    setShowForm(true);
  };

  const startEdit = (rule) => {
    setForm({
      name: rule.name,
      condition_type: rule.condition_type,
      condition_value: rule.condition_value,
      action_type: rule.action_type,
      action_value: rule.action_value,
    });
    setEditingRule(rule);
    setShowForm(true);
  };

  const handleSave = async () => {
    setSaving(true);
    setError(null);
    try {
      if (editingRule) {
        await put(`/policies/${editingRule.id}`, form);
      } else {
        await post('/policies', form);
      }
      resetForm();
      await fetchRules();
    } catch (err) {
      setError(err.message || 'Failed to save policy');
    } finally {
      setSaving(false);
    }
  };

  const handleDelete = async (id) => {
    if (!confirm('Delete this policy rule?')) return;
    try {
      await del(`/policies/${id}`);
      await fetchRules();
    } catch (err) {
      setError(err.message || 'Failed to delete policy');
    }
  };

  const toggleActive = async (rule) => {
    try {
      await put(`/policies/${rule.id}`, { is_active: rule.is_active ? 0 : 1 });
      await fetchRules();
    } catch (err) {
      setError(err.message || 'Failed to update policy');
    }
  };

  const filtered = filter ? rules.filter(r => r.condition_type === filter) : rules;
  const formValid = form.name && form.condition_type && form.condition_value && form.action_type && form.action_value;

  return (
    <div className="space-y-6">
      <div className="flex items-center justify-between">
        <h1 className="text-2xl font-bold text-gray-900">Policy Editor</h1>
        <button onClick={() => { resetForm(); setShowForm(true); }}
          className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700">
          + New Rule
        </button>
      </div>

      {error && (
        <div className="bg-red-50 border border-red-200 text-red-700 px-4 py-3 rounded-lg flex justify-between">
          <span>{error}</span>
          <button onClick={() => setError(null)} className="font-bold">×</button>
        </div>
      )}

      {/* Templates */}
      {templates.length > 0 && (
        <div className="bg-white rounded-lg shadow p-4">
          <h2 className="text-sm font-medium text-gray-500 mb-3">Quick Templates</h2>
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-4 gap-3">
            {templates.map((tpl, i) => (
              <button key={i} onClick={() => applyTemplate(tpl)}
                className="text-left border rounded-lg p-3 hover:bg-indigo-50 hover:border-indigo-300 transition">
                <span className={`inline-block px-2 py-0.5 rounded-full text-xs font-medium mb-1 ${typeBadge(tpl.condition_type)}`}>
                  {typeLabel(tpl.condition_type)}
                </span>
                <p className="text-sm font-medium text-gray-900">{tpl.name}</p>
                <p className="text-xs text-gray-500 mt-1">{tpl.description}</p>
              </button>
            ))}
          </div>
        </div>
      )}

      {/* Filter tabs */}
      <div className="flex gap-2 flex-wrap">
        <button onClick={() => setFilter('')}
          className={`px-3 py-1.5 rounded-lg text-sm ${!filter ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
          All ({rules.length})
        </button>
        {CONDITION_TYPES.map(ct => {
          const count = rules.filter(r => r.condition_type === ct.value).length;
          return (
            <button key={ct.value} onClick={() => setFilter(ct.value)}
              className={`px-3 py-1.5 rounded-lg text-sm ${filter === ct.value ? 'bg-indigo-600 text-white' : 'bg-gray-100 text-gray-700 hover:bg-gray-200'}`}>
              {ct.label} ({count})
            </button>
          );
        })}
      </div>

      {/* Rules list */}
      {loading ? (
        <div className="space-y-3">{[...Array(3)].map((_, i) => (
          <div key={i} className="bg-white rounded-lg shadow p-4 animate-pulse">
            <div className="h-4 bg-gray-200 rounded w-1/2 mb-2" />
            <div className="h-3 bg-gray-200 rounded w-3/4" />
          </div>
        ))}</div>
      ) : filtered.length === 0 ? (
        <div className="bg-white rounded-lg shadow p-8 text-center text-gray-500">
          No policy rules found. Create one or use a template above.
        </div>
      ) : (
        <div className="space-y-3">
          {filtered.map(rule => (
            <div key={rule.id} className={`bg-white rounded-lg shadow p-4 border-l-4 ${rule.is_active ? 'border-green-500' : 'border-gray-300'}`}>
              <div className="flex items-start justify-between">
                <div className="flex-1">
                  <div className="flex items-center gap-2 mb-1">
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${typeBadge(rule.condition_type)}`}>
                      {typeLabel(rule.condition_type)}
                    </span>
                    <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${rule.is_active ? 'bg-green-100 text-green-800' : 'bg-gray-100 text-gray-500'}`}>
                      {rule.is_active ? 'Active' : 'Inactive'}
                    </span>
                  </div>
                  <p className="text-sm font-medium text-gray-900">{rule.name}</p>
                  <div className="mt-2 grid grid-cols-2 gap-x-6 gap-y-1 text-xs text-gray-600">
                    <span>Condition: <span className="font-medium text-gray-800">{rule.condition_value}</span></span>
                    <span>Action: <span className="font-medium text-gray-800">{rule.action_type}</span></span>
                    <span>Action Value: <span className="font-medium text-gray-800">{rule.action_value}</span></span>
                    <span>Updated: {new Date(rule.updated_at).toLocaleDateString()}</span>
                  </div>
                </div>
                <div className="flex gap-2 ml-4">
                  <button onClick={() => toggleActive(rule)}
                    className={`px-3 py-1 rounded text-xs font-medium ${rule.is_active ? 'bg-gray-100 text-gray-600 hover:bg-gray-200' : 'bg-green-100 text-green-700 hover:bg-green-200'}`}>
                    {rule.is_active ? 'Disable' : 'Enable'}
                  </button>
                  <button onClick={() => startEdit(rule)}
                    className="px-3 py-1 rounded text-xs font-medium bg-indigo-100 text-indigo-700 hover:bg-indigo-200">Edit</button>
                  <button onClick={() => handleDelete(rule.id)}
                    className="px-3 py-1 rounded text-xs font-medium bg-red-100 text-red-700 hover:bg-red-200">Delete</button>
                </div>
              </div>
            </div>
          ))}
        </div>
      )}

      {/* Create/Edit Modal */}
      {showForm && (
        <div className="fixed inset-0 bg-black/50 flex items-center justify-center z-50" onClick={resetForm}>
          <div className="bg-white rounded-xl shadow-xl w-full max-w-lg p-6" onClick={e => e.stopPropagation()}>
            <h2 className="text-lg font-bold text-gray-900 mb-4">
              {editingRule ? 'Edit Policy Rule' : 'Create Policy Rule'}
            </h2>
            <div className="space-y-4">
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Rule Name</label>
                <input value={form.name} onChange={e => setForm({ ...form, name: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g., Auto-approve small refunds" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Condition Type</label>
                <select value={form.condition_type} onChange={e => setForm({ ...form, condition_type: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm">
                  <option value="">Select...</option>
                  {CONDITION_TYPES.map(ct => (
                    <option key={ct.value} value={ct.value}>{ct.label}</option>
                  ))}
                </select>
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Condition Value</label>
                <input value={form.condition_value} onChange={e => setForm({ ...form, condition_value: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g., 500" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Action Type</label>
                <input value={form.action_type} onChange={e => setForm({ ...form, action_type: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g., auto_approve_refund" />
              </div>
              <div>
                <label className="block text-sm font-medium text-gray-700 mb-1">Action Value</label>
                <input value={form.action_value} onChange={e => setForm({ ...form, action_value: e.target.value })}
                  className="w-full border rounded-lg px-3 py-2 text-sm" placeholder="e.g., approve_if_under_threshold" />
              </div>
            </div>
            <div className="flex justify-end gap-3 mt-6">
              <button onClick={resetForm} className="px-4 py-2 text-sm text-gray-600 hover:text-gray-800">Cancel</button>
              <button onClick={handleSave} disabled={saving || !formValid}
                className="bg-indigo-600 text-white px-4 py-2 rounded-lg text-sm hover:bg-indigo-700 disabled:opacity-50 disabled:cursor-not-allowed">
                {saving ? 'Saving...' : editingRule ? 'Update Rule' : 'Create Rule'}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
