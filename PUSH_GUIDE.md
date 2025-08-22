# Push 가이드

이 아카이브는 `.git` 이나 빌드/캐시를 제외한 순수 소스 코드만 포함합니다.
아래 절차로 새 저장소에 푸시하세요.

## 1) 새 Git 저장소 초기화

```bash
git init
git add .
git commit -m "chore: initial import"
```

## 2) 원격 저장소 추가 및 푸시

GitHub에서 빈 저장소를 만든 뒤, 아래처럼 원격을 추가하고 푸시하세요.

```bash
git remote add origin https://github.com/<YOUR_ORG_OR_USER>/<YOUR_REPO>.git
git branch -M main
git push -u origin main
```

## 3) 로컬 개발

프론트엔드(Next.js):

```bash
pnpm install
pnpm dev
```

백엔드(FastAPI, Docker Compose):

```bash
docker compose up -d --build
```

## 참고

- 이 프로젝트는 Next.js 15, FastAPI, Docker Compose, Mermaid v11.4.1을 사용합니다.
- 프론트엔드에서 백엔드 호출은 Next.js API 경유(프록시)로 안정화되어 있습니다.
- 자세한 사용법과 구조는 `README.md` 및 `README.ko.md` 를 참고하세요.
