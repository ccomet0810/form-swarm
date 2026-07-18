# FormSwarm

Google Forms 공개 응답 페이지를 **읽기 전용**으로 분석해 문항, 페이지, 선택지,
필수 여부, `entry` 입력 ID를 정규화하고 유형별 가상 응답 규칙과 미리보기를
만드는 웹 앱입니다.

현재 구현 범위는 `링크 → 구조 분석 → 규칙 수정 → 시드 기반 생성 → 검증 요약 → 미리보기/JSON 내보내기`입니다.
JSON 내보내기에는 정규화된 전체 폼 스키마, 생성 규칙, seed, 생성 응답, 검증 요약이
함께 들어가므로 문항·`entry` 결합을 잃지 않고 결과를 다시 확인할 수 있습니다.
실제 Google Forms 제출은 폼 소유권이 확인된 전용 QA 모드가 설계되기 전까지 잠겨 있습니다.

## 기술 스택

- Next.js 16 App Router + React 19 + TypeScript 5.9
- vinext/Vite 8 + Cloudflare Workers 호환 런타임
- Zod 입력 검증, Lucide 아이콘
- Vitest 단위/통합 테스트 + Node SSR 렌더 테스트
- 모듈형 모놀리스: `UI → generator·domain`, `API → application → Google adapter → domain`

## 실행

Node.js 22.13 이상이 필요합니다.

```bash
npm install
npm run dev
```

기본 주소는 `http://localhost:3000`입니다.

## 검증

```bash
npm run typecheck
npm run lint
npm test
npm run test:live
npm run build
```

`npm test`는 Vitest 단위 테스트와 빌드된 Worker의 SSR 렌더 테스트를 함께 실행합니다.
`test:live`는 이 프로젝트에 지정된 두 공개 Google Forms를 GET으로만 읽어
golden assertion을 수행합니다. `formResponse` POST는 호출하지 않습니다.

## 주요 경계

- `lib/adapters/google-forms`: URL 정책, 제한된 fetch, 비공개 HTML payload 해석
- `lib/domain`: Google 내부 배열 인덱스가 노출되지 않는 정규화 스키마
- `lib/generator`: 문항 유형별 기본 규칙, 결정론적 PRNG, 생성 결과 구조 검증
- `app/api/forms/import`: 동일 출처 UI가 사용하는 server-side import API
- `app/components/workbench.tsx`: 규칙 편집, 생성, 검토 인터페이스

상세한 운영 아키텍처와 제출 모드 설계는 [기술 설계 문서](docs/TECHNICAL_DESIGN.md)를 참고하세요.

## 주의

`FB_PUBLIC_LOAD_DATA_`와 공개 페이지의 `formResponse` 동작은 Google이 안정적인
외부 계약으로 문서화한 API가 아닙니다. 해석할 수 없는 payload 구조는 가져오기를
중단하고, 알 수 없는 문항 유형은 `unknown`으로 보존하되 해당 문항의 자동 생성을
제외하고 진단에 표시합니다. CAPTCHA, 로그인 제한, 파일 업로드, 응답 1회 제한
우회는 지원하지 않습니다.
