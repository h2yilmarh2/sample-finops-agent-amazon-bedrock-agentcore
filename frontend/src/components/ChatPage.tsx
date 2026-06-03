import { useState, useEffect, useCallback } from 'react';
import SessionPanel from './SessionPanel';
import ChatWindow from './ChatWindow';
import Settings from './Settings';
import { invokeAgent } from '../services/agentcore';
import { getSessions, createSession, addMessageToSession, getSession } from '../services/sessions';
import { getAuthState, signOut } from '../services/auth';
import type { AppSettings, Session, Message } from '../types';

interface ChatPageProps {
  settings: AppSettings;
  onSettingsChange: (settings: AppSettings) => void;
  onLogout: () => void;
}

export default function ChatPage({ settings, onSettingsChange, onLogout }: ChatPageProps) {
  const [sessions, setSessions] = useState<Session[]>([]);
  const [activeSession, setActiveSession] = useState<Session | null>(null);
  const [loadingSessions, setLoadingSessions] = useState<Set<string>>(new Set());
  const [showSettings, setShowSettings] = useState(false);

  const isLoading = activeSession ? loadingSessions.has(activeSession.id) : false;

  const loadSessions = useCallback(() => {
    const allSessions = getSessions();
    setSessions(allSessions);
    return allSessions;
  }, []);

  useEffect(() => {
    const allSessions = loadSessions();
    if (allSessions.length > 0 && !activeSession) {
      setActiveSession(allSessions[0]);
    }
  }, [loadSessions, activeSession]);

  const handleNewSession = () => {
    const session = createSession();
    setSessions(getSessions());
    setActiveSession(session);
  };

  const handleSelectSession = (session: Session) => {
    // Reload from storage to get latest messages
    const fresh = getSession(session.id);
    setActiveSession(fresh || session);
  };

  const handleSendMessage = async (content: string) => {
    if (!activeSession) return;

    const authState = getAuthState();
    if (!authState.isAuthenticated || !authState.username) {
      onLogout();
      return;
    }

    // Add user message
    const userMessage: Message = {
      id: crypto.randomUUID(),
      role: 'user',
      content,
      timestamp: Date.now(),
    };

    const updatedSession = addMessageToSession(activeSession.id, userMessage);
    if (updatedSession) {
      setActiveSession({ ...updatedSession });
      setSessions(getSessions());
    }

    // Call agent
    const sessionId = activeSession.id;
    setLoadingSessions((prev) => new Set(prev).add(sessionId));
    try {
      const response = await invokeAgent(
        content,
        activeSession.id,
        authState.username,
        settings
      );

      const agentMessage: Message = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: response,
        timestamp: Date.now(),
      };

      const finalSession = addMessageToSession(activeSession.id, agentMessage);
      if (finalSession) {
        setActiveSession((current) => current?.id === sessionId ? { ...finalSession } : current);
        setSessions(getSessions());
      }
    } catch (err: unknown) {
      const errorMsg = err instanceof Error ? err.message : 'Failed to get response';
      const errorMessage: Message = {
        id: crypto.randomUUID(),
        role: 'agent',
        content: `⚠️ Error: ${errorMsg}`,
        timestamp: Date.now(),
      };

      const finalSession = addMessageToSession(activeSession.id, errorMessage);
      if (finalSession) {
        setActiveSession((current) => current?.id === sessionId ? { ...finalSession } : current);
        setSessions(getSessions());
      }
    } finally {
      setLoadingSessions((prev) => {
        const next = new Set(prev);
        next.delete(sessionId);
        return next;
      });
    }
  };

  const handleLogout = () => {
    signOut();
    onLogout();
  };

  return (
    <div className="h-screen flex bg-gray-900">
      {/* Sidebar */}
      <SessionPanel
        sessions={sessions}
        activeSessionId={activeSession?.id || null}
        onSelectSession={handleSelectSession}
        onNewSession={handleNewSession}
      />

      {/* Main Area */}
      <div className="flex-1 flex flex-col">
        {/* Top Bar */}
        <header className="h-14 bg-gray-800 border-b border-gray-700 flex items-center justify-between px-4">
          <div className="flex items-center gap-2">
            <span className="text-lg">💰</span>
            <h1 className="text-white font-semibold text-sm">FinOps Agent</h1>
          </div>
          <div className="flex items-center gap-3">
            <span className="text-gray-400 text-xs">
              {getAuthState().username}
            </span>
            <button
              onClick={() => setShowSettings(true)}
              className="text-gray-400 hover:text-white transition-colors p-1.5 rounded-lg hover:bg-gray-700"
              title="Settings"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M10.325 4.317c.426-1.756 2.924-1.756 3.35 0a1.724 1.724 0 002.573 1.066c1.543-.94 3.31.826 2.37 2.37a1.724 1.724 0 001.066 2.573c1.756.426 1.756 2.924 0 3.35a1.724 1.724 0 00-1.066 2.573c.94 1.543-.826 3.31-2.37 2.37a1.724 1.724 0 00-2.573 1.066c-.426 1.756-2.924 1.756-3.35 0a1.724 1.724 0 00-2.573-1.066c-1.543.94-3.31-.826-2.37-2.37a1.724 1.724 0 00-1.066-2.573c-1.756-.426-1.756-2.924 0-3.35a1.724 1.724 0 001.066-2.573c-.94-1.543.826-3.31 2.37-2.37.996.608 2.296.07 2.572-1.065z" />
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M15 12a3 3 0 11-6 0 3 3 0 016 0z" />
              </svg>
            </button>
            <button
              onClick={handleLogout}
              className="text-gray-400 hover:text-red-400 transition-colors p-1.5 rounded-lg hover:bg-gray-700"
              title="Sign Out"
            >
              <svg className="w-5 h-5" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M17 16l4-4m0 0l-4-4m4 4H7m6 4v1a3 3 0 01-3 3H6a3 3 0 01-3-3V7a3 3 0 013-3h4a3 3 0 013 3v1" />
              </svg>
            </button>
          </div>
        </header>

        {/* Chat Window */}
        <div className="flex-1 overflow-hidden">
          {activeSession ? (
            <ChatWindow
              messages={activeSession.messages}
              loading={isLoading}
              onSendMessage={handleSendMessage}
            />
          ) : (
            <div className="flex items-center justify-center h-full">
              <div className="text-center">
                <p className="text-gray-400 text-lg">Start a new chat to begin</p>
                <button
                  onClick={handleNewSession}
                  className="mt-4 py-2 px-6 bg-purple-600 hover:bg-purple-700 text-white rounded-lg transition-colors"
                >
                  New Chat
                </button>
              </div>
            </div>
          )}
        </div>
      </div>

      {/* Settings Modal */}
      {showSettings && (
        <Settings
          settings={settings}
          onSave={onSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </div>
  );
}
