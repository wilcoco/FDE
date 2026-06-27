# FlowDesk — 제품 기획서

> 중소기업이 자기 업무 매뉴얼을 자연어로 적으면, 그게 실행 가능한 업무 프로세스(전자결재 포함)가 되어 돌아가는 그룹웨어 SaaS. FDE(전담 엔지니어) 없이 셀프 업무 디지털화.

## 1. 핵심 차별점
1. **프로세스가 주인공** — 실제 업무 흐름(그래프) 위에 작업/결재/자동화/분기 노드. 결재는 노드의 한 타입.
2. **자연어 매뉴얼 → 프로세스 템플릿** — Claude가 자연어를 그래프로 변환, 시각적 순서도로 확인·편집.
3. **목표 정렬** — OKR(정성)/KPI(정량) → 세부 목표(Goal) → 프로세스로 케스케이딩.

## 2. 멀티테넌시 & 독립화
- 공유 DB, 모든 데이터에 `tenantId`. 신원도 테넌트별(`(tenantId,email)` 유니크).
- 독립화: `WHERE tenantId=X`로 한 그룹만 추출 → 동일 스키마 전용 DB/서버(Railway 별 프로젝트).

## 3. 도메인 모델 (요약)
```
Tenant
├─ 조직도: Department(트리) · Position(직급/rank) · 보고선(User.managerId) · 전결규정(금액×직급)
├─ User(부서·직급·상사·역할)
├─ Objective(OKR|KPI, 회사|부서|개인, parent로 케스케이딩) ─ KeyResult
│    └─ Goal(세부 업무목표, 프로세스 연결 선택)
│         └─ ProcessDefinition(템플릿, 버전, 등록승인) ── Node/Edge
│              └─ ProcessInstance(기안=실행) ── NodeInstance / InstanceEdge
│                   ├─ WorkLog(업무일지) · Comment(Q&A) · Directive(지시→rework)
│                   └─ InstanceChange(협조업무 추가→승인→삽입)
├─ ApprovalRequest/Step (공통 승인 모듈: 조직체인 | 금액전결 | 고정)
├─ Notification · AuditLog
```

## 4. 승인(공통 모듈)
- 라우팅: **조직 체인**(기안자→상사→…직급 도달) · **금액 전결**(구간별 직급) · **고정 인물**
- 호출처: 프로세스 등록승인 · APPROVAL 노드(일반/비용) · 협조업무 승인

## 5. 실행
- 템플릿 구동 시 담당자 일괄 지정 → 참여자는 자기 프로세스 열람, 차례에 작업.
- 결재 노드는 공통 승인 모듈 위임. rework 반복 허용.
- 피드백: WorkLog(알람→작성), Comment(비파괴), Directive(rework 생성).
- 사후 수정: 협조업무 추가 → 프로세스 승인체계 승인 → 병렬/인라인 삽입.

## 6. 분석
- 노드 체류시간·병목·사이클타임·처리량·재작업률.

## 7. 빌드 로드맵
- P0 기반: 멀티테넌시·인증·조직도·권한
- P1 스튜디오: 공통 승인 모듈 + 자연어→그래프 + 그래프 편집 + 등록 다단계 승인
- P2 실행: 기안→진행 + 작업함/결재함 + 업무로그/댓글/업무지시 + 사후 수정
- P3 목표·분석: OKR/KPI 케스케이딩 + Goal 연결 + 대시보드/분석
- P4 고도화: 비용 전결 고도화 · 자동화 노드 · 감사
- P5 독립화: 테넌트 추출 + 전용 인스턴스

## 8. 스택
Next.js 15(App Router) · TypeScript · Prisma · PostgreSQL · Tailwind v4 · Claude(claude-opus-4-8) · Railway.
