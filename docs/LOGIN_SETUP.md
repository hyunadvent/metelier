# 로그인과 저장 설정 (Supabase + Google)

Metelier 는 로그인을 Supabase Auth 에 맡긴다. 코드는 준비되어 있고, 아래 설정을 마치면 실제 구글 로그인이 된다.
설정이 없으면 개발 서버(`npm run dev`)에서는 **개발용 가짜 로그인**으로 화면 흐름만 시험할 수 있다 (어디에도 접속하지 않는다).

## 1. Supabase 프로젝트 만들기

1. https://supabase.com 에서 계정을 만들고 새 프로젝트를 만든다.
2. Project Settings → API 에서 **Project URL** 과 **anon public key** 를 확인한다.
3. 저장소 루트의 `.env.example` 을 `.env.local` 로 복사하고 두 값을 넣는다.

```
VITE_SUPABASE_URL=https://<프로젝트>.supabase.co
VITE_SUPABASE_ANON_KEY=<anon public key>
```

`service_role` 키는 서버 전용 비밀 키이므로 절대 `.env.local` 이나 코드에 넣지 않는다.

## 2. Google 로그인 켜기

1. Google Cloud Console → API 및 서비스 → OAuth 동의 화면을 만든다 (외부, 앱 이름 Metelier).
2. 사용자 인증 정보 → OAuth 클라이언트 ID 만들기 → 웹 애플리케이션.
   - 승인된 리디렉션 URI: `https://<프로젝트>.supabase.co/auth/v1/callback`
3. 받은 클라이언트 ID 와 보안 비밀을 Supabase → Authentication → Sign In / Providers → Google 에 넣고 켠다.
4. Supabase → Authentication → URL Configuration
   - Site URL: 배포 주소 (예: `https://<사용자>.github.io/metelier/`)
   - Redirect URLs: `http://localhost:5173/**` 와 배포 주소를 더한다.

## 3. 저장 공간 만들기 (동기화)

Supabase → SQL Editor 에서 저장소 루트의 [`supabase/schema.sql`](../supabase/schema.sql) 을 붙여 넣고 한 번 실행한다.

- `metelier_items` 표: 화실 꾸밈, 칠하던 그림, 작품집, 사진 그림의 목록 (작은 정보)
- `metelier` 파일 저장소(비공개): 칠한 픽셀, 작품 이미지, 사진 그림 파일 (경로: `<사용자 ID>/<종류>/<그림 ID>`)
- 표의 행과 파일은 모두 로그인한 그 사람만 읽고 쓸 수 있다 (RLS 정책 포함)

여러 번 실행해도 괜찮다.

## 4. 카카오 (나중에)

Supabase 는 카카오 로그인을 기본으로 지원한다 (Authentication → Providers → Kakao).
카카오 개발자 콘솔에서 앱을 만들고 REST API 키와 Client Secret 을 넣은 뒤,
`src/auth/auth.ts` 의 `LOGIN_PROVIDERS` 에서 카카오의 `available` 을 `true` 로 바꾸면 된다.

## 5. 사내 네트워크

회사 샌드박스 환경에서는 허용된 도메인만 접속된다. 개발 중 실제 로그인을 시험하려면
`<프로젝트>.supabase.co`, `accounts.google.com` 접속이 필요하므로 도메인 등록을 요청한다.
