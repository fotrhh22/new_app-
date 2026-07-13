# Circle 기능 구현 계획

이 문서는 현재 구현된 React + TypeScript + Supabase 기반 Circle 앱에 다음 두 기능을 추가하기 위한 사전 계획이다.

1. 대시보드 페이지
2. 신규 페이지: AI 요청 기록

본 문서 작성 단계에서는 실제 기능 코드와 데이터베이스를 변경하지 않는다. 사용자 승인 후 아래 순서대로 구현한다.

---

# 1. 대시보드 페이지 구현 계획

## 1.1 목적

로그인 사용자가 게시판 활동과 전국 전동휠체어 급속충전기 데이터를 한 화면에서 파악할 수 있는 서비스 요약 페이지를 만든다.

대시보드는 단순 숫자 나열보다 다음 질문에 빠르게 답할 수 있어야 한다.

- 게시판이 현재 얼마나 활발한가?
- 내가 서비스에서 얼마나 활동했는가?
- 최근 어떤 게시글의 반응이 좋은가?
- 전동휠체어 충전기는 어느 지역에 많이 분포하는가?

## 1.2 추천 화면 구성

### 상단: 서비스 KPI 카드 4개

1행 4열로 배치한다.

| 순서 | KPI | 정의 | 데이터 출처 |
| --- | --- | --- | --- |
| 1 | 전체 게시글 | 현재 사용자가 볼 수 있는 게시글 수 | `posts` |
| 2 | 이번 달 게시글 | 이번 달 생성된 게시글 수 | `posts.created_at` |
| 3 | 전체 좋아요 | 조회 가능한 게시글의 좋아요 합계 | `posts.like_count` |
| 4 | 전국 충전기 | 유효 좌표를 가진 충전기 수 | `location.csv` |

### 중단 좌측: 게시글 작성 추이

- 최근 6개월 게시글 작성 건수를 월별 막대 또는 영역 차트로 표시한다.
- 비밀글은 현재 사용자가 조회할 수 있는 데이터만 집계한다.
- X축: 월
- Y축: 게시글 수
- 차트 상단에 전월 대비 증감률을 함께 표시한다.

### 중단 우측: 지역별 충전기 분포

- `location.csv`의 `시도명`을 기준으로 충전기 개수를 집계한다.
- 상위 7개 지역은 가로 막대 차트로 표시한다.
- 나머지 지역은 `기타`로 묶지 않고 필요 시 스크롤 또는 툴팁에서 확인한다.
- 항목 선택 시 `전국전동휠체어급속충전기 위치` 페이지로 이동하면서 해당 지역이 선택되도록 확장할 수 있다.

### 하단 좌측: 인기 게시글

- 좋아요 수를 기준으로 상위 5개 게시글을 표시한다.
- 동점인 경우 조회수, 최신 작성일 순으로 정렬한다.
- 표시 항목: 순위, 제목, 작성자, 좋아요, 조회수
- 비밀글은 작성자 본인의 비밀글만 포함한다.
- 게시글 선택 시 게시판 상세 화면으로 이동한다.

### 하단 우측: 나의 활동 요약

- 내가 작성한 게시글 수
- 내가 작성한 비밀글 수
- 내가 누른 좋아요 수
- 최근 작성 게시글 3개
- `마이 페이지에서 자세히 보기` 버튼 제공

## 1.3 레이아웃

```text
┌──────────────────────────────────────────────────────────────┐
│ KPI 1       │ KPI 2       │ KPI 3       │ KPI 4              │
├─────────────────────────────┬────────────────────────────────┤
│ 최근 6개월 게시글 작성 추이 │ 지역별 충전기 분포             │
├─────────────────────────────┼────────────────────────────────┤
│ 인기 게시글 TOP 5           │ 나의 활동 요약                 │
└─────────────────────────────┴────────────────────────────────┘
```

- 데스크톱: KPI 4열, 콘텐츠 2열
- 태블릿: KPI 2열, 콘텐츠 1열 또는 2열
- 모바일: 모든 카드를 1열로 배치
- 현재 앱의 라임색 강조색, 흰색 카드, 진한 녹색 계열을 유지한다.

## 1.4 데이터 조회 방식

### 게시판 데이터

초기 버전은 Supabase JS의 병렬 쿼리를 사용한다.

- 전체 게시글: `posts` count
- 이번 달 게시글: `created_at >= 이번 달 시작 시각`
- 좋아요 합계: 조회 가능한 `posts.like_count` 합산
- 인기 게시글: `like_count DESC, view_count DESC, created_at DESC`, 5개
- 내 활동: `author_id = auth.uid()` 및 `post_likes.user_id = auth.uid()`

데이터가 많아지면 다음 SQL RPC로 집계를 서버에서 처리한다.

- `get_dashboard_summary()`
- `get_monthly_post_stats(month_count integer)`
- `get_popular_posts(limit_count integer)`

### 충전기 데이터

- UTF-8 변환본 `public/data/location.csv`를 PapaParse로 읽는다.
- 유효한 `위도`, `경도`가 있는 행만 사용한다.
- 전체 개수 및 `시도명`별 개수를 클라이언트에서 집계한다.
- 동일 CSV를 지도 페이지와 대시보드가 각각 파싱하지 않도록 공통 데이터 로더로 분리한다.

## 1.5 추천 파일 구조

```text
src/
├── components/
│   └── dashboard/
│       ├── Dashboard.tsx
│       ├── DashboardKpis.tsx
│       ├── MonthlyPostChart.tsx
│       ├── ChargerRegionChart.tsx
│       ├── PopularPosts.tsx
│       └── MyActivitySummary.tsx
├── hooks/
│   ├── useDashboardStats.ts
│   └── useChargerData.ts
├── lib/
│   └── chargerData.ts
└── types/
    └── dashboard.ts
```

## 1.6 추가 패키지

차트 구현에는 `recharts` 사용을 권장한다.

- React와 TypeScript 지원이 안정적이다.
- 반응형 컨테이너를 제공한다.
- 막대·영역·툴팁 구현이 간결하다.

사용자 승인 후 설치한다.

```bash
npm install recharts
```

## 1.7 구현 순서

1. 대시보드 데이터 타입 정의
2. 충전기 CSV 공통 로더 분리
3. Supabase KPI 병렬 조회 hook 구현
4. KPI 카드 구현
5. 최근 6개월 게시글 추이 집계 및 차트 구현
6. 지역별 충전기 집계 및 차트 구현
7. 인기 게시글과 나의 활동 컴포넌트 구현
8. 상단 `대시보드` 메뉴와 실제 페이지 연결
9. 로딩 skeleton, 빈 상태, 오류 상태 구현
10. 모바일 반응형 스타일 적용
11. TypeScript build 및 ESLint 검증
12. 로그인 사용자 기준 실제 데이터 검증

## 1.8 완료 기준

- 대시보드 메뉴 선택 시 임시 화면이 아닌 실제 대시보드가 표시된다.
- KPI 4개가 실제 Supabase 및 CSV 데이터와 일치한다.
- 최근 6개월 게시글 추이와 지역별 충전기 분포가 차트로 표시된다.
- 비밀글 RLS 규칙이 대시보드에서도 유지된다.
- 인기 게시글과 내 활동 링크가 해당 페이지로 이동한다.
- 로딩·빈 데이터·API 오류 상태가 각각 구분되어 표시된다.
- 360px 모바일 화면과 데스크톱 화면에서 레이아웃이 깨지지 않는다.
- `npm run build`, `npm run lint`가 통과한다.

---

# 2. 신규 페이지 구현 계획: AI 요청 기록

## 2.1 신규 페이지 제안 이유

현재 홈에서는 Gemini에 텍스트와 파일을 보내 답변을 받을 수 있지만 브라우저를 새로고침하면 요청과 답변이 사라진다.

`AI 요청 기록` 페이지를 추가하면 다음 가치가 생긴다.

- 이전 질문과 답변 재확인
- 자주 사용하는 답변 보관
- 첨부파일이 포함된 요청 이력 관리
- 마이페이지와 대시보드에서 AI 사용량 집계 가능
- 향후 대화형 AI, 공유, 검색 기능으로 확장 가능

추천 메뉴 위치는 `홈`과 `게시판` 사이이다.

```text
홈 | AI 요청 기록 | 게시판 | 대시보드 | 전국전동휠체어급속충전기 위치 | 마이페이지
```

## 2.2 화면 구성

### 좌측: 기록 목록

- 페이지 제목 및 전체 요청 수
- 질문 내용 검색 바
- 즐겨찾기만 보기 필터
- 최신순/오래된순 정렬
- 요청 기록 카드 목록
- 페이지 크기 10
- 페이지 번호 최대 5개
- 첫 페이지 `«`, 마지막 페이지 `»`

기록 카드 표시 항목:

- 질문 일부
- 생성 일시
- 첨부파일 여부
- 즐겨찾기 여부
- 답변 생성 상태

### 우측: 요청 상세

- 전체 질문
- 첨부파일 목록
- Gemini 답변
- 답변 복사
- 즐겨찾기 추가·해제
- 기록 삭제
- 같은 질문으로 다시 요청

모바일에서는 목록과 상세를 각각 한 화면으로 전환한다.

## 2.3 데이터베이스 구조

### `public.ai_requests`

| 필드 | Key | 타입 | 설명 |
| --- | --- | --- | --- |
| `id` | PK | `uuid` | 요청 ID |
| `user_id` | FK | `uuid` | `auth.users.id` 참조 |
| `question` |  | `text` | 사용자 질문 |
| `answer` |  | `text` | Gemini 답변 |
| `model` |  | `text` | 사용 모델 |
| `status` |  | `text` | `pending`, `completed`, `failed` |
| `error_message` |  | `text` | 실패 사유 |
| `is_favorite` |  | `boolean` | 즐겨찾기 여부 |
| `created_at` |  | `timestamptz` | 요청 시각 |
| `updated_at` |  | `timestamptz` | 수정 시각 |

### `public.ai_request_attachments`

| 필드 | Key | 타입 | 설명 |
| --- | --- | --- | --- |
| `id` | PK | `uuid` | 첨부파일 ID |
| `request_id` | FK | `uuid` | `ai_requests.id` 참조 |
| `storage_path` | UK | `text` | 비공개 Storage 경로 |
| `original_name` |  | `text` | 원본 파일명 |
| `mime_type` |  | `text` | MIME 타입 |
| `file_size` |  | `bigint` | 파일 크기 |
| `created_at` |  | `timestamptz` | 업로드 시각 |

## 2.4 보안 정책

- `ai_requests.user_id = auth.uid()`인 행만 조회·수정·삭제한다.
- 다른 사용자의 질문과 답변은 검색 결과에도 노출하지 않는다.
- 첨부파일은 비공개 `ai-request-files` bucket에 저장한다.
- Storage 경로는 `{user_id}/{request_id}/{unique_filename}`을 사용한다.
- Gemini API 키는 현재와 동일하게 Supabase Edge Function secret으로만 사용한다.
- 브라우저에는 Gemini API 키 또는 service role key를 제공하지 않는다.

## 2.5 Gemini Edge Function 변경

현재 `ask-ai` 함수에 다음 작업을 추가한다.

1. 사용자 JWT 검증
2. `ai_requests`에 `pending` 레코드 생성
3. 첨부파일 메타데이터 연결
4. Gemini API 호출
5. 성공 시 `answer`, `model`, `status = completed` 저장
6. 실패 시 `status = failed`, `error_message` 저장
7. 프런트엔드에 요청 ID와 답변 반환

Edge Function이 기록 저장을 담당하도록 하여 답변 생성과 기록 저장의 불일치를 줄인다.

## 2.6 추천 파일 구조

```text
src/
├── components/
│   └── ai-history/
│       ├── AiHistory.tsx
│       ├── AiHistoryList.tsx
│       ├── AiHistoryDetail.tsx
│       ├── AiHistorySearch.tsx
│       └── AiHistoryPagination.tsx
├── hooks/
│   └── useAiHistory.ts
└── types/
    └── ai.ts

supabase/
├── functions/
│   └── ask-ai/
│       └── index.ts
└── schema.sql
```

## 2.7 구현 순서

1. `ai_requests`, `ai_request_attachments` 테이블 SQL 작성
2. RLS, 인덱스, Storage bucket 및 정책 작성
3. `ask-ai` Edge Function에 요청 기록 저장 로직 추가
4. 홈의 기존 질문 기능이 요청 ID를 처리하도록 수정
5. AI 요청 기록 데이터 타입과 조회 hook 구현
6. 검색·정렬·즐겨찾기 필터가 있는 목록 구현
7. 상세 답변·파일·복사 기능 구현
8. 즐겨찾기 및 삭제 기능 구현
9. 페이지 크기 10, 화면 페이지 버튼 5개 구현
10. 상단 메뉴에 `AI 요청 기록` 추가
11. 모바일 목록/상세 전환 구현
12. Edge Function 배포 및 실제 Gemini 요청 검증
13. TypeScript build 및 ESLint 검증

## 2.8 완료 기준

- 홈에서 Gemini 질문 후 기록이 자동 저장된다.
- 새로고침하거나 다시 로그인해도 이전 요청과 답변이 표시된다.
- 로그인 사용자는 자신의 기록만 볼 수 있다.
- 질문 검색, 정렬, 즐겨찾기 필터가 동작한다.
- 답변 복사, 즐겨찾기, 삭제, 다시 요청이 동작한다.
- 첨부파일이 비공개 Storage 정책을 통해서만 접근된다.
- 실패한 Gemini 요청도 실패 상태와 함께 기록된다.
- 모바일과 데스크톱에서 목록과 상세를 사용할 수 있다.
- `npm run build`, `npm run lint`가 통과한다.

---

# 3. 승인 후 권장 개발 순서

두 기능을 모두 승인하는 경우 다음 순서를 권장한다.

1. 대시보드 구현
2. AI 요청 기록용 DB 스키마 및 RLS 구현
3. `ask-ai` Edge Function 기록 저장 기능 구현
4. AI 요청 기록 페이지 구현
5. 대시보드에 AI 요청 수 KPI를 추가할지 최종 결정
6. 전체 페이지 통합 테스트

대시보드는 기존 데이터만으로 구현할 수 있어 먼저 완료하기 쉽다. AI 요청 기록은 DB와 Edge Function 변경이 함께 필요하므로 그다음 단계로 진행한다.

## 승인 시 사용할 요청 예시

대시보드만 승인:

> implement.md의 대시보드 계획대로 구현해줘.

신규 페이지까지 모두 승인:

> implement.md의 대시보드와 AI 요청 기록 페이지를 순서대로 모두 구현해줘.

