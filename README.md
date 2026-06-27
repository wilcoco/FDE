# FlowDesk

중소기업을 위한 그룹웨어 · 업무 프로세스 자동화 SaaS.
업무 매뉴얼을 자연어로 적으면 실행 가능한 프로세스(전자결재 포함)가 되어 돌아갑니다.

자세한 제품 기획은 [SPEC.md](./SPEC.md), 설계 결정 로그는 [DECISIONS.md](./DECISIONS.md) 참고.

## 핵심 기능
- **자연어 → 프로세스**: 업무 매뉴얼을 적으면 Claude가 프로세스 그래프로 변환, 시각적 순서도로 편집.
- **조직도 기반 전자결재**: 결재는 프로세스 노드의 하나. 조직도·전결규정으로 결재선이 자동 결정.
- **실행 · 추적**: 업무일지·댓글·업무지시(재작업)·협조업무(사후 프로세스 수정).
- **목표 정렬**: OKR(정성)/KPI(정량) → 세부목표(Goal) → 프로세스 케스케이딩.
- **분석**: 병목·사이클타임·재작업률.
- **멀티테넌시 & 독립화**: 그룹별 격리, 한 그룹만 전용 DB/서버로 추출·이전 가능.

## 기술 스택
Next.js 15 (App Router) · TypeScript · Prisma · PostgreSQL · Tailwind v4 · Claude (claude-opus-4-8) · Railway.

## 로컬 실행
```bash
npm install
cp .env.example .env            # DATABASE_URL, AUTH_SECRET 설정
npx prisma migrate deploy       # 또는: npx prisma db push
npm run db:seed                 # 데모 데이터 (선택)
npm run dev
```
데모 로그인: `slug=acme`, `ceo@acme.com` / `lead@acme.com` / `staff@acme.com`, 비밀번호 `password`.

> `ANTHROPIC_API_KEY`가 없으면 자연어→프로세스 변환은 휴리스틱 폴백으로 동작합니다(품질 저하).

## Railway 배포
1. Railway 프로젝트 생성 → PostgreSQL 플러그인 추가.
2. 서비스 변수 설정: `DATABASE_URL=${{Postgres.DATABASE_URL}}`, `AUTH_SECRET`(랜덤), `APP_URL`, (선택) `ANTHROPIC_API_KEY`.
3. 배포 시 `railway.json`의 start 커맨드가 `prisma migrate deploy`를 실행합니다.

독립화(전용 인스턴스)는 [docs/TENANT-EXTRACTION.md](./docs/TENANT-EXTRACTION.md) 참고.
아키텍처는 [docs/ARCHITECTURE.md](./docs/ARCHITECTURE.md) 참고.
