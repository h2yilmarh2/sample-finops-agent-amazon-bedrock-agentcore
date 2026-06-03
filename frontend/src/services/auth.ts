import {
  CognitoUserPool,
  CognitoUser,
  AuthenticationDetails,
  CognitoUserSession,
} from 'amazon-cognito-identity-js';
import { fromCognitoIdentityPool } from '@aws-sdk/credential-providers';
import type { AppSettings, AuthState } from '../types';

let currentSession: CognitoUserSession | null = null;
let currentUser: CognitoUser | null = null;

function getUserPool(settings: AppSettings): CognitoUserPool {
  return new CognitoUserPool({
    UserPoolId: settings.userPoolId,
    ClientId: settings.userPoolClientId,
  });
}

export function signIn(
  username: string,
  password: string,
  settings: AppSettings
): Promise<{ success: boolean; newPasswordRequired?: boolean; userAttributes?: Record<string, string> }> {
  return new Promise((resolve, reject) => {
    const userPool = getUserPool(settings);
    const cognitoUser = new CognitoUser({
      Username: username,
      Pool: userPool,
    });

    const authDetails = new AuthenticationDetails({
      Username: username,
      Password: password,
    });

    cognitoUser.authenticateUser(authDetails, {
      onSuccess: (session) => {
        currentSession = session;
        currentUser = cognitoUser;
        resolve({ success: true });
      },
      onFailure: (err) => {
        reject(err);
      },
      newPasswordRequired: (userAttributes) => {
        currentUser = cognitoUser;
        // Remove non-writable attributes
        delete userAttributes.email_verified;
        delete userAttributes.phone_number_verified;
        resolve({ success: false, newPasswordRequired: true, userAttributes });
      },
    });
  });
}

export function completeNewPassword(
  newPassword: string,
  userAttributes: Record<string, string>
): Promise<boolean> {
  return new Promise((resolve, reject) => {
    if (!currentUser) {
      reject(new Error('No user in password change flow'));
      return;
    }

    currentUser.completeNewPasswordChallenge(newPassword, userAttributes, {
      onSuccess: (session) => {
        currentSession = session;
        resolve(true);
      },
      onFailure: (err) => {
        reject(err);
      },
    });
  });
}

export function getAuthState(): AuthState {
  if (currentSession && currentSession.isValid()) {
    return {
      isAuthenticated: true,
      username: currentUser?.getUsername() || null,
      idToken: currentSession.getIdToken().getJwtToken(),
      accessToken: currentSession.getAccessToken().getJwtToken(),
    };
  }
  return {
    isAuthenticated: false,
    username: null,
    idToken: null,
    accessToken: null,
  };
}

export function getAwsCredentials(settings: AppSettings) {
  const authState = getAuthState();
  if (!authState.idToken) {
    throw new Error('Not authenticated');
  }

  const loginKey = `cognito-idp.${settings.region}.amazonaws.com/${settings.userPoolId}`;

  return fromCognitoIdentityPool({
    identityPoolId: settings.identityPoolId,
    logins: {
      [loginKey]: authState.idToken,
    },
    clientConfig: { region: settings.region },
  });
}

export function signOut(): void {
  if (currentUser) {
    currentUser.signOut();
  }
  currentSession = null;
  currentUser = null;
}

export function refreshSession(settings: AppSettings): Promise<boolean> {
  return new Promise((resolve) => {
    const userPool = getUserPool(settings);
    const user = userPool.getCurrentUser();
    
    if (!user) {
      resolve(false);
      return;
    }

    user.getSession((err: Error | null, session: CognitoUserSession | null) => {
      if (err || !session || !session.isValid()) {
        resolve(false);
        return;
      }
      currentSession = session;
      currentUser = user;
      resolve(true);
    });
  });
}
