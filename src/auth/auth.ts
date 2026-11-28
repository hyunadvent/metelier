import type { SupabaseClient, User } from '@supabase/supabase-js';
import { getSupabase } from './supabaseClient';

/**
 * 로그인.
 * - 둘러보기와 색칠은 누구나 할 수 있다. 로그인은 화실과 그림을 다른 브라우저·다른 PC 에서 이어 쓰기 위한 것이다.
 * - 로그인은 Supabase Auth 가 맡는다. 프로젝트 주소와 공개 키(anon key)는 .env.local 의
 *   VITE_SUPABASE_URL, VITE_SUPABASE_ANON_KEY 에 둔다 (공개 키는 브라우저에 실려도 되는 값이다).
 * - 설정이 없으면: 개발 서버에서는 "개발용 가짜 로그인" 으로 화면 흐름을 시험할 수 있고,
 *   배포본에서는 로그인 버튼이 "준비 중" 을 알린다.
 */

export type LoginProviderId = 'google' | 'kakao';

export interface LoginProvider {
  id: LoginProviderId;
  label: string;
  /** false 면 아직 준비 중 */
  available: boolean;
}

/** 로그인 화면에 보여 줄 방법. 카카오는 나중에 연결한다. */
export const LOGIN_PROVIDERS: LoginProvider[] = [
  { id: 'google', label: 'Google로 계속하기', available: true },
  { id: 'kakao', label: '카카오로 계속하기', available: false },
];

export interface MetelierUser {
  id: string;
  name: string;
  email: string | null;
  avatarUrl: string | null;
}

export type AuthMode =
  /** Supabase 에 연결됨 */
  | 'supabase'
  /** 개발 서버에서만: 설정 없이 화면 흐름을 시험하는 가짜 로그인 */
  | 'dev'
  /** 설정이 없어 로그인할 수 없음 */
  | 'off';

export interface AuthBackend {
  mode: AuthMode;
  /** 지금 로그인한 사람. 확인하는 동안은 기다린다. */
  currentUser(): Promise<MetelierUser | null>;
  /** 로그인 상태가 바뀔 때마다 불린다. 돌려주는 함수를 부르면 그만 듣는다. */
  subscribe(listener: (user: MetelierUser | null) => void): () => void;
  /** 로그인 화면(구글 등)으로 간다. Supabase 는 페이지를 떠났다가 돌아온다. */
  signIn(provider: LoginProviderId): Promise<void>;
  signOut(): Promise<void>;
}

/** Supabase 사용자 정보에서 화면에 보여 줄 이름과 사진을 꺼낸다. */
export function toMetelierUser(user: Pick<User, 'id' | 'email' | 'user_metadata'>): MetelierUser {
  const meta = (user.user_metadata ?? {}) as Record<string, unknown>;
  const text = (v: unknown) => (typeof v === 'string' && v.trim() ? v.trim() : null);
  const email = text(user.email);
  return {
    id: user.id,
    name: text(meta.full_name) ?? text(meta.name) ?? text(meta.nickname) ?? (email ? email.split('@')[0] : '화가'),
    email,
    avatarUrl: text(meta.avatar_url) ?? text(meta.picture),
  };
}

/** 로그인하고 돌아올 주소: 지금 페이지(쿼리 없이). 화실이 처음부터 열린다. */
function returnUrl(): string {
  return location.origin + location.pathname;
}

function supabaseBackend(client: SupabaseClient): AuthBackend {
  const get = () => client;
  return {
    mode: 'supabase',
    async currentUser() {
      const { data } = await get().auth.getSession();
      return data.session?.user ? toMetelierUser(data.session.user) : null;
    },
    subscribe(listener) {
      const { data } = get().auth.onAuthStateChange((_event, session) => listener(session?.user ? toMetelierUser(session.user) : null));
      return () => data.subscription.unsubscribe();
    },
    async signIn(provider) {
      const { error } = await get().auth.signInWithOAuth({ provider, options: { redirectTo: returnUrl() } });
      if (error) throw error;
    },
    async signOut() {
      await get().auth.signOut();
    },
  };
}

const DEV_USER_KEY = 'metelier.devUser';

/** 개발 서버 전용 가짜 로그인: 브라우저에 가짜 사용자를 저장할 뿐 어디에도 접속하지 않는다. */
function devBackend(): AuthBackend {
  const listeners = new Set<(user: MetelierUser | null) => void>();
  const read = (): MetelierUser | null => {
    try {
      const raw = localStorage.getItem(DEV_USER_KEY);
      return raw ? (JSON.parse(raw) as MetelierUser) : null;
    } catch {
      return null;
    }
  };
  const write = (user: MetelierUser | null) => {
    try {
      if (user) localStorage.setItem(DEV_USER_KEY, JSON.stringify(user));
      else localStorage.removeItem(DEV_USER_KEY);
    } catch {
      // 저장할 수 없으면 이번 접속 동안만 로그인된다.
    }
    listeners.forEach((l) => l(user));
  };
  return {
    mode: 'dev',
    currentUser: async () => read(),
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    async signIn(provider) {
      write({ id: `dev-${provider}`, name: '시험 화가', email: null, avatarUrl: null });
    },
    async signOut() {
      write(null);
    },
  };
}

function offBackend(): AuthBackend {
  return {
    mode: 'off',
    currentUser: async () => null,
    subscribe: () => () => {},
    async signIn() {
      throw new Error('로그인은 준비 중이에요.');
    },
    async signOut() {},
  };
}

export function createAuthBackend(env: { client: SupabaseClient | null; dev: boolean }): AuthBackend {
  if (env.client) return supabaseBackend(env.client);
  return env.dev ? devBackend() : offBackend();
}

export const authBackend = createAuthBackend({ client: getSupabase(), dev: import.meta.env.DEV });
