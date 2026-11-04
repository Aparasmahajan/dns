import { createContext, useCallback, useContext, useEffect, useState, type ReactNode } from 'react';
import { api, ApiError } from './api';
import type { Me, PublicConfig } from './types';

interface AuthContextValue {
  me: Me | null;
  config: PublicConfig;
  loading: boolean;
  login: (username: string, password: string) => Promise<void>;
  logout: () => Promise<void>;
  refresh: () => Promise<void>;
  setMe: (me: Me) => void;
}

const defaultConfig: PublicConfig = {
  portalName: 'DNS Management Portal',
  orgName: 'F5 BIG-IP DNS',
  siteName: '',
  siteRole: '',
  version: '',
  ldapEnabled: false,
  passwordMinLength: 12,
};

const AuthContext = createContext<AuthContextValue | null>(null);

export function AuthProvider({ children }: { children: ReactNode }) {
  const [me, setMe] = useState<Me | null>(null);
  const [config, setConfig] = useState<PublicConfig>(defaultConfig);
  const [loading, setLoading] = useState(true);

  const refresh = useCallback(async () => {
    try {
      setMe(await api.get<Me>('/api/auth/me'));
    } catch (e) {
      if (e instanceof ApiError && e.status === 401) setMe(null);
      else throw e;
    }
  }, []);

  useEffect(() => {
    (async () => {
      // Loading the public config also sets the CSRF cookie needed by the login form.
      try {
        setConfig(await api.get<PublicConfig>('/api/public/config'));
      } catch {
        /* keep defaults */
      }
      try {
        await refresh();
      } catch {
        setMe(null);
      }
      setLoading(false);
    })();
  }, [refresh]);

  useEffect(() => {
    const onUnauthorized = () => setMe(null);
    window.addEventListener('portal:unauthorized', onUnauthorized);
    return () => window.removeEventListener('portal:unauthorized', onUnauthorized);
  }, []);

  const login = useCallback(async (username: string, password: string) => {
    setMe(await api.post<Me>('/api/auth/login', { username, password }));
  }, []);

  const logout = useCallback(async () => {
    try {
      await api.post('/api/auth/logout');
    } catch {
      /* session may already be gone */
    }
    setMe(null);
  }, []);

  return (
    <AuthContext.Provider value={{ me, config, loading, login, logout, refresh, setMe }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth(): AuthContextValue {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be used inside AuthProvider');
  return ctx;
}

/** The signed-in user. Only use inside the signed-in layout. */
export function useMe(): Me {
  const { me } = useAuth();
  if (!me) throw new Error('Not signed in');
  return me;
}
