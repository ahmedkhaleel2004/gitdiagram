[![Image](./docs/readme_img.png "GitDiagram Front Page")](https://gitdiagram.com/)

![License](https://img.shields.io/badge/license-MIT-blue.svg)
[![Kofi](https://img.shields.io/badge/Kofi-F16061.svg?logo=ko-fi&logoColor=white)](https://ko-fi.com/ahmedkhaleel2004)

# GitDiagram (한국어)

GitHub 저장소를 불러와 구조를 분석하고, 단 몇 초 만에 상호작용 가능한 Mermaid.js 시스템 다이어그램으로 시각화합니다.

[English README](./README.en.md)

- URL 바로 사용: 어떤 GitHub URL이든 `github` 대신 `diagram`으로 바꿔 접속하면 해당 저장소 다이어그램 페이지로 이동합니다.
- 예: `https://github.com/user/repo` → `https://diagram.com/user/repo` (서비스 도메인/배포 환경에 따라 상이)

## 🚀 주요 기능
- 즉시 시각화: 저장소의 파일 트리/README를 분석하여 시스템 설계/아키텍처 다이어그램 생성
- 상호작용: 다이어그램 노드를 클릭해 관련 파일/디렉터리로 이동(클릭 이벤트에 경로 내장)
- 빠른 생성: OpenAI o4-mini 기반으로 빠르고 정확한 다이어그램 생성(스트리밍)
- 커스터마이즈: 추가 지침을 입력해 재생성/수정 가능
- API: 비용 추정/다이어그램 생성 스트리밍 엔드포인트 제공(백엔드)

## ⚙️ 기술 스택
- 프론트엔드: Next.js, TypeScript, Tailwind CSS, shadcn/ui
- 백엔드: FastAPI(Python), SSE(서버-전송-이벤트)
- DB: PostgreSQL(Drizzle ORM)
- AI: OpenAI o4-mini (이전: Claude 3.5 Sonnet)
- 배포: Vercel(프론트), EC2 등(백엔드)
- 분석: PostHog, api-analytics

## 🔎 핵심 로직
프롬프트 파이프라인(3단계)으로 Mermaid v11.4.1 문법을 지키는 안정적인 다이어그램을 생성합니다.

1) 설명 생성 → 2) 컴포넌트-경로 매핑 → 3) Mermaid 코드 생성

중요 제약/안정화:
- 지원 타입만 사용(graph/flowchart, sequenceDiagram, classDiagram, stateDiagram(-v2), erDiagram, journey, gantt, pie, mindmap, timeline, gitGraph). 불확실 시 `graph TD`로 폴백.
- 특수문자/공백 라벨은 반드시 따옴표로 감싸기.
- subgraph 선언에는 클래스 직접 지정 금지.
- 클릭 이벤트는 `click Node "path/to"` 형태만. 노드명에 경로 노출 금지.

## 🔒 프라이빗 저장소 다이어그램
- 헤더의 “Private Repos” 버튼 클릭 → `repo` 스코프의 GitHub PAT 입력.
- 또는 로컬(Self-host) 환경에서 직접 실행.

## 🛠️ 로컬 개발/자가 호스팅
1) 클론
```bash
git clone https://github.com/hongvincent/gitdiagram.git
cd gitdiagram
```
2) 의존성 설치
```bash
pnpm i
```
3) 환경변수 설정
```bash
cp .env.example .env
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

## 🤝 기여
PR 환영합니다. 버그/개선 제안은 이슈로 남겨 주세요.

## 🙏 Acknowledgements
[Romain Courtois](https://github.com/cyclotruc)의 [Gitingest](https://gitingest.com/)에서 영감을 받았습니다.

## 📈 레이트 리밋
무료 호스팅 중이며 정책은 추후 변경 가능성이 있습니다.

## 🔮 앞으로의 계획
- font-awesome 아이콘 지원
- star-history.com 유사 임베드 기능(커밋에 따라 점진 업데이트)
