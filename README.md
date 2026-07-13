# Circle Auth

React + TypeScript + Supabase Auth로 만든 serverless 회원 인증 앱입니다.

## 실행

```bash
npm install
cp .env.example .env.local
npm run dev
```

`.env.local`에 Supabase 프로젝트의 URL과 공개용 anon/publishable key를 입력하세요.

```env
VITE_SUPABASE_URL=https://your-project.supabase.co
VITE_SUPABASE_ANON_KEY=your-key
```

Supabase Dashboard의 **Authentication → URL Configuration**에서 개발 환경의 Site URL을 `http://localhost:5173`으로 설정하세요. 이메일 확인을 켜면 가입 후 확인 메일이 발송되며, 끄면 즉시 로그인됩니다.

## 데이터베이스 설정

Supabase Dashboard의 **SQL Editor → New query**에서 `supabase/schema.sql` 파일 전체를 실행하세요. 다음 항목이 생성됩니다.

- `public.profiles` 회원 프로필 테이블
- 회원가입 시 프로필을 자동 생성하는 트리거
- 프로필 수정 시각을 자동 갱신하는 트리거
- 본인의 프로필만 조회·수정할 수 있는 RLS 정책
- `public.posts`, `public.post_attachments`, `public.post_likes` 게시판 테이블
- 게시글 비밀번호 bcrypt 해시 및 작성·수정·삭제 RPC
- 비밀글 작성자 전용 조회 RLS 정책
- 비공개 `board-files` Storage bucket과 파일 접근 정책
- 게시글 좋아요 개수 자동 동기화 트리거

| 컬럼 | 타입 | 설명 |
| --- | --- | --- |
| `id` | `uuid` | `auth.users.id`와 연결되는 기본 키 |
| `email` | `text` | 회원 이메일 |
| `display_name` | `text` | 회원가입 시 입력한 이름 |
| `avatar_url` | `text` | 프로필 이미지 URL |
| `created_at` | `timestamptz` | 생성 시각 |
| `updated_at` | `timestamptz` | 마지막 수정 시각 |

> Service role key는 브라우저에 절대 넣지 마세요. 이 앱에는 공개용 anon/publishable key만 사용합니다.

## Gemini AI Edge Function

Gemini 요청은 API 키가 브라우저에 노출되지 않도록 `supabase/functions/ask-ai` Edge Function에서 처리합니다.

```bash
npx supabase login
npx supabase link --project-ref YOUR_PROJECT_REF
npx supabase secrets set GEMINI_API_KEY=YOUR_GEMINI_API_KEY
npx supabase functions deploy ask-ai
```

로컬 `.env.local`의 `GEMINI_API_KEY`는 Vite 클라이언트 번들에는 포함되지 않습니다. 배포된 Edge Function에서는 반드시 위 `supabase secrets set` 명령으로 키를 별도로 등록해야 합니다. 기본 모델은 `gemini-3.5-flash`이며 필요하면 `GEMINI_MODEL` secret으로 변경할 수 있습니다. 첨부 파일은 최대 10MB까지 전송됩니다.
