# 테넌트 추출 · 독립 인스턴스 (독립화)

특정 그룹(회사)이 보안/커스텀 사유로 **전용 DB/서버**를 원하면, 공유 인스턴스에서
그 그룹의 데이터만 떼어내 동일 스키마의 독립 인스턴스로 이전합니다.

이것이 가능한 이유: 모든 테넌트 소유 행이 `tenantId`를 가지므로, 한 그룹의 데이터는
모든 테이블에서 `WHERE tenantId = :id` 한 줄로 완전히 추출됩니다. 사용자 신원도
테넌트별(`(tenantId, email)` 유니크)이라 그룹이 자기완결적입니다.

## 1. 추출
```bash
npm run tenant:extract -- <slug>
# → exports/<slug>.json  (해당 테넌트의 모든 행, FK 안전 순서)
```

## 2. 전용 인스턴스 생성 (Railway 기준)
1. 새 Railway 프로젝트 생성 → PostgreSQL 플러그인 추가.
2. 이 저장소를 동일하게 배포 (앱 변경 없음).
3. 서비스 변수: `DATABASE_URL`(전용 DB), `AUTH_SECRET`(새 값), `APP_URL`(전용 도메인),
   `DEPLOYMENT_MODE=dedicated`, (선택) `DEDICATED_TENANT_SLUG=<slug>`, `ANTHROPIC_API_KEY`.
4. `npx prisma migrate deploy` 로 스키마 생성.

## 3. 적재
`exports/<slug>.json`을 위 순서대로 `createMany`/`create` 로 적재(임포트 스크립트는
추출 JSON을 그대로 역순 매핑). 적재 후 해당 테넌트의 `isolationMode`를 `DEDICATED`로 표시.

## 4. 전환
- 전용 도메인으로 사용자 안내, 공유 인스턴스의 해당 테넌트는 읽기전용/비활성화.
- 필요 시 공유 DB에서 해당 `tenantId` 데이터 삭제(`Tenant` 삭제 → cascade).

## 설계 메모
- 스키마가 동일하므로 코드 분기 없음. 독립 인스턴스는 단일 테넌트만 담는 같은 앱.
- 추출/적재는 행 단위 복제라 ID가 보존되어 관계가 그대로 유지됨.
- 향후: on-prem 설치본도 동일 메커니즘(컨테이너 + 전용 DB)으로 제공 가능.
