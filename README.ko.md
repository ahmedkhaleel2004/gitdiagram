# GitDiagram (한국어)

GitHub 저장소를 불러와 구조를 분석하고, 단 몇 초 만에 상호작용 가능한 Mermaid.js 시스템 다이어그램으로 시각화합니다.

- URL 바로 사용: 어떤 GitHub URL이든 `github` 대신 `diagram`으로 바꿔 접속하면 해당 저장소 다이어그램 페이지로 이동합니다.
- 예: `https://github.com/user/repo` → `https://diagram.com/user/repo` (서비스 도메인/배포 환경에 따라 상이)

## 주요 기능
- 즉시 시각화: 저장소의 파일 트리/README를 분석하여 시스템 설계/아키텍처 다이어그램 생성
- 상호작용: 다이어그램 노드를 클릭해 관련 파일/디렉터리로 이동(클릭 이벤트에 경로 내장)
- 빠른 생성: OpenAI o4-mini 기반으로 빠르고 정확한 다이어그램 생성(스트리밍)
- 커스터마이즈: 추가 지침을 입력해 재생성/수정 가능
- API: 비용 추정/다이어그램 생성 스트리밍 엔드포인트 제공(백엔드)

## 기술 스택
- 프론트엔드: Next.js, TypeScript, Tailwind CSS, shadcn/ui
- 백엔드: FastAPI(Python), SSE(서버-전송-이벤트)
- DB: PostgreSQL(Drizzle ORM)
- AI: OpenAI o4-mini (이전: Claude 3.5 Sonnet)
- 배포: Vercel(프론트), EC2 등(백엔드)
- 분석: PostHog, api-analytics

## 핵심 로직(원리)
본 프로젝트는 3단계 프롬프트 파이프라인으로 안정적인 Mermaid 다이어그램을 생성합니다.

1) 설명 생성(SYSTEM_FIRST_PROMPT)
- 입력: 전체 파일 트리(<file_tree>), README(<readme>)
- 출력: 시스템 설계/아키텍처 설명(<explanation>)

2) 컴포넌트-경로 매핑(SYSTEM_SECOND_PROMPT)
- 입력: <explanation>, <file_tree>
- 출력: 다이어그램 구성요소와 저장소 경로 간 매핑(<component_mapping>)

3) Mermaid 코드 생성(SYSTEM_THIRD_PROMPT)
- 입력: <explanation>, <component_mapping>
- 출력: Mermaid v11.4.1 유효한 다이어그램 코드(클릭 이벤트에 경로 포함)

주요 안정화 포인트
- Mermaid v11.4.1 문법 엄수: 지원 타입( graph/flowchart, sequenceDiagram, classDiagram, stateDiagram(-v2), erDiagram, journey, gantt, pie, mindmap, timeline, gitGraph )만 허용. 불확실 시 `graph TD`로 폴백.
- 문자열 인용: 특수문자 포함 노드/엣지 라벨은 반드시 따옴표로 감싸도록 프롬프트에 강제.
- subgraph 제약: subgraph 선언에 클래스 직접 지정 금지(노드/class 사용).
- 클릭 이벤트: 노드명에는 경로를 노출하지 않고, `click Node "path/to"` 형태만 추가. 서버에서 GitHub blob/tree URL로 후처리.
- 프롬프트 강화: 모델이 비표준 타입/문법을 생성하지 않도록 엄격한 가이드 삽입.

스트리밍 및 프록시
- 프론트엔드는 `/api/generate/stream`(Next.js API Route)로 SSE를 동일 출처 요청으로 전송.
- Next.js API Route가 FastAPI의 `/generate/stream`으로 프록시.
- 비용 추정도 `/api/generate/cost` → FastAPI `/generate/cost`로 프록시.
- Codespaces/SSL 환경에서 혼합 콘텐츠 및 직접 localhost 접근 문제를 회피.

SSR/Hydration 안정화
- 루트 레이아웃의 `<html>`, `<body>`에 `suppressHydrationWarning` 적용해 확장 프로그램 주입 속성으로 인한 경고를 완화.
- Mermaid 렌더는 클라이언트 컴포넌트에서 수행하고, `svg-pan-zoom`은 동적 import 처리.

Server Actions/오리진
- 개발 환경 포트 변동 및 포워딩 도메인(Codespaces)을 고려해 `next.config.js`의 `experimental.serverActions.allowedOrigins`에 허용 오리진을 넓게 설정.
- FastAPI CORS도 로컬/포워딩 도메인을 포함해 개발 중 CORS 이슈 최소화.

## 프라이빗 저장소 다이어그램 생성
- 헤더의 “Private Repos” 버튼 클릭 → `repo` 스코프의 GitHub Personal Access Token(PAT) 입력.
- 또는 로컬(Self-host) 환경에서 직접 실행.

## 로컬 개발/자가 호스팅
1) 클론
```bash
git clone https://github.com/ahmedkhaleel2004/gitdiagram.git
cd gitdiagram
```
2) 의존성 설치
```bash
pnpm i
```
3) 환경변수 설정
```bash
cp .env.example .env
# 필요시 .env.local 작성 (예: 프록시 타깃 등)
```
4) 백엔드 실행(FastAPI)
```bash
docker compose up -d --build
# 백엔드: http://localhost:8000
```
5) DB 시작
```bash
chmod +x start-database.sh
./start-database.sh
# Postgres: localhost:5432
```
6) 스키마 초기화
```bash
pnpm db:push
```
7) 프론트엔드 실행(Next.js)
```bash
pnpm dev
# 프론트: http://localhost:3000
```

## 주의/트러블슈팅
- 비용 추정/스트리밍 실패: 반드시 동일 출처 경로(`/api/generate/*`)를 사용. Next.js API Route가 내부적으로 FastAPI로 프록시합니다.
- Mermaid 오류: v11.4.1 문법을 엄수하지 않으면 렌더 오류가 발생. 프롬프트가 강제하고 있으므로, 재생성 시 보통 해소됩니다.
- Hydration 경고: 브라우저 확장으로 인한 `<html>`/`<body>` 속성 주입 시 경고는 무시되며, UI에는 영향이 없습니다.

## 기여
PR 환영합니다. 버그/개선 제안은 이슈로 남겨 주세요.

## 라이선스
MIT
