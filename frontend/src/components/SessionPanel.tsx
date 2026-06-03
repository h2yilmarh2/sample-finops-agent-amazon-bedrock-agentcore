import type { Session } from '../types';

interface SessionPanelProps {
  sessions: Session[];
  activeSessionId: string | null;
  onSelectSession: (session: Session) => void;
  onNewSession: () => void;
}

export default function SessionPanel({
  sessions,
  activeSessionId,
  onSelectSession,
  onNewSession,
}: SessionPanelProps) {
  const formatDate = (timestamp: number) => {
    const date = new Date(timestamp);
    const now = new Date();
    const isToday = date.toDateString() === now.toDateString();
    
    if (isToday) {
      return date.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
    }
    return date.toLocaleDateString([], { month: 'short', day: 'numeric' });
  };

  return (
    <div className="w-64 bg-gray-850 border-r border-gray-700 flex flex-col h-full" style={{ backgroundColor: '#1a1d23' }}>
      {/* Header */}
      <div className="p-4 border-b border-gray-700">
        <button
          onClick={onNewSession}
          className="w-full py-2.5 px-4 bg-purple-600 hover:bg-purple-700 text-white text-sm font-medium rounded-lg transition-colors flex items-center justify-center gap-2"
        >
          <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M12 4v16m8-8H4" />
          </svg>
          New Chat
        </button>
      </div>

      {/* Sessions List */}
      <div className="flex-1 overflow-y-auto p-2">
        {sessions.length === 0 ? (
          <div className="text-center text-gray-500 text-sm mt-8 px-4">
            No conversations yet. Start a new chat!
          </div>
        ) : (
          <div className="space-y-1">
            {sessions.map((session) => (
              <button
                key={session.id}
                onClick={() => onSelectSession(session)}
                className={`w-full text-left px-3 py-2.5 rounded-lg transition-colors text-sm ${
                  activeSessionId === session.id
                    ? 'bg-purple-600/20 border border-purple-500/30 text-white'
                    : 'text-gray-300 hover:bg-gray-700/50'
                }`}
              >
                <div className="truncate font-medium">{session.name}</div>
                <div className="text-xs text-gray-500 mt-0.5">
                  {formatDate(session.createdAt)}
                  {session.messages.length > 0 && (
                    <span className="ml-2">· {session.messages.length} msgs</span>
                  )}
                </div>
              </button>
            ))}
          </div>
        )}
      </div>

      {/* Footer */}
      <div className="p-3 border-t border-gray-700 text-xs text-gray-500 text-center">
        Last {sessions.length} sessions
      </div>
    </div>
  );
}
