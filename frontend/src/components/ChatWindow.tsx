import { useState, useRef, useEffect } from 'react';
import MessageBubble from './MessageBubble';
import type { Message } from '../types';

interface ChatWindowProps {
  messages: Message[];
  loading: boolean;
  onSendMessage: (content: string) => void;
}

function ThinkingIndicator() {
  const [elapsed, setElapsed] = useState(0);
  const [tipIndex, setTipIndex] = useState(0);

  const tips = [
    '🔍 Analyzing your request...',
    '📊 Querying AWS services...',
    '🧮 Crunching the numbers...',
    '💡 Preparing insights...',
    '🔗 Connecting to tools...',
  ];

  useEffect(() => {
    const timer = setInterval(() => setElapsed((e) => e + 1), 1000);
    return () => clearInterval(timer);
  }, []);

  useEffect(() => {
    const tipTimer = setInterval(() => setTipIndex((i) => (i + 1) % tips.length), 4000);
    return () => clearInterval(tipTimer);
  }, [tips.length]);

  const formatTime = (seconds: number) => {
    if (seconds < 60) return `${seconds}s`;
    return `${Math.floor(seconds / 60)}m ${seconds % 60}s`;
  };

  return (
    <div className="flex justify-start mb-4">
      <div className="bg-gradient-to-r from-gray-700 to-gray-750 rounded-2xl rounded-bl-md px-5 py-4 border border-gray-600 shadow-lg">
        <div className="flex items-center gap-3">
          <div className="relative w-8 h-8">
            <div className="absolute inset-0 rounded-full border-2 border-purple-500/30" />
            <div className="absolute inset-0 rounded-full border-2 border-transparent border-t-purple-400 animate-spin" />
            <div className="absolute inset-2 rounded-full bg-purple-500/20 animate-pulse" />
          </div>
          <div className="flex flex-col">
            <span className="text-gray-200 text-sm font-medium transition-all duration-500">
              {tips[tipIndex]}
            </span>
            <span className="text-purple-400 text-xs font-mono mt-0.5">
              ⏱️ {formatTime(elapsed)}
            </span>
          </div>
        </div>
      </div>
    </div>
  );
}

export default function ChatWindow({ messages, loading, onSendMessage }: ChatWindowProps) {
  const [input, setInput] = useState('');
  const messagesEndRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);

  const scrollToBottom = () => {
    messagesEndRef.current?.scrollIntoView({ behavior: 'smooth' });
  };

  useEffect(() => {
    scrollToBottom();
  }, [messages, loading]);

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    const trimmed = input.trim();
    if (!trimmed || loading) return;
    onSendMessage(trimmed);
    setInput('');
    if (textareaRef.current) {
      textareaRef.current.style.height = 'auto';
    }
  };

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    if (e.key === 'Enter' && !e.shiftKey) {
      e.preventDefault();
      handleSubmit(e);
    }
  };

  const handleTextareaChange = (e: React.ChangeEvent<HTMLTextAreaElement>) => {
    setInput(e.target.value);
    // Auto-resize textarea
    const textarea = e.target;
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 150) + 'px';
  };

  return (
    <div className="flex flex-col h-full">
      {/* Messages Area */}
      <div className="flex-1 overflow-y-auto p-6">
        {messages.length === 0 ? (
          <div className="flex items-center justify-center h-full">
            <div className="text-center">
              <div className="text-6xl mb-4">💰</div>
              <h2 className="text-2xl font-bold text-white mb-2">FinOps Agent</h2>
              <p className="text-gray-400 max-w-md">
                Ask me about your AWS costs, budgets, savings recommendations, and more.
              </p>
            </div>
          </div>
        ) : (
          <div className="max-w-4xl mx-auto">
            {messages.map((msg) => (
              <MessageBubble key={msg.id} message={msg} />
            ))}
            {loading && <ThinkingIndicator />}
            <div ref={messagesEndRef} />
          </div>
        )}
      </div>

      {/* Input Area */}
      <div className="border-t border-gray-700 p-4">
        <form onSubmit={handleSubmit} className="max-w-4xl mx-auto">
          <div className="flex items-end gap-3 bg-gray-700 rounded-xl p-2 border border-gray-600 focus-within:border-purple-500 transition-colors">
            <textarea
              ref={textareaRef}
              value={input}
              onChange={handleTextareaChange}
              onKeyDown={handleKeyDown}
              placeholder="Ask about your AWS costs..."
              rows={1}
              className="flex-1 bg-transparent text-white placeholder-gray-400 resize-none focus:outline-none px-2 py-1.5 text-sm max-h-[150px]"
              disabled={loading}
            />
            <button
              type="submit"
              disabled={!input.trim() || loading}
              className="p-2 bg-purple-600 hover:bg-purple-700 disabled:bg-gray-600 disabled:cursor-not-allowed text-white rounded-lg transition-colors shrink-0"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 19l9 2-9-18-9 18 9-2zm0 0v-8" />
              </svg>
            </button>
          </div>
          <p className="text-xs text-gray-500 mt-2 text-center">
            Press Enter to send, Shift+Enter for new line
          </p>
        </form>
      </div>
    </div>
  );
}
