# 아키텍처

## 레이어
```
src/app/(app)/*        화면 (서버 컴포넌트) + 서버 액션 폼
src/app/actions/*      서버 액션 (mutations) — 인증·권한 후 lib 호출
src/lib/*              도메인 로직
  ├─ db.ts             Prisma 클라이언트 싱글턴
  ├─ auth.ts/session.ts JWT 쿠키 세션, requireContext/requireRole
  ├─ tenant.ts         테넌트 스코프 데이터 접근(격리 보장)
  ├─ orgchart.ts       보고선·전결규정으로 결재자 해석
  ├─ approval.ts       공통 승인 모듈 (등록/노드/협조 공통)
  ├─ engine.ts         프로세스 실행 엔진 (인스턴스 그래프)
  ├─ ai.ts             자연어 → 프로세스 그래프 (Claude)
  ├─ analytics.ts      병목·사이클타임·재작업
  └─ graph-layout.ts   순서도 자동 배치
prisma/schema.prisma   데이터 모델
```

## 3대 설계 제약
1. **멀티테넌시**: 모든 테넌트 소유 행에 `tenantId`. 모든 접근은 테넌트 스코프. → 격리 + 추출 가능.
2. **프로세스 그래프**: 업무는 노드/엣지의 방향 그래프. 결재(APPROVAL)는 노드 타입의 하나.
3. **인스턴스가 그래프 소유**: 실행 시 템플릿을 인스턴스 자체 노드/엣지로 복제 → 런타임 수정(협조업무) 가능.

## 승인 모듈 (공통)
하나의 엔진이 세 가지 승인을 처리:
- `PROCESS_REGISTRATION` — 프로세스 등록 승인 (작성자 보고선 다단계)
- `NODE_APPROVAL` — 프로세스 내 결재 노드 (일반=상급자 / 비용=전결규정)
- `INSTANCE_CHANGE` — 협조업무(사후 수정) 승인

라우팅: `ORG_CHAIN`(보고선) · `AMOUNT_TIER`(금액 전결) · `FIXED`(고정).
결재자 목록은 `orgchart.ts`가 해석하고, `approval.ts`는 단계만 구동. 종결 시 `actions/approval.ts`가 주체별 후처리(정의 활성화 / 노드 재개 / 변경 적용).

## 실행 엔진
- START/AUTOMATION/CONDITION/END 자동 진행, TASK/APPROVAL에서 정지.
- APPROVAL 노드는 공통 승인 모듈에 위임.
- 업무지시(Directive)는 TASK를 ACTIVE로 되돌려 **재작업(rework)** 사이클 생성.
- 협조업무(InstanceChange)는 승인 후 인스턴스에 노드 삽입(병렬/인라인).

## 데이터 흐름 예시 (비품 구매)
```
자연어 매뉴얼 → ai.generateProcess → ProcessDefinition(DRAFT)
 → 편집 → submitForApproval → ApprovalRequest(REGISTRATION) → 승인 → ACTIVE
 → start(기안) → ProcessInstance + NodeInstance/InstanceEdge 복제
 → TASK(신청) → APPROVAL(팀장, 전결) → TASK(발주) → END
 → 각 단계 WorkLog/Comment/Directive, 필요시 협조업무 삽입
 → analytics가 타임스탬프로 병목/사이클타임 산출
```
