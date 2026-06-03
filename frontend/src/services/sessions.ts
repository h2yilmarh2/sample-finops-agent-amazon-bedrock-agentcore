import type { Session, Message } from '../types';

const SESSIONS_KEY = 'finops_agent_sessions';
const MAX_SESSIONS = 10;

export function getSessions(): Session[] {
  const data = localStorage.getItem(SESSIONS_KEY);
  if (!data) return [];
  try {
    return JSON.parse(data) as Session[];
  } catch {
    return [];
  }
}

export function saveSession(session: Session): void {
  const sessions = getSessions();
  const existingIndex = sessions.findIndex((s) => s.id === session.id);
  
  if (existingIndex >= 0) {
    sessions[existingIndex] = session;
  } else {
    sessions.unshift(session);
  }

  // Keep only the last MAX_SESSIONS
  const trimmed = sessions.slice(0, MAX_SESSIONS);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(trimmed));
}

export function getSession(id: string): Session | null {
  const sessions = getSessions();
  return sessions.find((s) => s.id === id) || null;
}

export function createSession(): Session {
  const session: Session = {
    id: crypto.randomUUID(),
    name: 'New Chat',
    createdAt: Date.now(),
    messages: [],
  };
  saveSession(session);
  return session;
}

export function addMessageToSession(sessionId: string, message: Message): Session | null {
  const session = getSession(sessionId);
  if (!session) return null;

  session.messages.push(message);
  
  // Update session name from first user message
  if (session.name === 'New Chat' && message.role === 'user') {
    session.name = message.content.slice(0, 40) + (message.content.length > 40 ? '...' : '');
  }

  saveSession(session);
  return session;
}

export function deleteSession(id: string): void {
  const sessions = getSessions().filter((s) => s.id !== id);
  localStorage.setItem(SESSIONS_KEY, JSON.stringify(sessions));
}
