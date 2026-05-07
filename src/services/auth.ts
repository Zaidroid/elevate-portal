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
  /** True when the token will expire in < 5 minutes */
  sessionExpiringSoon: boolean;
  /** True when the token has already expired and refresh failed twice */
  sessionExpired: boolean;
  /** True while a silent refresh attempt is in flight. */
  refreshing: boolean;
  /** Number of consecutive silent-refresh failures. Reset on success. */
  refreshFailures: number;
}

class AuthService {
  private state: AuthState = {
    isAuthenticated: false,
    user: null,
    isLoading: true,
    error: null,
    hasAccessToken: false,
    sessionExpiringSoon: false,
    sessionExpired: false,
    refreshing: false,
    refreshFailures: 0,
  };

  private listeners: Set<(state: AuthState) => void> = new Set();
  private tokenClient: any = null;
  /** Single watchdog interval — cleared before re-creating to prevent stacking. */
  private watchdogInterval: ReturnType<typeof setInterval> | null = null;
  /** Set true when the in-flight tokenClient response is a silent refresh. */
  private inflightSilent = false;

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
      // Start watchdog only when a session was restored.
      if (this.state.isAuthenticated) this.startTokenWatchdog();
    } catch (error) {
      console.error('Auth init error:', error);
      this.state.isLoading = false;
      this.state.error = 'Failed to initialize authentication';
      this.notifyListeners();
    }
  }

  /**
   * Background watchdog. Tick every 30s; only update FLAGS — never
   * auto-call requestAccessToken. The previous attempt at proactive
   * silent refresh popped a hidden Google popup on every tick because
   * Chrome's Tracking Protection (third-party cookies blocked since
   * 2024) makes `prompt: 'none'` fall back to a visible auth flow.
   * The user sees a login window flash every minute. Removed.
   *
   * UX instead: at 5 min remaining, expose a soft "Session expires
   * soon — Extend" pill in the header. The user clicks → that calls
   * `requestAccessToken({ prompt: '' })` which is the same flow as
   * sign-in (top-level popup, expected). At 0 min remaining, show the
   * red "Session expired — Re-sign in" banner.
   *
   * Idempotent: re-calling clears the previous interval.
   */
  private startTokenWatchdog() {
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    const CHECK_MS = 30_000;
    const WARN_AT_MS = 5 * 60_000;

    const tick = () => {
      const expiry = parseInt(localStorage.getItem('token_expiry') || '0');
      const remaining = expiry - Date.now();
      if (remaining > 0 && remaining <= WARN_AT_MS) {
        if (!this.state.sessionExpiringSoon || this.state.refreshing) {
          this.state.sessionExpiringSoon = true;
          this.state.refreshing = false;
          this.notifyListeners();
        }
      } else if (remaining > WARN_AT_MS) {
        if (this.state.sessionExpiringSoon) {
          this.state.sessionExpiringSoon = false;
          this.notifyListeners();
        }
      }
      // remaining <= 0 is left alone here. The session-expired flag is
      // flipped by a real 401 from Google (sheets/client.ts) — that's
      // the authoritative signal. Local clock can drift; we don't
      // tear the user out of their work on local-clock alone.
    };

    this.watchdogInterval = setInterval(tick, CHECK_MS);
  }

  /**
   * Triggered by the user clicking "Extend session" in the header
   * banner. Pops the standard Google auth flow — same as sign-in,
   * which the user expects.
   */
  public extendSession() {
    if (!this.tokenClient) return;
    this.state.refreshing = true;
    this.notifyListeners();
    try {
      this.inflightSilent = false; // user-initiated
      this.tokenClient.requestAccessToken({ prompt: '' });
    } catch (err) {
      this.state.refreshing = false;
      this.state.error = 'Could not extend session — please re-sign in.';
      this.notifyListeners();
      console.warn('[auth] extendSession failed', err);
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
    const wasSilent = this.inflightSilent;
    this.inflightSilent = false;

    if (response.error) {
      console.warn('[auth] tokenClient error:', response.error, wasSilent ? '(silent path)' : '(interactive path)');
      if (wasSilent) {
        // Silent refresh failure. First failure → just note it; the
        // user keeps working with the (still-valid-ish) old token. A
        // permanent failure code (interaction_required, login_required,
        // consent_required) means the user must reconsent — flip
        // expired immediately. Generic transient errors get a second
        // chance.
        const permanent = ['interaction_required', 'login_required', 'consent_required'].includes(response.error);
        this.state.refreshing = false;
        this.state.refreshFailures += 1;
        if (permanent || this.state.refreshFailures >= 2) {
          this.state.sessionExpired = true;
          this.state.sessionExpiringSoon = true;
        }
        this.notifyListeners();
        return;
      }
      // Interactive path — show the error to the user.
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

      // Reset watchdog flags on fresh token (covers both interactive
      // sign-in and successful silent refresh).
      this.state.sessionExpiringSoon = false;
      this.state.sessionExpired = false;
      this.state.refreshing = false;
      this.state.refreshFailures = 0;

      if (wasSilent) {
        console.log('[auth] silent refresh succeeded · token now expires in', Math.floor(expiresIn / 60), 'min');
      } else {
        console.log('✅ Login successful:', email, 'role:', role);
        console.log('✅ Access token expires in:', Math.floor(expiresIn / 60), 'minutes');
      }

      this.notifyListeners();
      // Restart the watchdog now that we have a fresh token.
      this.startTokenWatchdog();
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
    if (this.watchdogInterval) {
      clearInterval(this.watchdogInterval);
      this.watchdogInterval = null;
    }
    this.inflightSilent = false;
    this.state = {
      isAuthenticated: false, user: null, isLoading: false, error: null, hasAccessToken: false,
      sessionExpiringSoon: false, sessionExpired: false, refreshing: false, refreshFailures: 0,
    };
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
    extendSession: () => authService.extendSession(),
  };
}
