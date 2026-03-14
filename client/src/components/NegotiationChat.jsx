import { useState, useEffect, useRef } from 'react';
import { get, post } from '../services/api';

const STATUS_BADGE = { active: 'bg-green-100 text-green-700', completed: 'bg-blue-100 text-blue-700', expired: 'bg-gray-100 text-gray-600' };

function MessageContent({ text }) {
  const lines = text.split('\n');
  return (
    <div className="space-y-1">
      {lines.map((line, i) => {
        if (!line.trim()) return <br key={i} />;
        // Detect payment links (Pine Labs real or mock, any https pay/payment URL)
        const linkMatch = line.match(/(https:\/\/(?:pinelabs\.mock|[^\s]*pinelabs[^\s]*|[^\s]*plural[^\s]*paymentlink[^\s]*))/i)
          || line.match(/(https:\/\/[^\s]+(?:pay|payment)[^\s]*)/i);
        if (linkMatch) {
          const before = line.slice(0, line.indexOf(linkMatch[1]));
          const after = line.slice(line.indexOf(linkMatch[1]) + linkMatch[1].length);
          return (
            <p key={i}>
              <RichText text={before} />
              <a href={linkMatch[1]} target="_blank" rel="noopener noreferrer"
                className="inline-block mt-1 px-3 py-1.5 bg-green-500 text-white rounded-lg text-xs font-medium hover:bg-green-600 shadow-sm">
                💳 Pay via Pine Labs
              </a>
              {after && <RichText text={after} />}
            </p>
          );
        }
        return <p key={i}><RichText text={line} /></p>;
      })}
    </div>
  );
}

/** Render inline markdown bold (**text**) and bullet points */
function RichText({ text }) {
  // Split on **bold** markers
  const parts = text.split(/(\*\*[^*]+\*\*)/g);
  return (
    <>
      {parts.map((part, i) => {
        if (part.startsWith('**') && part.endsWith('**')) {
          return <strong key={i} className="font-semibold">{part.slice(2, -2)}</strong>;
        }
        return <span key={i}>{part}</span>;
      })}
    </>
  );
}

export default function NegotiationChat({ sessionId }) {
  const [session, setSession] = useState(null);
  const [messages, setMessages] = useState([]);
  const [input, setInput] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState('');
  const bottomRef = useRef(null);
  const pollRef = useRef(null);

  useEffect(() => {
    if (sessionId) { fetchSession(); pollRef.current = setInterval(fetchSession, 5000); }
    return () => { if (pollRef.current) clearInterval(pollRef.current); };
  }, [sessionId]);

  useEffect(() => { bottomRef.current?.scrollIntoView({ behavior: 'smooth' }); }, [messages]);

  async function fetchSession() {
    try {
      const res = await get(`/negotiations/${sessionId}`);
      const data = res.data || res;
      setSession(data);
      setMessages(data.messages || []);
    } catch (e) { setError(e.message); }
  }

  async function handleSend(e) {
    e.preventDefault();
    if (!input.trim() || sending) return;
    setSending(true); setError('');
    try {
      await post(`/negotiations/${sessionId}/messages`, { message: input.trim() });
      setInput('');
      await fetchSession();
    } catch (e) { setError(e.message); }
    finally { setSending(false); }
  }

  if (!sessionId) return null;

  return (
    <div className="bg-white rounded-xl shadow-sm border flex flex-col" style={{ height: '520px' }}>
      <div className="px-4 py-3 border-b flex items-center justify-between bg-gray-50">
        <div className="flex items-center gap-2">
          <span className="text-lg">🤝</span>
          <h3 className="font-bold text-sm text-gray-900">Negotiation Chat</h3>
        </div>
        {session && <span className={`px-2 py-0.5 rounded-full text-xs font-medium ${STATUS_BADGE[session.status] || 'bg-gray-100'}`}>{session.status}</span>}
      </div>

      <div className="flex-1 overflow-y-auto p-4 space-y-4">
        {messages.map((msg, i) => (
          <div key={i} className={`flex ${msg.sender === 'buyer' ? 'justify-start' : 'justify-end'}`}>
            <div className={`max-w-[80%] px-4 py-3 rounded-2xl text-sm leading-relaxed ${
              msg.sender === 'buyer'
                ? 'bg-gray-100 text-gray-800 rounded-bl-sm'
                : 'bg-indigo-600 text-white rounded-br-sm'
            }`}>
              <div className="text-xs opacity-70 mb-1.5 font-medium">
                {msg.sender === 'buyer' ? '👤 You (Buyer)' : '🏪 Merchant Agent'}
              </div>
              <MessageContent text={msg.content} />
              <div className="text-xs opacity-50 mt-1.5 text-right">
                {msg.created_at ? new Date(msg.created_at).toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' }) : ''}
              </div>
            </div>
          </div>
        ))}
        {messages.length === 0 && <p className="text-center text-gray-400 text-sm py-8">👋 You're the buyer — send your opening offer to start negotiating!</p>}
        {sending && (
          <div className="flex justify-end">
            <div className="bg-indigo-100 text-indigo-600 px-4 py-2 rounded-2xl text-sm animate-pulse">Agent is typing…</div>
          </div>
        )}
        <div ref={bottomRef} />
      </div>

      {error && <div className="px-4 py-2 text-xs text-red-600 bg-red-50 border-t">{error}</div>}

      {session?.status === 'active' ? (
        <form onSubmit={handleSend} className="border-t p-3 flex gap-2 bg-gray-50">
          <input value={input} onChange={e => setInput(e.target.value)} placeholder="Type your offer as the buyer… e.g. I'd like 50 meters at ₹150/meter" className="flex-1 border rounded-xl px-4 py-2.5 text-sm focus:ring-2 focus:ring-indigo-500 focus:border-indigo-500" disabled={sending} />
          <button type="submit" disabled={sending || !input.trim()} className="bg-indigo-600 text-white px-5 py-2.5 rounded-xl text-sm font-medium hover:bg-indigo-700 disabled:opacity-50 transition-colors">{sending ? '…' : 'Send'}</button>
        </form>
      ) : session?.status === 'completed' ? (
        <div className="border-t p-3 bg-green-50 text-center text-sm text-green-700 font-medium">
          ✅ Negotiation completed — transaction finalized
        </div>
      ) : session?.status === 'expired' ? (
        <div className="border-t p-3 bg-gray-50 text-center text-sm text-gray-500">
          ⏰ This negotiation has expired
        </div>
      ) : null}
    </div>
  );
}
