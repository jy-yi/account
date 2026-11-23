# 🧭 가계부 `index.html` 인수인계서

> 이 문서 하나만 읽고 **바로 `index.html`을 수정·배포**할 수 있게 쓴 기술 인수인계서입니다.
> 대상: 이 저장소를 이어받는 AI 또는 개발자.
> 작성 기준: 2026-11-19, `index.html` 6,987줄 / `main` 브랜치.

---

## 0. 시작하기 전에 — 절대 규칙 3가지

1. **이 저장소는 Public입니다.**
   실제 금액·계좌번호·거주지(아파트명·동)·전화번호·본명·카드 뒷자리·`service_role` 키를 **코드·문서·커밋 메시지·스크린샷 어디에도 넣지 마세요.**
   소스에 있는 숫자와 계좌명은 전부 **가상 샘플**입니다. 실제 값은 Supabase DB에만 있습니다.

2. **앱은 `index.html` 한 파일입니다.**
   빌드 도구·번들러·npm 의존성이 없습니다. CSS는 파일 위쪽 style 블록 안에, JS는 파일 끝 script 블록 안에, 차트는 인라인 SVG로 들어 있습니다.
   파일을 고치고 `main`에 푸시하면 그게 배포입니다.

3. **라이브 DB에 테스트 데이터를 쓰지 마세요.**
   검증은 로그인 전 **`샘플 체험 모드`**(가상 데이터, localStorage)에서 합니다.
   실제 데이터는 부부 두 사람의 자산·지출 기록입니다. 테스트 행 하나가 섞이면 결산·예산·저축률이 전부 틀어집니다.

추가로, 이 앱의 목적 자체가 **"개인 용돈은 서로 보지 않는다"** 입니다. 개인 지출을 기록·노출하는 기능은 요구되지 않았고, 요청받아도 먼저 확인하세요.

---

## 1. 저장소 & 배포 구조

| 항목 | 값 |
| --- | --- |
| 저장소 | `jy-yi/account` (Public) |
| 브랜치 | `main` (단일 브랜치 운영) |
| 배포 | GitHub Pages, `main` / `/ (root)` → 정적 서빙 (빌드 단계 없음) |
| 라이브 URL | https://jy-yi.github.io/account/ |
| 파일 | `index.html` (앱 전체), `og-image.png`, `apple-touch-icon.png`, `README.md`, `HANDOFF.md` |

**배포 리듬**

- `git push origin main` → 보통 **30~60초** 뒤 라이브 반영.
- GitHub Pages는 CDN 캐시를 씁니다. 반영이 안 보이면 강력 새로고침(Ctrl/Cmd+Shift+R) 또는 `?v=20261119a` 같은 쿼리를 붙여 확인하세요.
- 실패한 배포는 `Settings → Pages` 상단과 Actions 탭에서 확인할 수 있습니다(정적 사이트라 대개 파일 경로 문제).

**로컬 확인**

```bash
python3 -m http.server 8000
# http://localhost:8000  (file:// 로 열면 Supabase Auth·Realtime이 막힐 수 있음)
```

**접속 설정이 있는 곳**

`index.html`의 Supabase 섹션(`══════════════ 13. Supabase ...`) 첫 줄 부근:

```js
const SB_URL = 'https://<PROJECT_REF>.supabase.co';
const SB_KEY = '<anon 또는 sb_publishable 키>';
```

- 프론트에 들어가는 키는 **공개 전제 키**입니다. 보호는 RLS가 합니다.
- `service_role` 키는 절대 여기 넣지 않습니다. 그 키는 Edge Function 시크릿에만 있습니다.

**Edge Function은 저장소에 없습니다.** Supabase 대시보드 → Edge Functions에서 관리합니다(§5).

---

## 2. `index.html` 파일 지도

줄 번호는 작성 시점 기준입니다. **줄 번호가 어긋나면 §11의 `grep` 앵커로 찾으세요.** 섹션 주석(`/* ────── N. 제목 ────── */`)이 파일 안의 실질적인 목차입니다.

| 줄 범위 | 내용 |
| --- | --- |
| 1~30 | `<head>` — viewport, 테마 컬러, OG/Twitter 카드, canonical, 아이콘 |
| 30~915 | **CSS** — `:root` 색·간격 토큰, 카드, 접힘(`.card.is-collapsed`), 게이트, 모달, 도크 |
| 916~1000 | 로그인 게이트 (`#gate`, `#loginForm`, `#memberNotice`) + 앱 헤더 시작 |
| 1000~1160 | **자산 & 증식 탭 마크업** (`#view-asset`) |
| 1130~1200 | **지출 & 분석 탭 마크업** (`#view-spend`) + 하단 도크(`#dockRoot`) |
| 1200~1637 | 모달들 — 내역 추가/수정, 고정 규칙, 이번 달만 수정, 예산, 이름, 부동산, 종목, 이체 |
| 1638~2066 | **샘플 데이터** — `DEFAULT_CATS`, `INCOME_CATS`, `FIXED_RULES`, `TR_SAMPLE`, `INVEST_SEED`, `PROP_DEFAULT`, 가상 월별 데이터 생성 |
| 2067~2296 | **상태 & 저장** — `state`, `STORE_KEY`, `save()` (localStorage) |
| 2297~2448 | 숫자 포맷(`won`, `pct`, `relYM`)·계산(`visible`, `sum`, `byCat`, `sameWindow`, `dayLimit`) |
| 2449~2574 | 헤더·브랜드 렌더, 연/월 피커 |
| 2575~2963 | 자산 탭 렌더 — `renderAsset`, `renderProp`, `renderInvest`, `renderPension` |
| 2964~3084 | SVG 차트 — `chartMonths`, `drawGrowth` |
| 3085~3477 | 지출 탭 렌더 — `renderSpend` (결산·인사이트·도넛·예산·내역) |
| 3478~3495 | 선택 연도 누적 |
| 3496~3571 | 고정 지출 카드 — `renderFixedCard`, `upcomingFixed` |
| 3572~4023 | **고정 저축·이체 규칙** — `parseTrRule`, `renderTransferCard`, `trRunLive`, `trUndoLive`, `trRunSample`, `trUndoSample` |
| 4024~4479 | **단순(1회성) 이체** — `trOneRunLive`/`trOneUndoLive`, `trOneRunSample`/`trOneUndoSample`, `trOneLogs`, `submitTransfer`, `trOnceFillSelects` |
| 4480~4602 | 토스트, `buildMessage`(요약 복사) |
| 4603~4996 | 모달 로직 — `openModal`, `setModalKind`, `openTransferModal`, `openEditModal`, `patchTx`, `openRuleModal`, `openMonthFix` |
| 4997~5361 | 이름·이모지, 예산·카테고리 모달 (`renderBudgetFields`, `applyCats`) |
| 5362~5635 | 부동산 매수가·시세 모달, 종목 추가·수정 모달 |
| 5636~5971 | 실시간 시세(`refreshQuotes`), 국토부 실거래(`refreshRealEstate`) |
| 5972~6060 | 월 네비게이터·기간 토글, **카드 접기**(`DEFAULT_COLLAPSED`, `isCollapsed`, `applyCollapsed`) |
| 6061~6978 | **Supabase** — 로그인 게이트, `DB` 객체, `applyModel`, `refresh`, `ensureSeed`, `ensureFixed`, `commit`, `subscribe` |
| 6979~6987 | 12. 시작 — 게이트 부팅 |

---

## 3. 요청 유형별 수정 포인트 맵

### 3.1 상단 월/연도 선택기 · 탭 전환

| 요소 | 위치 / 식별자 |
| --- | --- |
| 월 네비 마크업 | `#mPrev`, `#mNext`, `#mPick`, `#mPickLabel`, `#picker`, `#yearChips`, `#monthGrid` |
| 로직 | `renderPicker()`, `openPicker()`, `closePicker()`, `goMonth()` — 섹션 `11-1. 월 네비게이터` |
| 상태 | `state.ym` (`'YYYY-MM'`), `state.pickerYear` |
| 월 목록 | `MONTHS`(현재 달력), `PREV[ym]`(전월) — **`applyModel()`이 DB 기록 범위로 다시 채웁니다**(6526줄 이전 5번 항목) |
| 탭 | `.seg [data-tab="asset" \| "spend"]`, `#view-asset`, `#view-spend`, `state.tab`, `renderHead()` 안의 클릭 바인딩 |

주의:
- 샘플 모드는 `state.ym` 초기값이 고정(`2026-11`)이고, 라이브는 `applyModel()`이 `CUR_YM`까지 확장합니다.
- 월을 바꾸면 `DB.onMonth(ym)` → `ensureFixed(ym)`가 돌아 그 달 고정 지출을 채웁니다. 네비게이터만 고칠 때 이 호출을 빼지 마세요.

### 3.2 자산 4영역 · 순자산

| 요소 | 위치 / 식별자 |
| --- | --- |
| 순자산 히어로 | `#netAmount`, `#netDelta`, `#netSplit`, `#incomeHint`, `#stagePill` — `renderAsset()` |
| 증식 차트 | `#growthChart`, `#growthTip`, `#rangeToggle [data-range="6m\|1y\|all"]`, `state.range`, `drawGrowth()`, `chartMonths()` |
| 자산 포트폴리오 | `#pfList`, `pfDetail()`, `#pfMonth` |
| 현금·부채 금액 수정 | `openSnapModal()`, `renderSnapRows()`, `snapRowsHtml()` → `asset_snapshots` |
| 주식·투자 상세 | `#investList`, `#investSum`, `#investSeg [data-invview="acct\|merged"]`, `renderInvest()`, `acctRows()`, `mergedRows()` |
| 연금·절세·청약 | `#penList`, `#penSum`, `#penSeg`, `renderPension()` — `investments.bucket='pension'` |
| 부동산 | `#propSum`, `#propBar`, `#propMeta`, `#btnPropEdit`, `renderProp()`, `propView()` |
| 부채 | `#debtList`, `#debtFoot`, `renderAsset()` 안의 부채 카드 |

숫자의 출처를 헷갈리지 마세요.
- **현금·부동산·부채** = `asset_snapshots`(월별 행). 없는 달은 `applyModel()`이 **직전 값 유지**로 채웁니다.
- **주식·연금** = `investments`의 `eval_amount` 합. 없는 달은 최근 달 종목을 이어받습니다.
- 순자산 = 현금 + 주식 + 연금 + 부동산 − 부채 (`netOf()`).

### 3.3 계좌별 접기(기본 닫힘) · 청약 수량 숨김

- 접힘 키: `acctKey(acct, pension)` → `'invacct:stock:' + 계좌명` / `'invacct:pen:' + 계좌명`.
- 기본값: `isCollapsed()`가 `invacct:` 접두사 키를 **무조건 접힘(true)** 으로 봅니다. 사용자가 펼치면 `setCollapsed(key, false)`가 **`false`를 저장**해 새로고침 후에도 유지됩니다(`state.collapsed`, localStorage).
- 렌더: `acctRows()`가 `data-accrow`/`data-acc-key`를 붙이고, `bindAccToggles()`가 클릭을 연결합니다.
- 청약 수량 숨김: `invIsSavings(name, sub)`가 이름·부제에 `청약`이 있으면 true → `invQtyText()` 대신 수량 없이 그립니다. 청약은 주식처럼 사고파는 상품이 아니기 때문입니다.
- **카드를 새로 추가하면** `initCardToggles()`가 `#view-asset > .card`, `#view-spend > .card`를 훑어 쉐브론 버튼을 자동으로 붙입니다. 마크업에서 카드의 **첫 자식이 `<h2>` 또는 `.eyebrow`** 여야 접힘 라벨이 제대로 잡힙니다.

### 3.4 실시간 시세 · 부동산 실거래

**시세 (`🔄 시세 새로고침`)**

| 요소 | 값 |
| --- | --- |
| 버튼 | `#btnQuoteStock`(주식·투자), `#btnQuotePen`(연금) |
| 함수 | `refreshQuotes()` → `applyQuotes()` → `investments.eval_amount` 업데이트 |
| 표시 | `#investQuoteMeta`, `#penQuoteMeta`, `#fxNoteRate` |
| Edge Function | **`get-quotes`** — 저장소 문서·과거 메모에 `get-stock-price`로 적힌 곳이 있지만 **실제 배포·호출 이름은 `get-quotes`** 입니다. 이름을 바꾸면 `index.html`의 호출부도 같이 바꿔야 합니다. |
| 입력 | 종목명 또는 티커. 티커는 localStorage에 이름 기준으로 저장(`symOf`, `saveSym`), 스코프는 `quoteScope()` |
| 제약 | 수량(`quantity`)이 있는 종목만 갱신. **청약 통장(`invIsSavings(name, invSubText(i))` — 이름·`sub_type`에 `청약`)은 시세가 없으므로 요청 `items`·실패(`failed`) 양쪽에서 제외** — 청약만 있으면 `get-quotes`를 호출하지 않고 안내 토스트만 띄웁니다. 응답 60초 캐시(함수 측), 한 번에 최대 80종목 |

**실거래 (`🔄 실거래가 조회`)**

| 요소 | 값 |
| --- | --- |
| 버튼 | `#btnQuoteReal`, 패널 `#propRePanel` |
| 함수 | `refreshRealEstate()`, `renderReInfo()`, `renderReData()`, `applyLatestDeal()` |
| 쿼리 | `propQuery()` — `asset_snapshots.meta`의 `lawd_cd`(5자리), `apt_name`, `exclu_area`, `umd_name` |
| Edge Function | `get-realestate` — 최근 12개월, 면적 ±3㎡, 해제 거래 제외 |
| 반영 | `적용`을 누르면 그 달 `asset_snapshots(kind='real_estate').amount` 갱신 |

### 3.5 이번 달 공동 결산 · 접이식 수입 내역

- `renderSpend()` 안: `#settleList`(수입/고정 저축/고정 지출/변동/남은 돈/저축률), `#incomeBlock`(수입 내역), `#allowNote`(용돈 이체 안내), `#yearSum`.
- 수입 내역 접기: `applyIncomeFold()` + `initIncomeFold()`. 접힘 키는 **`'view-spend:이번 달 수입 내역'`** 이고 `DEFAULT_COLLAPSED`에서 기본 닫힘입니다.
- 계산식: 남은 돈 = 공동 수입 − 고정 저축 − 고정 지출 − 변동 생활비. 어느 항목이 어디에 들어가는지는 `visible()`, `fixedTxs()`, `visibleIncome()`이 결정합니다.
- 인사이트: `#insChip`, `#insList`, `#insPlan` — 전월 **동기간**(`sameWindow`) 비교, `dayLimit()`으로 남은 기간 하루 허용액.
- 도넛: `#donut`(인라인 SVG), `#catList`. 카테고리 클릭은 `state.cat` 필터로 내역에 반영.
- **용돈(개인 지출)은 이 화면에 없습니다.** 부부가 각자 용돈으로 쓰는 내역은 기록 대상이 아니고, 공동 수입에서 용돈 이체로 나간 금액만 고정 지출로 잡힙니다(`EXTRA_CATS.allow`).

### 3.6 고정 지출 자동 규칙 vs 🔄 고정 저축·이체 규칙 (가장 자주 깨지는 곳)

| 구분 | 고정 지출 | 고정 저축·이체 |
| --- | --- | --- |
| 저장 | `recurring_rules` (`category_key != 'transfer'`) | `recurring_rules` (`category_key='transfer'`) |
| 효과 | 그 달 `transactions`에 `kind='fixed'` 행 생성 | `transactions`에 **지출로 잡히지 않는** 완료 마커 1행 + 통장 잔액 이동 |
| 실행 | 자동 — `ensureFixed(ym)` | 수동 — `[이체 실행]` → `trRunLive(rule)` |
| 금액 | 지출 합계·저축률에 포함 | 지출 합계·저축률에서 **제외** |
| 되돌리기 | 이번 달만 수정/규칙 수정 | `trUndoLive(rule)` |

- `ensureFixed(ym)`은 **`category_key !== 'transfer'`를 반드시 걸러야** 합니다. 이 조건이 빠지면 이체 규칙이 지출로 생성돼 이중 계산됩니다.
- `ensureFixed`는 idempotent합니다. 이미 `rule_id` 행이 있는 규칙은 다시 만들지 않고, 진행 중인 달은 `elapsed`일까지만 생성합니다.
- 이체 규칙 인코딩:
  - 규칙: `pay_method = 'TRF:' + JSON.stringify({ from, to, toKind, toItem })` (`TR_PREFIX='TRF:'`)
  - 완료 마커: `pay_method = 'TRFLOG:' + JSON.stringify({...})` (`TR_LOG_PREFIX='TRFLOG:'`), `is_excluded=true`, `category_key='transfer'`, `kind='var'`
- `trRunLive` 순서: 중복 확인 → 출금/입금 대상 찾기 → **마커 id를 미리 발급**(`crypto.randomUUID`) → 마커 insert → `trApplyOps()`로 잔액 patch. insert 응답을 못 받아도 롤백이 가능하도록 만든 장치입니다. 되돌리지 않는 한 이 순서를 바꾸지 마세요.
- 출금 통장은 `asset_snapshots(kind='cash')`에서 이름으로 찾습니다(`trFindSnap`). 그 달 행이 없으면 최근 달 행을 쓰고 토스트로 알립니다. 입금 대상이 통장이면 `asset_snapshots`, 청약·투자면 `investments`의 `principal`과 `eval_amount`를 같이 올립니다.
- 샘플 모드에는 같은 동작의 `trRunSample`/`trUndoSample`이 따로 있습니다(화면 상태만 변경). 한쪽만 고치면 샘플 체험과 실전이 갈라집니다.

### 3.6-1 🔄 단순(1회성) 이체

- 입구: `＋ 내역 추가` 모달의 `🔄 이체` 탭(`setModalKind('tr')`, 필드 `#fTrDate`·`#fTrAmt`·`#fTrFrom`·`#fTrTo`·`#fTrNote`) + 지출 탭 🔄 카드의 `🔄 단순 이체` 버튼(`#btnTrOnce` → `openTransferModal()`).
- 계좌 목록: `trCashAccounts()`(출금·현금 입금) + `trSavingsTargets()`(이름·sub 에 `청약`이 들어간 `investments`). 출금으로 고른 계좌는 입금 목록에서 `disabled`로 잠그고, 저장 시에도 같은 계좌면 막습니다(`#fTrFrom` change → `trOnceFillTo()`).
- **스키마 변경 없음**: `transactions`에 `kind='var'`·`category_key='transfer'`·`is_excluded=true`·`rule_id=null` 마커 1행 + `pay_method='TR1:'+JSON({from,to,toKind,toItem,amount,note,fromId,toId,ts})`. `kind='transfer'`는 CHECK 제약(`income|fixed|var`)에 걸리므로 쓰면 안 됩니다.
- 잔액 반영은 `trApplyOps()`로 `asset_snapshots.amount`(입금이 청약이면 `investments.principal`·`eval_amount`)를 증감. 실패 시 마커 삭제 + 롤백. 되돌리기는 `fromId`/`toId`로 같은 행을 찾아 역방향 patch 후 마커 삭제(`trOneUndoLive`).
- 샘플 모드 `trOneRunSample`/`trOneUndoSample`은 `SUBS.cash`·`state.invest`를 직접 고치고 `state.transferLog`에 `oneOff:true` 기록을 넣습니다(현금→현금이면 `SNAP[ym].cash`는 그대로, 현금→청약이면 차감).
- 목록: `trOneLogs(ym)` → `renderTransferCard()`의 `{ym} 단순 이체` 섹션(`↩` 되돌리기). 라이브는 `DB.txs`의 `TR1:` 마커를 읽으므로 부부 양쪽에 같이 보입니다.

### 3.6-2 💰 수입 입금처 ↔ 자산 계좌 잔액 연동

- 입구: `＋ 내역 추가` → `💰 수입` 탭, 그리고 수입 내역 줄의 `✎`(`openEditModal`). 필드 `#fIncName`·`#fIncCat`·`#fAccount`(입금처)·`#fIncApply`(잔액 반영 체크, 기본 ON).
- 입금처 목록은 **코드에 박지 않고 자산 데이터에서 동적 생성**(`incomeAccountList()` → `incomeAccountOptions()`): `trCashAccounts()`(현금·입출금·예적금) + `trSavingsTargets()`(청약) + `trInvTargets()` 중 예수금·CMA·MMF·RP 행. 옵션은 `<optgroup>`으로 묶고 통장에는 현재 잔액을 붙여 보여줍니다.
- 공개 저장소 원칙: 실제 통장명은 `index.html`에 하드코딩하지 않습니다. 계좌 이름은 전부 `asset_snapshots.name` / `investments.account_name`에서 읽습니다.
- 기존 값 호환: 예전 가상 라벨(`공동통장`·`생활비 통장`·`증권계좌`·`공동 현금`·`기타`)은 목록에 `(자산에 없음)` 옵션으로 남겨 선택 상태를 유지합니다. 실계좌와 매칭되지 않으면 잔액은 건드리지 않고 `#incAcctHint`에 안내만 표시합니다.
- 잔액 매칭(`acctTargetOf(name, ym)`): ① `asset_snapshots(kind='cash')` 이름 일치 → `amount`, ② `investments`의 `account_name`/`ticker_name` 일치(여러 행이면 예수금 행 우선) → `principal`·`eval_amount`를 같이 증감(이체와 같은 방식).
- 반영 규칙(`DB.insertIncome` / `DB.updateIncome` / `DB.excludeIncome`):
  - 추가: 계좌 +금액
  - 수정: 같은 계좌면 **차액만**, 계좌가 바뀌면 예전 계좌 −이전금액 / 새 계좌 +새금액. 예전 라벨이 가상 라벨(자산에 없음)이면 새 계좌에만 +
  - 제외(`−`): 계좌 −금액 (되돌리기 시 +금액)
  - 잔액 patch 실패 시 수입 기록 변경을 되돌려 반쪽 상태를 만들지 않습니다.
- 수입 화면은 여전히 `transactions(kind='income')`이고 `pay_method`에 계좌명을 그대로 저장합니다(스키마 변경 없음). 지출 쪽은 아래 3.6-3에서 같은 방식으로 처리합니다.
- 수정 모달은 이체 탭을 먼저 열었더라도 `#commonFields`를 되살리고 `#trFields`를 닫습니다(`openEditModal`). 이 처리가 빠지면 날짜·금액 없이 이체 칸이 같이 뜹니다.


### 3.6-3 🧾 지출 출금 통장 ↔ 자산 계좌 잔액 연동

- 입구: `＋ 내역 추가` → `🧾 지출` 탭, 일반 지출 줄의 `✎`(`openEditModal`), 그리고 `고정 지출 규칙` 모달. 필드 `#fExpAcct`(출금 통장)·`#fExpApply`(잔액 반영 체크, 기본 ON) / 규칙은 `#rAcct`·`#rApply`.
- 저장 형식(스키마 변경 없음): 지출의 `pay_method` 한 칸에 `EXP:{"m":"공동카드","a":"토스뱅크 생활비+비상금","l":true}` JSON을 담습니다. `m`=결제수단, `a`=출금 통장, `l`=그 잔액에 이미 반영됨. 통장을 고르지 않으면 지금처럼 `공동카드` 같은 평문이라 잔액을 건드리지 않습니다.
- 후보 목록: `expenseAccountList()` → `trCashAccounts()`(이 달 현금·입출금·예적금, 없으면 최근 달). `EXP_ACCT_HINT` 키워드(`생활비|LOVE BANK`, `SC제일`, `오토|경조사`, `여행`)로 매칭되는 통장을 `⭐ 자주 쓰는 통장` 그룹으로 위에 올립니다. 통장명은 코드에 박지 않습니다.
- 반영 규칙: ① 추가 = 계좌 −금액 ② 수정 = 같은 통장이면 차액, 통장이 바뀌면 예전 + / 새 − ③ 제외(`－`) = 계좌 +금액 (복원 시 다시 −) ④ 연동 체크를 끄면 예전에 반영된 금액을 되돌리고 `l:false`로 저장해 이후 실수로 또 건드리지 않습니다.
- 고정 지출: 규칙 `pay_method`에 같은 마커를 저장하고, 매달 자동 생성(`ensureFixed`)될 때 **최신월 자산 기록이 있을 때만** 그 통장에서 차감합니다(지난 달 내역을 만들면서 지금 잔액을 건드리지 않도록). `DB.setMonthFix`/`DB.resetMonthFix`는 차액만, `DB.deleteRule`은 이번 달 반영분을 되돌립니다. 규칙에 통장을 새로 지정하면 `syncRuleLinkNow()`가 이번 달 이미 생긴 고정 지출에도 맞춰 줍니다.
- 실패 시 롤백: `DB.insertExpense`는 잔액 patch가 실패하면 방금 넣은 행을 지우고, `DB.updateExpense`/`DB.excludeExpense`는 잔액·행을 되돌립니다.
- 표시: 내역·고정 지출 줄에 `공동카드 · 토스뱅크 생활비+비상금`처럼 보입니다(`expPayText()`).
- 카드 알림(`ingest-card-msg`)도 같은 마커를 씁니다 → 카드 결제는 기본으로 **생활비 통장**에서 나간 것으로 기록되고 그 잔액이 차감됩니다(취소 알림은 복구).

### 3.7 카테고리 · 예산

- 기본 카테고리 **9개**: `식비·장보기 / 외식·배달 / 주거·관리비 / 공과금·통신 / 생활·구독 / 교통·주유 / 경조사·선물 / 여행·여가 / 의료·건강`.
  샘플은 `DEFAULT_CATS`, 라이브 최초 시딩은 `SEED_CATS`(같은 9개, `budget_amount=0`)입니다. **두 목록을 같이 고쳐야** 샘플과 실전이 맞습니다.
- 카테고리 추가·수정·삭제: `openBudgetModal()` → `renderBudgetFields()` → `applyCats()` → `DB.saveCats(next, gone, fallback)`.
  - 삭제 시 그 카테고리의 `transactions.category_key`와 `recurring_rules.category_key`를 `기타(etc)`로 옮긴 뒤 카테고리 행을 지웁니다.
  - 샘플 모드에서는 `state.catRemap`으로 대체 카테고리를 기억합니다.
- 예산 0원 카테고리는 진행률·총예산에서 제외(`budgetHiddenCats()`).
- 색은 `nextCatColor()`가 팔레트에서 자동 배정합니다.

### 3.8 내역 추가 / 수정 / 제외

| 동작 | 함수 | 저장 |
| --- | --- | --- |
| 추가 | `openModal()`, `#addForm` | `transactions` insert (`kind='var'` 또는 `'income'`) |
| 단순 이체 | `openTransferModal()` → `submitTransfer()` | `transactions` 마커(`kind='var'`, `category_key='transfer'`, `pay_method='TR1:'…`) + `asset_snapshots`/`investments` 증감 |
| 수정 | `openEditModal(id)` → `patchTx()` (수입은 `DB.updateIncome()`) | `transactions` update (`title`, `category_key`, `pay_method`, `amount`, `tx_date`, `updated_at`) + 수입이면 입금처 잔액 증감 |
| 고정 지출 금액만 이번 달 수정 | `openMonthFix()` → `DB.setMonthFix()` | `transactions` update 또는 insert |
| 규칙 자체 수정 | `openRuleModal()` → `DB.saveRule()` | `recurring_rules` update/insert |
| 제외 | `－` 버튼 → `DB.setExcluded(id, true)` | `transactions.is_excluded` — **삭제 아님** |

- **날짜는 항상 `toTxDate(ym, d)`로 정규화**합니다. `'11-02'`, `'2'`, `'2026-11-02'`가 섞여 들어오면 `YYYY-MM-DD` 하나로 맞춥니다. 이 함수를 우회해 `tx_date`를 직접 넣지 마세요.
- 제외는 합계·도넛·예산·저축률에서만 빼고 기록은 남깁니다. 과거에 "제외됨" 목록 박스(`#exclBox`)를 화면에 보여줬는데, 지금은 `renderSpend()` 끝에서 `el('exclBox').innerHTML = ''`로 **비워 둡니다**(숨김 적용 상태). 다시 보여주려면 이 줄을 지우고 렌더 코드를 넣어야 합니다.
- **금액 입력란은 예외 없이 `type="text" inputmode="numeric" data-money`**: `#fAmount`(수입·지출 공통), `#fTrAmt`, `#rAmount`, `#mAmount`, `#trAmount`, `#prBuy`/`#prPrice`(만원 단위), `#ivPrincipal`/`#ivValue`, `#newCatBudget`, 예산 카드의 `[data-bud]`, 현금·부채 모달의 `.snap-amt`. `document`의 `input`/`blur` 캡처 리스너가 `commaStr()`로 `4,698,950`처럼 자동 포맷하고 커서 위치를 숫자 개수 기준으로 되돌립니다(`fmtMoneyInput`). 값을 읽을 때는 **반드시 `moneyNum()`** — `parseInt('4,698,950')`은 `4`가 됩니다. 화면에 값을 넣을 때는 `setMoney(el, v)`, HTML 템플릿에서는 `commaStr(v)`를 쓰세요.
- 수정 후에는 `commit()`이 `refresh()` + `renderAll()`을 다시 돌립니다. 화면 일부만 갱신하는 코드를 따로 만들지 마세요.

### 3.9 카드 접힘 기본값 · 쉐브론

- `DEFAULT_COLLAPSED` (기본 접힘):
  `view-asset:주식·투자 상세`, `view-asset:연금·절세·청약통장 상세`, `view-asset:부동산 상세`, `view-asset:부채`,
  `view-spend:이번 달 수입 내역`, `view-spend:고정 지출 · 자동 규칙`, `view-spend:🔄 고정 저축 · 이체 규칙`
- 키 형식은 **`'{탭 id}:{카드 h2 텍스트}'`** 입니다. 카드 제목을 바꾸면 키도 바뀌어 기본값이 풀립니다. 제목을 고칠 때 `DEFAULT_COLLAPSED`도 같이 고치세요.
- 접힘 CSS: `.card.is-collapsed > *:not(.card-head):not(.netcard-top){display:none !important;}` — 헤더만 남습니다.
- 쉐브론: `CHEV_SVG`(선형 SVG). 펼침/접힘에 따라 회전하며, `applyCollapsed()`가 `aria-expanded`·`aria-label`·`title`을 갱신합니다.

### 3.10 `DB` 객체 · 샘플/라이브 분기

```
DB.mode      'sample' | 'live'
DB.sb        supabase 클라이언트
DB.uid       auth 사용자 id
DB.hhId      household id
DB.cats/txs/rules/snaps/invs   원본 행 배열
DB.byYm / incByYm / invByYm / snapByYm   ym 별 인덱스
```

| 함수 | 역할 |
| --- | --- |
| `bootGate()` | 세션 확인 → `enterApp()` 또는 `enterSampleMode()` |
| `enterApp()` | 멤버 확인 → `refresh()` → `applyModel()` → `subscribe()` |
| `enterSampleMode()` | 가상 데이터로 렌더 (DB 접근 없음) |
| `refresh()` | 5개 테이블 재조회 (`households`, `categories`, `transactions`, `recurring_rules`, `asset_snapshots`, `investments`) |
| `applyModel()` | DB 행 → 화면 모델. 카테고리·월 범위·내역·규칙·이체·스냅샷·부동산·종목·순자산을 순서대로 재구성 |
| `commit(build, okMsg)` | 라이브에서만 동작. 실패 시 토스트 + 배지 `🔴 저장 실패`, 성공 시 `refresh()+renderAll()` |
| `ensureSeed()` | 카테고리가 하나도 없을 때 기본 9개 삽입 |
| `ensureFixed(ym)` | 그 달 고정 지출 자동 생성 (idempotent, `transfer` 제외) |
| `subscribe()` | 6개 테이블 Realtime 구독, 원격 변경 시 `scheduleSync()`로 묶어 새로고침 |
| `save()` | 샘플 모드 상태를 localStorage에 저장(`STORE_KEY`) |

원칙: **쓰기는 반드시 `commit()`을 통해서.** 직접 `DB.sb.from(...)`을 호출하면 실패 토스트·재렌더·Realtime 충돌 처리가 빠집니다(이체처럼 여러 테이블을 한 번에 다루는 곳은 `trApplyOps()` 사용).

---

## 4. Supabase DB 테이블 & 제약

| 테이블 | 주요 컬럼 | 주의 |
| --- | --- | --- |
| `households` | `id`, `name`, `emoji` | 부부 한 쌍 = 1행. 이름·이모지는 헤더 ✎에서 수정 |
| `household_members` | `household_id`, `user_id`, `role`, `label` | `label`은 `아내`/`남편`. 로그인 후 멤버 행이 없으면 게이트가 연결 SQL을 화면에 보여줍니다(`showMemberMissing()`) |
| `categories` | `household_id`, `key`, `label`, `emoji`, `color`, `budget_amount`, `sort_order` | `key`는 앱 내부 식별자(`food`, `dine`, …). `sort_order`가 화면 순서 |
| `transactions` | `household_id`, `ym`, `tx_date`, `kind`, `category_key`, `title`, `amount`, `pay_method`, `is_excluded`, `rule_id`, `created_by`, `updated_at` | `kind ∈ ('income','fixed','var')` · `tx_date`는 `YYYY-MM-DD` · 제외는 `is_excluded` · 단순 이체는 `category_key='transfer'` + `pay_method='TR1:…'` + `rule_id=null` |
| `recurring_rules` | `household_id`, `title`, `category_key`, `day_of_month`, `amount`, `pay_method`, `active_from`, `active_to` | `category_key='transfer'`면 이체 규칙. `active_to`가 지난 달이면 종료된 규칙 |
| `asset_snapshots` | `household_id`, `ym`, `kind`, `name`, `amount`, `meta` | `kind ∈ ('cash','debt','real_estate')`. `meta`(jsonb)에 부동산 매수가·매도 정보 |
| `investments` | `household_id`, `ym`, `bucket`, `account_name`, `ticker_name`, `sub_type`, `quantity`, `principal`, `eval_amount` | `bucket ∈ ('broker','pension')`. `quantity`는 소수 6자리까지 |

**RLS**

- 모든 테이블이 `household_id` 기준으로 잠깁니다. 정책은 로그인 사용자의 멤버 행을 통해 가계부 id를 얻는 헬퍼(`my_household_ids()` 형태)를 씁니다.
- Edge Function만 `service_role`로 RLS를 우회합니다. 프론트에서는 절대 우회하지 않습니다.

**Realtime**

- 구독 대상 6개: `households`, `categories`, `transactions`, `recurring_rules`, `asset_snapshots`, `investments`.
- 테이블을 새로 추가하면 `subscribe()`의 목록과 Supabase의 Realtime publication에 같이 넣어야 합니다.

**값 규칙 (깨지면 즉시 버그)**

- `ym`은 항상 `YYYY-MM` 문자열. `tx_date`는 `YYYY-MM-DD`. 날짜 계산은 `relYM()`, `daysIn()`, `toTxDate()`만 씁니다.
- 금액은 원 단위 정수(`bigint`). 소수점 금액은 넣지 않습니다.
- 이체 규칙·이체 완료 마커는 §3.6의 `TRF:` / `TRFLOG:` 인코딩을 그대로 따릅니다. 단순 이체는 §3.6-1의 `TR1:`입니다. `pay_method`를 사람이 읽는 문자열로 바꾸면 이체 카드가 이체 기록을 못 읽습니다.
- 스키마를 바꿔야 하면 **기존 행 마이그레이션 계획을 먼저** 세우고, 라이브가 아닌 별도 프로젝트에서 검증한 뒤 적용하세요.

---

## 5. Edge Function 3종 & Android Automate

세 함수 모두 Deno/TypeScript, CORS 헤더 포함, `POST`(ingest는 `GET` 상태 확인도 지원). 배포는 Supabase 대시보드 → Edge Functions → `Via Editor`에 파일 전체를 붙여넣는 방식입니다.

### 5.1 `ingest-card-msg` (v1.3.0)

- **역할**: 카드 결제 알림 텍스트를 파싱해 `transactions`에 저장.
- **인증**: Verify JWT **OFF**. 대신 시크릿 `CARD_INGEST_TOKEN`을 본문 `token` 또는 `x-ingest-token` 헤더로 검증. 시크릿이 비어 있으면 아무것도 저장하지 않고 `503`.
- **요청**

```json
{
  "token": "...",
  "title": "신한카드",
  "body": "신한카드(1234)승인 12,300원(일시불)11/19 20:19 스타벅스",
  "app": "com.shinhan.smartcare.mbank",
  "who": "남편",
  "cardHint": "신한 공용",
  "expectLast4": "1234",
  "expectText": "the Green",
  "categoryKey": "food",
  "payMethod": "공동카드",
  "amountKrw": 12300,
  "householdId": "(선택)",
  "dryRun": false
}
```

- **파싱 범위**: 카드사(14곳 규칙 + 일반형 추출), 카드 상품명, 끝 4자리/마스킹, 원화·외화 금액(누적·잔액·한도 숫자 제외), 날짜 형식 4종(KST), 할부 개월, 가맹점 정제(카드사·금액·날짜·이름·카드번호 조각·누적 문구 제거), 카테고리 추정(키워드 최장 일치 → 사용자 카테고리 라벨 → `etc`).
- **취소 알림**: `-금액`, 제목 `[취소] 가맹점`, `action='inserted_cancel'`. 중복 판정도 음수 금액 기준.
- **저장 안 함**: 청구 예정·명세서·한도·발급·인증번호·이벤트 알림. 승인 신호(`승인|일시불|할부|자동납부|취소`)가 없으면 카드 결제로 보지 않습니다.
- **중복**: 같은 날·같은 금액·비슷한 가맹점이 **5분** 안에 있으면 `duplicate`.
- **응답**: `{ ok, action: inserted | inserted_cancel | duplicate | ignored | dry_run, saved, parsed, message }`, 실패는 `{ ok:false, action:'error', error, hint }`.
- `created_by`는 `household_members.label`(`아내`/`남편`)로 찾아 넣고 없으면 `null`.

### 5.2 `get-quotes`

- **역할**: 주가·환율 조회. `POST { items: [{ id, ticker_name, symbol }] }`.
- **출처**: 국내 = 네이버 금융, 미국 = Yahoo(실패 시 네이버 해외), 환율 = Yahoo USDKRW(실패 시 네이버, 최후 fallback 상수).
- **응답**: `{ usdkrw, usdkrwSource, updatedAt, quotes: {id: {priceKrw, priceRaw, currency, symbol, matchedName, source, asOf}}, failed[] }`.
- 시크릿 불필요, 60초 메모리 캐시, 최대 80종목, 동시 6요청.
- `index.html` 호출부: `refreshQuotes()` → `/functions/v1/get-quotes`.

### 5.3 `get-realestate`

- **역할**: 국토교통부 아파트 매매 실거래가. `POST { lawdCd | 지역명, aptName, umdNm?, area?, months? }`.
- **시크릿**: `DATA_GO_KR_KEY` (공공데이터포털 인증키, Encoding/Decoding 둘 다 허용).
- 최근 12개월 병렬 조회, 해제 거래 제외, 면적 ±3㎡, 최신 5건 반환, 10분 캐시.
- **응답**: `{ ok, query, count, latest, recent[], monthsScanned[], note }` / 실패 시 `{ ok:false, error, hint, needKey? }`.

### 5.4 Android Automate (카드 알림 자동 기록)

- 부부 모두 안드로이드. `Automate`(영구 무료, 동시 30블록) 사용. MacroDroid 무료판은 7일 제한이라 쓰지 않습니다.
- 플로우: **알림 리스너**(카드사 앱 패키지/문구 필터) → **HTTP request**(`POST /functions/v1/ingest-card-msg`, JSON 본문, `x-ingest-token`) → 응답 `message`를 토스트/알림으로.
- 연속 알림·취소 알림이 밀리는 문제 때문에 `Fork`로 병렬 처리합니다.
- 공용 카드는 자동 저장, 개인 용돈 카드는 알림 탭에서 확인 후 밀어서 패스하는 흐름을 씁니다.
- 카드 구조는 사용자마다 다릅니다. **카드사·상품명·어느 카드가 공용인지는 사용자에게 확인**하고, 문서·코드에 카드 뒷자리를 적지 마세요.
- `dryRun: true`로 먼저 파싱 결과를 확인한 뒤 실저장으로 바꾸는 것이 안전합니다.

---

## 6. 수정 후 검증 절차 (필수)

수정했다고 보고하기 전에 **아래를 실제로** 확인하세요. "코드를 봤더니 맞다"는 검증이 아닙니다.

1. **샘플 모드 실행** — `python3 -m http.server` → `http://localhost:8000` → `샘플 체험 모드로 둘러보기`.
2. **콘솔 에러 0건** — DevTools Console에 빨간 에러가 없어야 합니다. `[ledger]` 접두사 로그도 확인.
3. **모바일 375px · 320px** — 가로 스크롤 없음, 금액 잘림 없음, 헤더 우측 컨트롤이 오른쪽 끝 정렬.
4. **양쪽 탭 전환** — 자산 & 증식 / 지출 & 분석. 각 카드 접기·펼치기, 새로고침 후에도 상태 유지.
5. **모달 전부** — 내역 추가·수정, 고정 규칙, 이번 달만 수정, 이체 규칙, 예산, 이름, 부동산, 종목. 열고 닫고 저장까지.
6. **월 이동** — 이전/다음/피커로 이동해 값이 다시 계산되는지.
7. **라이브 배포 확인** — 푸시 후 라이브 URL을 캐시 쿼리와 함께 열어 실제 반영 확인. 스크린샷을 남기면 보고에 첨부.
8. **라이브 DB 쓰기 금지** — 라이브에서 로그인해 테스트하려면 **조회만** 하세요. 저장 버튼을 누르는 테스트는 하지 않습니다.

보고 형식: ① 결론 한 줄 ② 실측 증빙(콘솔 캡처·스크린샷·커밋 해시) ③ 다음 액션.

---

## 7. 모바일 UI 규칙 (깨지면 바로 지적받는 것들)

- **375px 기준.** 카드 패딩·폰트가 이 폭에서 먼저 맞춰져 있습니다. 320px에서도 가로 스크롤이 없어야 합니다.
- **금액은 절대 줄바꿈되지 않게**: `.net-amount`, `.net-delta`, `.ys-v`, `.prow-h b`, `.tx .ta`, `.incrow .ia`, `.bsum b` 등에 `white-space:nowrap` + `font-variant-numeric:tabular-nums`.
- **긴 이름은 말줄임**: 통장명·가맹점명은 `min-width:0` + `overflow:hidden` + `text-overflow:ellipsis`. 줄바꿈으로 카드 높이가 늘어나면 안 됩니다.
- **헤더 우측 컨트롤**은 `.ch-right`(`margin-left:auto; justify-content:flex-end; flex-wrap:wrap; min-width:0`). 새 버튼은 여기 넣어야 다른 카드와 정렬이 맞습니다.
- **가로 스크롤은 칩 줄에서만** 허용(`.chips{overflow-x:auto}`). 그 외 영역에서 `overflow-x`가 생기면 레이아웃 버그입니다.
- **토스트 문구**는 `~했어요` 체. 예: `고정 지출 금액을 바꿨어요`, `이번 달은 이미 이체 완료로 기록돼 있어요`.
- **카드 구조**: `<div class="card"><div class="card-head"><h2>제목</h2>…</div>…</div>`. 접힘·쉐브론·헤더 정렬이 이 구조에 의존합니다.
- **색**: 손익은 한국 증시 기준 — 상승·이익 **빨강**(`#DC2626`), 하락·손실 **파랑**(`#2563EB`). 임의로 바꾸지 마세요.
- **숫자 포맷**은 `won()`, `pct()`, `signedWon()`만 사용. 직접 `toLocaleString`을 쓰지 마세요(반올림·단위 표기가 달라집니다).

---

## 8. 이미 깨졌던 것들 — 같은 실수 반복 금지

| 증상 | 원인 | 지금의 처리 |
| --- | --- | --- |
| 거래 날짜가 중복으로 결합됨 | `'11-02'`·`'2'` 같은 조각을 이어 붙임 | `toTxDate()`로 항상 `YYYY-MM-DD` 정규화 |
| 저축·이체가 지출로 두 번 잡힘 | 이체를 고정 지출로 넣음 | 이체는 `category_key='transfer'`로 분리, 지출 합계에서 제외 |
| 이체 규칙이 지출로 자동 생성됨 | `ensureFixed`가 `transfer`를 안 걸름 | `r.category_key !== 'transfer'` 조건 유지 |
| 이체 실패 후 잔액만 바뀜 | insert 응답에 의존해 롤백 | 마커 id 선발급 → 실패 시 `transactions` 삭제 + 잔액 원복 |
| 이체가 엉뚱한 달에 반영됨 | 그 달 자산 스냅샷이 없음 | 최근 달 기준으로 반영 + 토스트로 안내 |
| 거주지 기본값이 공개 소스에 노출 | 부동산 조회 기본값 | 중립화 완료. **다시 하드코딩 금지** |
| 고정 이체 규칙 텍스트 잘림 | 모바일에서 이름+금액 폭 경쟁 | `nowrap`·말줄임·폰트 축소 |
| 예산 카드 헤더만 우측 정렬 어긋남 | `.ch-right` 미사용 | `budgetNote`+버튼을 `.ch-right`로 감쌈 |
| 계좌별 종목이 기본 펼침 | `isCollapsed`가 `invacct:` 미처리 | `invacct:` 접두사 기본 접힘, 펼침은 `false` 저장 |
| 제외한 내역이 계속 눈에 띔 | 제외 목록 박스 노출 | `#exclBox`를 비워 숨김 |
| 과거 월 평가액이 이상함 | 현재 종목을 그대로 씀 | 최근 달 종목을 이어받고, 과거는 비례 환산 참고값 |
| 시세 버튼이 CORS로 실패 | 외부 API 직접 호출 | Edge Function 경유(`get-quotes`) |

---

## 9. 커밋 · 배포 절차

```bash
cd <repo>                          # 로컬 체크아웃
git pull --rebase origin main      # 먼저 최신화 (충돌 방지)
# index.html 수정
git status                         # 바뀐 파일 확인 — index.html 만인지
git add index.html                 # 문서가 아니면 문서를 섞지 않기
git commit -m "고정 이체 규칙 모바일 텍스트 잘림 수정"
git push origin main
```

- 커밋 메시지는 **한국어, 무엇을 왜** 고쳤는지 한 줄로. 예: `이체 시 이 달 자산 기록이 없으면 최근 달 기준으로 반영되면 토스트로 알리기`
- 여러 작업이 동시에 진행 중이면 `index.html` 충돌이 납니다. **푸시 전 `pull --rebase` 필수**, 충돌 시 상대 변경을 지우지 말고 합칩니다.
- 푸시 후 라이브에서 실제 반영을 확인하고 커밋 해시와 함께 보고합니다.
- 문서(`README.md`, `HANDOFF.md`)만 고칠 때도 같은 절차입니다.

---

## 10. 하지 말 것 / 먼저 물어볼 것

**하지 말 것**

- 실제 금액·계좌·주소·이름·전화번호·카드 뒷자리·키를 코드·문서·커밋 메시지·스크린샷에 넣기.
- 라이브 DB에 테스트 행 쓰기, 라이브 데이터 삭제·일괄 수정.
- `service_role` 키를 `index.html`에 넣기.
- 스키마를 즉석에서 바꾸기(마이그레이션 계획 없이).
- `index.html` 밖에 빌드 설정·프레임워크 도입(단일 파일 원칙).
- 샘플 모드와 라이브 모드 중 한쪽만 고치기 — 두 경로가 갈라집니다.

**먼저 사용자(또는 메인 에이전트)에게 물어볼 것**

- 실제 금액·계좌명·카드 구성(어느 카드가 공용인지) 같은 **사실 값**.
- 정책 결정: 개인 용돈 노출, 공개 범위, Private 전환, 결제·구독 도입.
- 라이브 데이터에 영향을 주는 마이그레이션·일괄 수정.

---

## 11. 빠른 참조 (grep 앵커)

줄 번호가 어긋나면 아래로 찾으세요.

```bash
grep -n "13. Supabase"                 index.html   # DB·게이트 섹션 시작
grep -n "function renderSpend"         index.html   # 지출 탭 렌더
grep -n "function renderAsset"         index.html   # 자산 탭 렌더
grep -n "function renderTransferCard"  index.html   # 이체 규칙 카드
grep -n "function ensureFixed"         index.html   # 고정 지출 자동 생성
grep -n "function trRunLive"           index.html   # 이체 실행
grep -n "function refreshQuotes"       index.html   # 시세
grep -n "function refreshRealEstate"   index.html   # 실거래
grep -n "const DEFAULT_COLLAPSED"      index.html   # 기본 접힘 카드
grep -n "function isCollapsed"         index.html   # 접힘 판정
grep -n "const DEFAULT_CATS"           index.html   # 샘플 카테고리 9개
grep -n "const SEED_CATS"              index.html   # 라이브 시딩 카테고리
grep -n "const TR_PREFIX"              index.html   # 이체 규칙 인코딩
grep -n "DB.saveCats"                  index.html   # 카테고리·예산 저장
grep -n "function toTxDate"            index.html   # 날짜 정규화
grep -n "DB.setExcluded"               index.html   # 제외 처리
grep -n "function commit"              index.html   # 쓰기 공통 경로
grep -n "function subscribe"           index.html   # Realtime 구독
grep -n "const SB_URL"                 index.html   # 접속 설정
```

---

## 12. 남은 일 · 다음 후보

- 카드 알림 플로우 확장: 남편 폰(신한·롯데 공용 자동, 하나 용돈 확인), 아내 폰 용돈 카드 확인 플로우.
- 보유 종목 `quantity` 입력이 끝나면 시세 새로고침이 전 종목에 적용됩니다.
- 공개 범위 정리: Private 저장소 전환·PIN 암호화 여부는 **사용자가 아직 결정하지 않았습니다.** 임의로 바꾸지 마세요.
- 기존 git 커밋 히스토리 정리 여부도 미결.
- iOS는 카드 알림 자동화 불가 — 사용자가 직접 입력하는 경로를 유지.
- Supabase 무료 플랜 7일 미사용 정지 대비: 주기적 활성 유지 스케줄 운영 중.
