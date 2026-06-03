import { useState, useEffect } from 'react';
import LoginPage from './components/LoginPage';
import ChatPage from './components/ChatPage';
import Settings from './components/Settings';
import { refreshSession } from './services/auth';
import type { AppSettings } from './types';

const SETTINGS_KEY = 'finops_agent_settings';

function loadSettings(): AppSettings {
  const saved = localStorage.getItem(SETTINGS_KEY);
  if (saved) {
    try {
      return JSON.parse(saved) as AppSettings;
    } catch {
      // fall through
    }
  }
  return {
    userPoolId: '',
    userPoolClientId: '',
    identityPoolId: '',
    agentCoreArn: '',
    region: 'us-east-1',
  };
}

function saveSettings(settings: AppSettings) {
  localStorage.setItem(SETTINGS_KEY, JSON.stringify(settings));
}

export default function App() {
  const [isAuthenticated, setIsAuthenticated] = useState(false);
  const [settings, setSettings] = useState<AppSettings>(loadSettings);
  const [showSettings, setShowSettings] = useState(false);
  const [initializing, setInitializing] = useState(true);

  useEffect(() => {
    // Try to restore session on load
    const tryRestore = async () => {
      if (settings.userPoolId && settings.userPoolClientId) {
        const restored = await refreshSession(settings);
        if (restored) {
          setIsAuthenticated(true);
        }
      }
      setInitializing(false);
    };
    tryRestore();
  }, [settings.userPoolId, settings.userPoolClientId]);

  const handleSettingsChange = (newSettings: AppSettings) => {
    setSettings(newSettings);
    saveSettings(newSettings);
  };

  const handleLogin = () => {
    setIsAuthenticated(true);
  };

  const handleLogout = () => {
    setIsAuthenticated(false);
  };

  if (initializing) {
    return (
      <div className="min-h-screen bg-gray-900 flex items-center justify-center">
        <div className="text-center">
          <svg className="animate-spin h-8 w-8 text-purple-500 mx-auto mb-4" viewBox="0 0 24 24">
            <circle className="opacity-25" cx="12" cy="12" r="10" stroke="currentColor" strokeWidth="4" fill="none" />
            <path className="opacity-75" fill="currentColor" d="M4 12a8 8 0 018-8V0C5.373 0 0 5.373 0 12h4z" />
          </svg>
          <p className="text-gray-400">Loading...</p>
        </div>
      </div>
    );
  }

  return (
    <>
      {isAuthenticated ? (
        <ChatPage
          settings={settings}
          onSettingsChange={handleSettingsChange}
          onLogout={handleLogout}
        />
      ) : (
        <LoginPage
          settings={settings}
          onLogin={handleLogin}
          onOpenSettings={() => setShowSettings(true)}
        />
      )}

      {showSettings && !isAuthenticated && (
        <Settings
          settings={settings}
          onSave={handleSettingsChange}
          onClose={() => setShowSettings(false)}
        />
      )}
    </>
  );
}
