// ============================================
// Authentication Service — Google OAuth
// Uses OAuth2 popup flow (more reliable than One Tap)
// ============================================

import { useState, useEffect } from 'react';
import { isAuthorizedUser, getUserRole, getUserByEmail, ALLOWED_DOMAIN } from '../config/team';

export interface GoogleUser {
  email: string;
  name: string;
  picture: string;
  domain: string;
  role: 'admin' | 'user';
  isAuthorized: boolean;
}

interface AuthState {
  isAuthenticated: boolean;
  user: GoogleUser | null;
  isLoading: boolean;
  error: string | null;
  hasAccessToken: boolean;
}

class AuthService {
  private state: AuthState = {
    isAuthenticated: false,
    user: null,
    isLoading: true,
    error: null,
    hasAccessToken: false,
  };

  private listeners: Set<(state: AuthState) => void> = new Set();
  private tokenClient: any = null;

  constructor() {
    this.init();
  }

  private async init() {
    try {
      await this.loadGoogleScript();

      // Initialize the OAuth2 token client (popup-based)
      this.tokenClient = window.google.accounts.oauth2.initTokenClient({
        client_id: import.meta.env.VITE_GOOGLE_CLIENT_ID,
        scope: 'https://www.googleapis.com/auth/spreadsheets https://www.googleapis.com/auth/drive.readonly openid email profile',
        callback: this.handleTokenResponse.bind(this),
      });

      // Try restoring existing session
      const accessToken = localStorage.getItem('google_access_token');
      const tokenExpiry = localStorage.getItem('token_expiry');
      const userEmail = localStorage.getItem('user_email');

      if (accessToken && tokenExpiry && Date.now() < parseInt(tokenExpiry) && userEmail) {
        if (isAuthorizedUser(userEmail)) {
          const teamMember = getUserByEmail(userEmail);
          const role = getUserRole(userEmail);
          this.state.isAuthenticated = true;
          this.state.hasAccessToken = true;
          this.state.user = {
            email: userEmail,
            name: teamMember?.name || userEmail,
            picture: localStorage.getItem('user_picture') || '',
            domain: ALLOWED_DOMAIN,
            role: role!,
            isAuthorized: true,
          };
          console.log('✅ Session restored for:', userEmail);
        }
      }

      this.state.isLoading = false;
      this.notifyListeners();
    } catch (error) {
      console.error('Auth init error:', error);
      this.state.isLoading = false;
      this.state.error = 'Failed to initialize authentication';
      this.notifyListeners();
    }
  }

  private loadGoogleScript(): Promise<void> {
    return new Promise((resolve, reject) => {
      if (window.google?.accounts) { resolve(); return; }
      const script = document.createElement('script');
      script.src = 'https://accounts.google.com/gsi/client';
      script.async = true;
      script.defer = true;
      script.onload = () => resolve();
      script.onerror = () => reject(new Error('Failed to load Google Identity Services'));
      document.head.appendChild(script);
    });
  }

  /**
   * Sign in using OAuth2 popup flow.
   * This opens a Google consent popup (no One Tap / FedCM issues).
   */
  public signIn() {
    if (!this.tokenClient) {
      this.state.error = 'Auth not initialized yet. Please wait.';
      this.notifyListeners();
      return;
    }
    // Show Google OAuth consent popup
    this.tokenClient.requestAccessToken({ prompt: '' });
  }

  /**
   * Handle the token response from OAuth popup.
   * We get an access_token directly — then fetch user info from Google.
   */
  private async handleTokenResponse(response: { error?: string; access_token?: string; expires_in?: number }) {
    if (response.error) {
      console.error('OAuth error:', response.error);
      this.state.error = 'Sign-in was cancelled or failed. Please try again.';
      this.notifyListeners();
      return;
    }

    const accessToken = response.access_token!;
    const expiresIn = response.expires_in || 3600;

    // Store token
    localStorage.setItem('google_access_token', accessToken);
    localStorage.setItem('token_expiry', (Date.now() + expiresIn * 1000).toString());
    this.state.hasAccessToken = true;

    // Fetch user info from Google
    try {
      const userInfo = await fetch('https://www.googleapis.com/oauth2/v3/userinfo', {
        headers: { Authorization: `Bearer ${accessToken}` },
      }).then(r => r.json());

      const email = userInfo.email as string;
      const domain = userInfo.hd as string | undefined;

      console.log('Login attempt:', email, 'domain:', domain);

      // Domain check
      if (domain !== ALLOWED_DOMAIN) {
        this.state.error = `Only @${ALLOWED_DOMAIN} accounts are allowed`;
        this.state.isAuthenticated = false;
        this.state.user = null;
        this.clearTokens();
        this.notifyListeners();
        return;
      }

      // Authorization check
      if (!isAuthorizedUser(email)) {
        this.state.error = 'Your account is not authorized. Contact the administrator.';
        this.state.isAuthenticated = false;
        this.state.user = null;
        this.clearTokens();
        this.notifyListeners();
        return;
      }

      const role = getUserRole(email);
      const teamMember = getUserByEmail(email);

      this.state.isAuthenticated = true;
      this.state.user = {
        email,
        name: teamMember?.name || userInfo.name || email,
        picture: userInfo.picture || '',
        domain: domain!,
        role: role!,
        isAuthorized: true,
      };
      this.state.error = null;

      // Persist user info
      localStorage.setItem('user_email', email);
      localStorage.setItem('user_role', role!);
      localStorage.setItem('user_picture', userInfo.picture || '');

      console.log('✅ Login successful:', email, 'role:', role);
      console.log('✅ Access token expires in:', Math.floor(expiresIn / 60), 'minutes');

      this.notifyListeners();
    } catch (err) {
      console.error('Failed to fetch user info:', err);
      this.state.error = 'Failed to verify your identity. Please try again.';
      this.notifyListeners();
    }
  }

  private clearTokens() {
    localStorage.removeItem('google_access_token');
    localStorage.removeItem('token_expiry');
    localStorage.removeItem('user_email');
    localStorage.removeItem('user_role');
    localStorage.removeItem('user_picture');
  }

  public requestAccessToken() {
    if (this.tokenClient) {
      this.tokenClient.requestAccessToken({ prompt: '' });
    }
  }

  public signOut() {
    const token = localStorage.getItem('google_access_token');
    if (token) {
      // Revoke token
      (window.google?.accounts.oauth2 as any).revoke(token, () => {
        console.log('Token revoked');
      });
    }
    this.clearTokens();
    this.state = { isAuthenticated: false, user: null, isLoading: false, error: null, hasAccessToken: false };
    this.notifyListeners();
    console.log('Signed out');
  }

  public getState(): AuthState { return { ...this.state }; }

  public subscribe(listener: (state: AuthState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  private notifyListeners() {
    this.listeners.forEach(l => l(this.getState()));
  }

  public isAdmin(): boolean { return this.state.user?.role === 'admin'; }
}

export const authService = new AuthService();

/** React hook for auth state */
export function useAuth() {
  const [state, setState] = useState(authService.getState());
  useEffect(() => authService.subscribe(setState), []);
  return {
    ...state,
    signIn: () => authService.signIn(),
    signOut: () => authService.signOut(),
    isAdmin: () => authService.isAdmin(),
    requestAccessToken: () => authService.requestAccessToken(),
  };
}
