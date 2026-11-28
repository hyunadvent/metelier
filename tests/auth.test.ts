import { describe, expect, it } from 'vitest';
import { createClient } from '@supabase/supabase-js';
import { createAuthBackend, LOGIN_PROVIDERS, toMetelierUser } from '../src/auth/auth';

describe('로그인', () => {
  it('Supabase 설정이 있으면 Supabase 로, 없으면 개발 서버에서만 가짜 로그인을 쓴다', () => {
    const client = createClient('https://example.supabase.co', 'public-anon-key', { auth: { persistSession: false } });
    expect(createAuthBackend({ client, dev: false }).mode).toBe('supabase');
    expect(createAuthBackend({ client: null, dev: true }).mode).toBe('dev');
    expect(createAuthBackend({ client: null, dev: false }).mode).toBe('off');
  });

  it('설정이 없는 배포본에서는 로그인하지 못하고 그 까닭을 알려 준다', async () => {
    const off = createAuthBackend({ client: null, dev: false });
    expect(await off.currentUser()).toBeNull();
    await expect(off.signIn('google')).rejects.toThrow('준비 중');
  });

  it('개발용 가짜 로그인은 로그인과 로그아웃을 알린다', async () => {
    const dev = createAuthBackend({ client: null, dev: true });
    const seen: (string | null)[] = [];
    const stop = dev.subscribe((user) => seen.push(user?.name ?? null));
    await dev.signIn('google');
    await dev.signOut();
    stop();
    await dev.signIn('google');
    expect(seen).toEqual(['시험 화가', null]);
  });

  it('구글은 바로 쓸 수 있고 카카오는 준비 중이다', () => {
    expect(LOGIN_PROVIDERS.map((p) => [p.id, p.available])).toEqual([
      ['google', true],
      ['kakao', false],
    ]);
  });

  it('사용자 정보에서 이름과 사진을 꺼낸다', () => {
    expect(
      toMetelierUser({ id: 'u1', email: 'painter@example.com', user_metadata: { full_name: ' 김화가 ', avatar_url: 'https://example.com/a.png' } }),
    ).toEqual({ id: 'u1', name: '김화가', email: 'painter@example.com', avatarUrl: 'https://example.com/a.png' });
    // 이름이 없으면 메일 주소의 앞부분, 그것도 없으면 "화가"
    expect(toMetelierUser({ id: 'u2', email: 'brush@example.com', user_metadata: {} }).name).toBe('brush');
    expect(toMetelierUser({ id: 'u3', email: undefined, user_metadata: { picture: 'https://example.com/p.png' } })).toEqual({
      id: 'u3',
      name: '화가',
      email: null,
      avatarUrl: 'https://example.com/p.png',
    });
  });
});
