# FlowDesk

중소기업을 위한 그룹웨어 · 업무 프로세스 자동화 SaaS.
업무 매뉴얼을 자연어로 적으면 실행 가능한 프로세스(전자결재 포함)가 되어 돌아갑니다.

자세한 제품 기획은 [SPEC.md](./SPEC.md), 설계 결정 로그는 [DECISIONS.md](./DECISIONS.md) 참고.

## 핵심 기능 (플래그십)
- **지시하기 (↓ 분해)**: 대표가 말하거나 적으면 AI가 *굵직한 꼭지(milestone) 3~6개*로 분해 — BPM처럼 상세하지 않게. 상세 실행은 조직이, 대표는 *순서·결과*만 관리.
- **꼭지 뷰**: 플로우(순서) + 보드(상태) 두 뷰. 각 꼭지 = 책임자·기대결과·증명·상태.
- **전략 통일성 (↑ 합성)**: 정신없이 흩어진 지시들의 일관성·모순·고아·목표매핑을 AI가 해석.
- **결과 증명**: 담당자가 결과를 링크/메모로 첨부, 완료 시 다음 꼭지 자동 활성 → say-do gap을 닫음.

> 정체성: **Automated-FDE for SMB** — 오너의 의도를 조직 실행으로 바꾸고 증명하는 운영 OS. 상세 전략은 [docs/REVERSE-PALANTIR.md](./docs/REVERSE-PALANTIR.md).

## 고급 (프로세스 설계 레이어)
- **자연어 → 프로세스**: 업무 매뉴얼을 적으면 Claude가 프로세스 그래프로 변환, 드래그앤드롭 순서도로 편집.
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
