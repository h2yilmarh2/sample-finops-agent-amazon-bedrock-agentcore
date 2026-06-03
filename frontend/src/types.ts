export interface AppSettings {
  userPoolId: string;
  userPoolClientId: string;
  identityPoolId: string;
  agentCoreArn: string;
  region: string;
}

export interface Message {
  id: string;
  role: 'user' | 'agent';
  content: string;
  timestamp: number;
}

export interface Session {
  id: string;
  name: string;
  createdAt: number;
  messages: Message[];
}

export interface AuthState {
  isAuthenticated: boolean;
  username: string | null;
  idToken: string | null;
  accessToken: string | null;
}
