// ─────────────────────────────────────────────────────────────
//  Supabase Edge Function · ingest-card-msg
//  부부 공동 가계부 — 안드로이드(MacroDroid) 카드 결제 알림 → 지출 자동 기록
//
//  ▸ 붙여넣는 곳 : 처음 배포 — Supabase 대시보드 → Edge Functions → Deploy a new function
//                  → Via Editor → 이름을 정확히 `ingest-card-msg` 로 → 아래 코드 전체 붙여넣기 → Deploy
//                  업데이트 — Edge Functions → ingest-card-msg → Code(Edit) 탭에서 전체 교체 → Deploy
//                  (Verify JWT 는 그대로 OFF, Secret·MacroDroid 매크로는 그대로 두면 됩니다)
//  ▸ 버전 1.3.0 · GET 으로 확인: { "version": "1.3.0", "tokenConfigured": true }
//  ▸ v1.3.0 추가 — 카드 결제도 기본으로 '생활비 통장'에서 나간 걸로 기록.
//      · pay_method 에 앱과 같은 형식(EXP:{"m":"공동카드","a":"토스뱅크 생활비+비상금","l":true})으로 통장을 같이 담아요.
//      · 그 달(같은 ym) asset_snapshots(kind='cash') 중 이름에 '생활비' 또는 'LOVE BANK' 가 들어가는 행이
//        한 개로 특정되면 결제 금액만큼 그 행의 amount 를 줄여요. (취소 알림은 반대로 복구)
//      · 통장을 직접 지정하려면 요청에 "expenseAccountName": "토스뱅크 생활비+비상금",
//        잔액 연동을 끄려면 "linkBalance": false 를 넣으세요. (기본값은 연동 ON)
//      · 은행 입출금 알림(v1.2.0 경로)은 이 경로로 오지 않아 이중 차감이 없어요.
//  ▸ v1.2.0 추가 — 공용 통장 입출금 알림(입금/출금 구분) 자동 기록 + 통장 잔액(asset_snapshots) 자동 반영.
//      기존 카드 승인/취소 파싱은 그대로예요(하위 호환).
//      요청에 sourceType ("auto" | "card" | "bank", 기본 auto) 과 accountName ("토스뱅크 생활비+비상금") 을 넣으면
//      은행 경로로 갈 때 그 통장으로 기록하고 잔액도 그 행에 맞춰요. (자세한 내용은 아래 '은행 입출금' 절)
//  ▸ Verify JWT : 반드시 '끄기'(OFF).
//      MacroDroid 는 publishable key 로는 JWT 를 못 만들어요. 대신 아래 CARD_INGEST_TOKEN 으로 잠급니다.
//  ▸ Secrets    : Edge Functions → Secrets
//        CARD_INGEST_TOKEN = 길고 랜덤한 문자열 (예: 40자 이상)   ← 필수
//      이 값이 비어 있으면 이 함수는 아무것도 저장하지 않고 503 으로 안내만 돌려줘요.
//  ▸ 요청  POST  { "token": "...", "body": "신한카드(1234)승인 홍길동 72,490원(일시불)11/29 20:19 (주)이마트 누적120,190원",
//                 "title": "신한카드", "app": "com.shinhan.smartcare.mbank",
//                 "who": "남편", "cardHint": "신한 공용",
//                 "expectLast4": "1234", "expectText": "the Green", "categoryKey": "util",
//                 "payMethod": "공동카드", "amountKrw": 29900, "householdId": "(선택)", "dryRun": false }
//      은행  POST  { "token": "...", "body": "토스뱅크 100,000원 입금 홍길동 잔액 3,280,000원",
//                 "sourceType": "bank", "accountName": "토스뱅크 생활비+비상금",
//                 "who": "아내", "excludePatterns": ["정기예금"], "dryRun": false }
//      헤더로는  x-ingest-token: <토큰>  도 됩니다. (본문 token 대신)
//  ▸ 응답  { "ok": true, "action": "inserted" | "inserted_cancel" | "duplicate" | "ignored" | "dry_run",
//            "saved": { "id": "...", "tx_date": "2026-11-17", "ym": "2026-11", "title": "이마트",
//                       "amount": 72490, "category_key": "food", "pay_method": "공동카드" },
//            "parsed": { ...파서가 읽은 값... }, "message": "가계부에 저장했어요 · 이마트 72,490원" }
//      취소  { "ok": true, "action": "inserted_cancel",
//            "saved": { ..., "title": "[취소] 이마트", "amount": -72490 },
//            "cancelMatch": { ...14일 안 같은 금액의 승인 기록(있으면)... },
//            "message": "-72,490원 취소 내역 기록 완료 · 이마트 (11.17)" }
//      은행  { "ok": true, "sourceType": "bank", "action": "inserted_income" | "inserted_expense" | "inserted_excluded",
//            "saved": { ..., "title": "홍길동", "amount": 100000, "kind": "income" },
//            "bank": { "bank": "토스뱅크", "direction": "in", "amount": 100000, "balance": 3280000, "party": "홍길동" },
//            "balanceUpdate": { "matched": true, "name": "토스뱅크 생활비+비상금", "ym": "2026-11",
//                               "before": 3180000, "after": 3280000, "applied": true },
//            "message": "통장 입금 기록 · 홍길동 100,000원 (11.20) · 잔액 3,280,000원 반영" }
//      실패  { "ok": false, "action": "error", "error": "사람이 읽을 수 있는 안내", "hint": "다음에 할 일" }
//
//  ── 결제 취소(승인취소) 처리 ────────────────────────────────
//    · 취소 알림도 transactions 에 **마이너스 금액(-금액)** 으로 저장해 승인 내역과 상쇄해요.
//      title 은 "[취소] 가맹점", action 은 "inserted_cancel".
//    · 중복 판단도 음수 금액 기준으로 승인과 똑같이 동작해요(같은 날 · -금액 · 같은 가맹점 · 5분).
//    · 카테고리는 원 결제와 같아지도록 가맹점으로 다시 추정해요(카테고리별 합계도 상쇄되도록).
//    · 금액을 읽지 못한 취소(해외 취소 등)는 저장하지 않고 need_amount 로 안내만 해요.
//
//  ── 은행 입출금 (v1.2.0) ────────────────────────────────────
//    · 입금 → kind='income' (title=적요·입금자, category_key=null)
//    · 출금 → kind='var'   (앱의 변동 지출과 같은 값 · title=적요·사용처, 8개 카테고리 자동 분류)
//      ※ DB check 제약이 kind in ('income','fixed','var') 라서 지출은 'var' 로 넣어요. ('expense' 는 저장 실패)
//    · 카드대금·비상금·내부이체 같은 이중 집계 패턴은 is_excluded=true 로 남기고 사유를 응답 message 에 적어요.
//    · 잔액이 파싱되고 공용 통장명이 정해지면 asset_snapshots(kind='cash', 같은 ym) 행의 amount 를
//      알림의 잔액으로 맞춰요. 행을 못 찾거나 후보가 여럿이면 거래만 저장하고 잔액은 건드리지 않아요.
//
//  ── 실제 DB 스키마에 맞춘 값 (public.transactions) ──────────────
//    household_id uuid, ym text 'YYYY-MM', tx_date date 'YYYY-MM-DD',
//    kind text check (kind in ('income','fixed','var'))   ← 변동 지출은 'var' (앱의 추가·수정 경로와 동일)
//    category_key text (= public.categories.key), title text, amount bigint,
//    pay_method text ('공동카드'|'자동이체'|'공동 현금'), is_excluded bool,
//    rule_id uuid null, created_by uuid (auth.users), updated_at timestamptz
//  · created_by 는 household_members.label('아내'/'남편') 로 찾아 넣고, 못 찾으면 null.
//  · RLS 는 service_role 키로 우회합니다(이 함수만 사용). 앱에서는 그대로 RLS 가 동작해요.
// ─────────────────────────────────────────────────────────────

/* ────────────────────────── 0. 상수 ────────────────────────── */

const CORS: Record<string, string> = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type, x-ingest-token",
  "Access-Control-Allow-Methods": "POST, GET, OPTIONS",
};

const EXPENSE_KIND = "var"; // DB check 제약: 'income' | 'fixed' | 'var'
const DEFAULT_PAY_METHOD = "공동카드";
/* 앱(가계부)과 같은 형식 — 지출의 결제수단 + 출금 통장을 pay_method 한 칸에 담아요. */
export const EXP_PREFIX = "EXP:";
/* 카드 결제가 기본으로 빠져나가는 생활비 통장 이름에 들어가는 키워드 */
const LIVING_ACCOUNT_RE = /(생활비|LOVE\s*BANK)/i;
export function isLivingAccountName(name: string): boolean {
  return LIVING_ACCOUNT_RE.test(String(name ?? ""));
}
/* m: 결제수단, a: 출금 통장, l: true = 그 통장 잔액에 이미 반영됨 */
export function encodeExpensePay(method: string, account: string, linked: boolean): string {
  if (!account) return method || "";
  return EXP_PREFIX + JSON.stringify({ m: method || "", a: account, l: !!linked });
}
const DEDUPE_WINDOW_MS = 5 * 60_000; // 같은 날짜·금액·가맹점이 5분 안에 또 오면 저장 스킵
const MAX_BODY_LEN = 2_000;
const MAX_TITLE_LEN = 40;
const KST_OFFSET_MS = 9 * 60 * 60 * 1000;

/* ────────────────────── 1. 타입 ────────────────────── */

export type CardInfo = {
  issuer: string | null; // 신한 / 롯데 / 현대 / 하나 ...
  last4: string | null; // 카드 끝 4자리 (알림에 있으면)
  mask: string | null; // 1*3* 처럼 가려진 원본 표기
  name: string | null; // 카드 상품명 (the Green, ZERO ...)
};

export type Parsed = {
  isCard: boolean; // 카드 승인/취소 알림으로 보이는가
  kind: "approval" | "cancel" | "foreign" | "point" | "unknown";
  amount: number | null; // 원 (정수)
  foreign: { value: number; currency: string } | null; // 해외 결제 원금액
  merchant: string | null;
  date: string; // YYYY-MM-DD (KST)
  dateFromText: boolean; // 알림 안의 날짜를 썼는지 (아니면 오늘)
  installments: number | null; // 할부 개월
  card: CardInfo;
  categoryKey: string | null; // 가맹점 키워드로 고른 카테고리 후보(DB 확인 전)
  warnings: string[];
  raw: string;
};

/* ────────────────────── 2. 문자열 정리 ────────────────────── */

/** 전각·특수 공백 정리. NFKC 로 ［］·１２３ 같은 전각도 일반 문자로 바꿔요. */
export function normalize(text: string): string {
  let s = String(text ?? "");
  try {
    s = s.normalize("NFKC");
  } catch (_) {
    /* 구형 런타임은 무시 */
  }
  return s
    .replace(/[\u200B-\u200D\uFEFF]/g, "")
    .replace(/[\u00A0\u2007\u202F]/g, " ")
    .replace(/\r\n?/g, "\n")
    .trim();
}

/** 화면·MacroDroid 어디서 오든 본문 한 덩어리로. 제목과 본문이 나뉘어 오면 붙여서 읽어요. */
function joinText(title: string | undefined, body: string): string {
  const t = normalize(title || "");
  const b = normalize(body || "");
  if (!t) return b;
  if (!b) return t;
  if (b.indexOf(t) >= 0) return b; // 제목이 본문에 이미 들어 있음
  if (t.indexOf(b) >= 0) return t;
  return t + " " + b;
}

/* ────────────────────── 3. 카드사·카드 식별 ────────────────────── */

type IssuerRule = { name: string; re: RegExp };
const ISSUERS: IssuerRule[] = [
  { name: "신한", re: /(신한\s*카드|신한\s*체크|신한플레이|신한\s*SOL|신한|신한카드\(?)/i },
  { name: "롯데", re: /(롯데\s*카드|디지로카|롯데\s*체크|롯데(?![가-힣]))/i },
  { name: "현대", re: /(현대\s*카드|현대카드|현대\s*M|현대\s*ZERO|현대(?![가-힣]))/i },
  { name: "하나", re: /(하나\s*카드|하나\s*체크|하나카드|하나\(?)/i },
  { name: "KB국민", re: /(KB\s*국민\s*카드|KB국민|KB\s*카드|국민\s*카드|KB(?![가-힣]))/i },
  { name: "우리", re: /(우리\s*카드|우리\s*체크|우리(?![가-힣]))/i },
  { name: "NH농협", re: /(NH\s*농협\s*카드|NH농협|NH\s*카드|농협\s*카드|NH(?![가-힣]))/i },
  { name: "BC", re: /(BC\s*카드|비씨\s*카드|BC(?![가-힣]))/i },
  { name: "삼성", re: /(삼성\s*카드|삼성(?![가-힣]))/i },
  { name: "카카오페이", re: /(카카오페이\s*카드|카카오페이)/i },
  { name: "네이버페이", re: /(네이버페이\s*카드|네이버페이|네이버\s*페이)/i },
  { name: "토스", re: /(토스\s*뱅크\s*카드|토스\s*카드|토스뱅크|토스(?![가-힣]))/i },
  { name: "케이뱅크", re: /(케이뱅크\s*카드|케이뱅크)/i },
];

/** 알림 앱(패키지/앱 이름)으로 카드사 보정 — 앱 푸시에는 카드사 이름이 없는 경우가 많아요. */
const ISSUER_BY_APP: { re: RegExp; issuer: string }[] = [
  { re: /shinhan|신한/i, issuer: "신한" },
  { re: /lotte|롯데|digiroca|디지로카/i, issuer: "롯데" },
  { re: /hyundai|현대/i, issuer: "현대" },
  { re: /hana|하나/i, issuer: "하나" },
  { re: /kb|국민/i, issuer: "KB국민" },
  { re: /woori|우리/i, issuer: "우리" },
  { re: /nh|농협/i, issuer: "NH농협" },
  { re: /bc|비씨/i, issuer: "BC" },
  { re: /samsung|삼성/i, issuer: "삼성" },
  { re: /kakaopay|kakao|카카오/i, issuer: "카카오페이" },
  { re: /naverpay|naver|네이버/i, issuer: "네이버페이" },
  { re: /toss|토스/i, issuer: "토스" },
];

const CARD_NAMES = [
  "the Green", "the Red", "the Purple", "the Black", "the Pink", "the Orange",
  "ZERO", "M2", "M Edition", "Deep", "Onnuri", "온누리", "카드의정석",
  "iD ON", "iD", "LOCA LIKIT", "LOCA", "노리2", "노리", "Mr.Life", "알뜰교통",
  "이마트e", "T-lite", "K-패스", "케이패스", "S-Line", "S라인", "세이프",
  "트래블로그", "TRAVELOG", "글로브", "GLOW", "포인트+", "Point+",
];

export function detectIssuer(text: string, app?: string): string | null {
  const t = normalize(text);
  for (const rule of ISSUERS) if (rule.re.test(t)) return rule.name;

  // 목록에 없는 카드사도 '○○카드'·[○○카드]·'○○페이' 형태면 그대로 이름을 뽑아 씁니다.
  //  → 나중에 카드사를 추가해도 이 함수를 고칠 필요가 없어요.
  const tag = t.match(/[\[［]\s*(?![Ww]eb\s*발신)([가-힣A-Za-z]{2,8})\s*[\]］]/);
  if (tag && /카드|페이|뱅크|캐피탈/.test(tag[1])) return tag[1];
  const word = t.match(/(?<![가-힣A-Za-z])([가-힣A-Za-z]{2,6})\s*(?:카드|체크카드|신용카드|페이)(?![가-힣])/);
  if (word) return word[1].replace(/(카드|체크|페이)$/, "") || word[1];

  const a = String(app || "");
  if (a) for (const rule of ISSUER_BY_APP) if (rule.re.test(a)) return rule.issuer;
  return null;
}

/** 카드 끝 4자리·가려진 표기·카드 이름을 알림에서 찾아요. */
export function extractCard(text: string, app?: string): CardInfo {
  const t = normalize(text);
  const issuer = detectIssuer(t, app);

  // 카드 이름
  let name: string | null = null;
  for (const cn of CARD_NAMES) {
    const esc = cn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
    // 짧은 이름(M·M2·iD)은 앞뒤 경계를 보고, 긴 이름(the Green·ZERO)은 붙어 있어도 인정해요(현대ZERO승인).
    const re = cn.length <= 3
      ? new RegExp("(?<![A-Za-z])" + esc + "(?![A-Za-z0-9])", "i")
      : new RegExp(esc, "i");
    if (re.test(t)) {
      name = cn;
      break;
    }
  }

  // 가려진 카드번호: (1234) · (1*3*) · 1*3*
  let mask: string | null = null;
  const maskM = t.match(/[\(\[]\s*(\d{1,4}(?:\*+\d{0,4})?|\*{2,}\d{0,4})\s*[\)\]]/) ||
    t.match(/(?<![0-9,])(\d{1,2}\*+\d{0,2}\*?)(?![0-9,])/);
  if (maskM) {
    mask = maskM[1];
  }

  const cands: string[] = [];
  const push = (v: string | undefined | null) => {
    if (v && /^\d{4}$/.test(v) && cands.indexOf(v) < 0) cands.push(v);
  };
  // 1234승인 · 6904 승인 · (1234) · 끝 1234
  for (const m of t.matchAll(/(\d{4})\s*(?=승인|일시불|할부)/g)) push(m[1]);
  for (const m of t.matchAll(/[\(\[]\s*(\d{4})\s*[\)\]]/g)) push(m[1]);
  for (const m of t.matchAll(/(?:끝\s*|카드\s*)(\d{4})(?![0-9,])/g)) push(m[1]);

  // 카드 이름 뒤에 붙은 상품명(롯데OO 처럼) 이나 날짜·금액과 겹치지 않는 4자리만 신뢰해요.
  let last4 = cands.length ? cands[0] : null;
  if (last4 && isYearLike(last4) && cands.length === 1) last4 = null;

  // 1*3* 같은 마스킹은 4자리를 알 수 없어요 → mask 로만 남깁니다.
  if (!last4 && mask && /^\d{4}$/.test(mask)) last4 = mask;

  return { issuer, last4, mask, name };
}

function isYearLike(v: string): boolean {
  const n = Number(v);
  return n >= 1990 && n <= 2100;
}

/* ────────────────────── 4. 금액 ────────────────────── */

const CURRENCY_UNIT: Record<string, string> = {
  원: "KRW", 엔: "JPY", 달러: "USD", 위안: "CNY", 유로: "EUR",
  동: "VND", 바트: "THB", 파운드: "GBP", 홍콩달러: "HKD",
};
/** 금액 후보 바로 앞에 있으면 금액이 아니라 '누적·잔액' 숫자인 경우 */
const AMOUNT_EXCLUDE_BEFORE = /(누적금액|총누적|누적|잔액|잔여한도|잔여|가용한도|가용|한도|합계|누계|포인트|적립|마일리지|할인|승인번호|이번달|당월|사용가능|결제예정)$/;

type AmountHit = { value: number; unit: string; index: number; raw: string };

function collectAmounts(text: string): AmountHit[] {
  const hits: AmountHit[] = [];
  const re = /(-|−)?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(원|엔|달러|위안|유로|동|바트|파운드|홍콩달러|KRW|USD|JPY|CNY|EUR|VND|THB)/gi;
  for (const m of text.matchAll(re)) {
    const at = m.index || 0;
    const raw = m[2].replace(/,/g, "");
    const value = Number(raw);
    if (!isFinite(value) || value <= 0) continue;
    // 시각 뒤에 붙은 숫자(17:48 USD …) 는 금액이 아니에요
    if (at > 0 && text[at - 1] === ":") continue;
    const before = text.slice(Math.max(0, at - 12), at).replace(/[\s:：]/g, "");
    if (AMOUNT_EXCLUDE_BEFORE.test(before)) continue;
    hits.push({ value, unit: m[3].toUpperCase(), index: at, raw: m[0] });
  }
  // "USD 20.63" 처럼 통화가 앞에 오는 형태
  const re2 = /(USD|JPY|CNY|EUR|VND|THB|GBP|HKD|TWD)\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)/gi;
  for (const m of text.matchAll(re2)) {
    const value = Number(m[2].replace(/,/g, ""));
    if (!isFinite(value) || value <= 0) continue;
    hits.push({ value, unit: m[1].toUpperCase(), index: m.index || 0, raw: m[0] });
  }
  return hits.sort((a, b) => a.index - b.index);
}

export function extractAmount(text: string): {
  amount: number | null;
  foreign: { value: number; currency: string } | null;
  raw: string | null;
} {
  const hits = collectAmounts(normalize(text));
  const krw = hits.filter((h) => h.unit === "KRW" || h.unit === "원");
  if (krw.length) return { amount: Math.round(krw[0].value), foreign: null, raw: krw[0].raw.trim() };

  const foreign = hits.find((h) => h.unit !== "KRW");
  if (foreign) {
    const code = CURRENCY_UNIT[foreign.unit.toLowerCase()] || foreign.unit.toUpperCase();
    return { amount: null, foreign: { value: foreign.value, currency: code }, raw: foreign.raw.trim() };
  }
  // '4.48달러' 처럼 단위가 뒤에 붙은 경우만 남은 케이스
  const m = normalize(text).match(/(-|−)?\s*((?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?)\s*(달러|엔|유로|위안)/);
  if (m) {
    const value = Number(m[2].replace(/,/g, ""));
    const unit = m[3];
    return { amount: null, foreign: { value, currency: CURRENCY_UNIT[unit] || "USD" }, raw: m[0].trim() };
  }
  return { amount: null, foreign: null, raw: null };
}

/* ────────────────────── 5. 날짜 (KST) ────────────────────── */

/** 지금 시각을 한국 시간 기준 YYYY-MM-DD 로 */
export function kstDate(now: Date = new Date()): string {
  const d = new Date(now.getTime() + KST_OFFSET_MS);
  return d.getUTCFullYear() + "-" + pad2(d.getUTCMonth() + 1) + "-" + pad2(d.getUTCDate());
}
function pad2(n: number): string {
  return (n < 10 ? "0" : "") + n;
}
function shiftDate(ymd: string, days: number): string {
  const [y, m, d] = ymd.split("-").map(Number);
  const t = Date.UTC(y, m - 1, d) + days * 86_400_000;
  const dt = new Date(t);
  return dt.getUTCFullYear() + "-" + pad2(dt.getUTCMonth() + 1) + "-" + pad2(dt.getUTCDate());
}
function isRealDate(y: number, m: number, d: number): boolean {
  if (m < 1 || m > 12 || d < 1 || d > 31) return false;
  const probe = new Date(Date.UTC(y, m - 1, d));
  return probe.getUTCMonth() === m - 1 && probe.getUTCDate() === d;
}

/**
 * 알림 안의 날짜를 찾아요. 형식: 11/17 · 11.17 · 2026.11.17 · 11월 17일 · 3/1
 * 날짜가 없으면 오늘(KST). 연도가 없는데 오늘보다 미래면 작년으로 봐요(연말·연초 알림 보정).
 */
export function extractDate(text: string, now: Date = new Date()): { date: string; fromText: boolean } {
  const t = normalize(text);
  const today = kstDate(now);
  const thisYear = Number(today.slice(0, 4));
  const todayMonth = Number(today.slice(5, 7));

  // 2026.11.17 / 2026-11-17 / 2026/11/17
  for (const full of t.matchAll(/(20\d{2})\s*[.\-\/]\s*(\d{1,2})\s*[.\-\/]\s*(\d{1,2})/g)) {
    const [y, m, d] = [Number(full[1]), Number(full[2]), Number(full[3])];
    if (isRealDate(y, m, d)) return { date: `${y}-${pad2(m)}-${pad2(d)}`, fromText: true };
  }

  // 11월 17일
  for (const kr of t.matchAll(/(\d{1,2})\s*월\s*(\d{1,2})\s*일/g)) {
    const m = Number(kr[1]);
    const d = Number(kr[2]);
    if (isRealDate(thisYear, m, d)) return { date: `${thisYear}-${pad2(m)}-${pad2(d)}`, fromText: true };
  }

  // 03/2611:17 처럼 날짜·시각이 붙어 오는 형태(일부 카드사)
  for (const merged of t.matchAll(/(?<![0-9,.])(\d{1,2})\s*[\/.]\s*(\d{2})(\d{1,2})\s*:\s*(\d{2})(?![0-9])/g)) {
    const m = Number(merged[1]);
    const d = Number(merged[2]);
    if (isRealDate(thisYear, m, d)) return { date: thisYear + "-" + pad2(m) + "-" + pad2(d), fromText: true };
  }

  // 11/17 · 11.17 · 3/1 — 금액·소수(39.99)는 건너뛰고 진짜 날짜가 나올 때까지 훑어요
  for (const md of t.matchAll(/(?<![0-9,.])(\d{1,2})\s*[\/.]\s*(\d{1,2})(?![0-9,])/g)) {
    const m = Number(md[1]);
    const d = Number(md[2]);
    if (!isRealDate(thisYear, m, d)) continue;
    let year = thisYear;
    // 새해 첫날에 온 '12/31' 알림은 작년 것으로 봐요. 그 밖의 미래 날짜는 경고만 남깁니다.
    if (m === 12 && todayMonth === 1) year = thisYear - 1;
    return { date: year + "-" + pad2(m) + "-" + pad2(d), fromText: true };
  }
  return { date: today, fromText: false };
}

/* ────────────────────── 6. 가맹점 ────────────────────── */

const MERCHANT_STOP = new Set([
  "카드", "승인", "결제", "사용", "이용", "내역", "알림", "포인트", "적립",
  "원", "님", "해외", "건", "금액", "일시불", "할부", "취소", "정상", "체크",
  "the", "and", "for", "with", "www", "com",
]);

/** 가맹점명만 남겨요. 카드사·금액·날짜·승인 키워드·이름·누적 문구를 모두 걷어냅니다. */
export function extractMerchant(raw: string): string | null {
  let s = " " + normalize(raw) + " ";

  s = s.replace(/[\[［][^\]］]{1,30}[\]］]/g, " "); // [Web발신] [현대카드] [KB국민카드] [카카오페이]
  s = s.replace(/(web|국외|해외)\s*발신/gi, " ");

  // 누적·잔액·한도 문구 (숫자까지) — '누적금액 1,094,477원', '누적 754,000원', '총누적-4,645원'
  s = s.replace(
    /(총\s*누적\s*금액|누적\s*금액|총\s*누적|누적|잔액|잔여\s*한도|잔여|가용\s*한도|사용\s*가능\s*금액|잔여\s*금액|한도|결제\s*예정\s*금액)\s*[:：\-]?\s*[-−]?\s*[\d,.]*\s*(원|P|포인트)?/g,
    " ",
  );

  // 카드번호 조각
  s = s.replace(/[\(\[]\s*[*\dxX,\s]{2,10}\s*[\)\]]/g, " "); // (****) (1234) (9xxx) (1*3*)
  s = s.replace(/(?<![0-9,.\/])[\d,]{0,4}[xX]{2,}[\dxX]*/g, " "); // 9xxx, 1234****
  s = s.replace(/(?<![0-9,.\/])\d{1,4}\s*\*\s*\d{0,4}(?![0-9,])/g, " "); // 1*3*
  s = s.replace(/(?<![0-9,.\/])\d{2,4}\s*(?=승인)/g, " "); // 6904승인
  s = s.replace(/(포인트\+?|Point\+?)\s*/gi, " ");

  // 이름: '승인 홍길동 72,490원', '승인 박*진 45,600원', '이*름님', '홍길동 님,'
  s = s.replace(/(승인|결제|이용|사용|해외승인)\s+[가-힣]{2,4}\s*(?:님|씨)?\s*[,.]?\s*(?=[-−]?\s*[\d(])/g, " ");
  s = s.replace(/[가-힣]{0,2}\s*\*+\s*[가-힣0-9*]{0,3}\s*님?/g, " ");
  s = s.replace(/[가-힣]\s*\*\s*[가-힣]\s*님?/g, " ");
  s = s.replace(/(?<![가-힣])[가-힣]{1,4}\s*님(?![가-힣])/g, " ");

  // 금액 (원·엔·달러 …) 과 외화 코드
  s = s.replace(/[-−]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:원|엔|달러|위안|유로|동|바트|파운드)/g, " ");
  s = s.replace(/\b(?:USD|JPY|CNY|EUR|VND|THB|GBP|HKD|TWD)\s*[\d,.]+/gi, " ");
  s = s.replace(/[\d,.]+\s*(?:USD|JPY|CNY|EUR|VND|THB|GBP|HKD|TWD)\b/gi, " ");
  s = s.replace(/[\d,.]+\s*P(?![A-Za-z가-힣])/g, " ");

  // 날짜·시간 (03/2611:17 처럼 붙은 것도)
  s = s.replace(/\d{4}\s*[.\-\/]\s*\d{1,2}\s*[.\-\/]\s*\d{1,2}/g, " ");
  s = s.replace(/(?<![0-9,])\d{1,2}\s*[\/.]\s*\d{2}\s*\d{1,2}\s*:\s*\d{2}(?![0-9])/g, " ");
  s = s.replace(/(?<![0-9,])\d{1,2}\s*[\/.]\s*\d{1,2}(?![0-9])/g, " ");
  s = s.replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ");
  s = s.replace(/(?<![0-9])\d{1,2}\s*:\s*\d{2}(?![0-9])/g, " ");
  s = s.replace(/(?<![0-9])\d{4}[년]\s*\d{1,2}[월]\s*\d{1,2}[일]/g, " ");

  // 승인/취소·결제수단 키워드
  s = s.replace(/(체크|해외|국내|정상|자동\s*납부|자동\s*결제|정기\s*결제|정기\s*승인|간편|온라인)\s*승인\s*취소/g, " ");
  s = s.replace(/(승인\s*취소|결제\s*취소|매입\s*취소|취소\s*완료|취소\s*처리되었습니다|취소되었습니다|취소)/g, " ");
  s = s.replace(/(자동\s*납부|자동\s*결제|정기\s*결제|정기\s*승인|후불교통|간편\s*결제|일시불|할부\s*\d*\s*개월?|무이자|부분\s*무이자)/g, " ");
  s = s.replace(
    /(이용\s*건|이용\s*분|이용\s*내역|사용\s*내역|타인\s*결제\s*우려\s*시?\s*문의|우려\s*시?\s*문의|문의|이용|사용|승인|결제|해외\s*건|해외|국내|입니다|요망|고객님|회원님)/g,
    " ",
  );

  // 카드사·카드 상품명 — 브랜드명(롯데백화점·삼성전자·신한은행)은 건드리지 않도록
  // '카드/체크'가 붙은 형태, '현대ZERO'·'롯데OO' 같은 상품 표기, 맨 앞에 홀로 온 카드사 이름만 걷어냅니다.
  s = s.replace(/(?<![가-힣A-Za-z])([가-힣A-Za-z]{2,8})\s*(?:카드의|카드|체크)/g, " ");
  s = s.replace(
    /(?<![가-힣A-Za-z])(신한|삼성|현대|KB|국민|우리|하나|롯데|NH|농협|BC|비씨|카카오|네이버|토스|케이뱅크)\s*[A-Za-z]{1,6}(?=\s|$|\d)/g,
    " ",
  );
  s = s.replace(
    /^\s*(신한|삼성|현대|KB\s*국민|국민|우리|하나|롯데|NH\s*농협|NH|농협|BC|비씨|카카오페이|네이버페이|토스\s*뱅크|토스|케이뱅크|카카오뱅크|카카오|수협|신협|우체국|IBK|기업은행)(?=\s|$)/,
    " ",
  );
  for (const cn of CARD_NAMES) {
    const re = new RegExp(cn.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"), "gi");
    s = s.replace(re, " ");
  }
  s = s.replace(/\bthe\s+[A-Z][A-Za-z]+\b/g, " ");
  s = s.replace(/(?<![A-Za-z])M(?![A-Za-z0-9])/g, " ");

  // 주소·국가 코드·기타 잡음
  s = s.replace(/[\(\[]\s*[A-Z]{2}\s*[\)\]]/g, " "); // (JP) (US)
  s = s.replace(/[(]주[)]|주식회사/g, " ");
  s = s.replace(/[\/|,·•]/g, " ");
  s = s.replace(/[-−]{1,}/g, " ");
  s = s.replace(/[()\[\]{}]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  const tokens = s.split(" ").filter((tok) => {
    const t = tok.replace(/[^0-9A-Za-z가-힣]/g, "");
    if (!t) return false;
    if (MERCHANT_STOP.has(t)) return false;
    if (t.length === 1 && /^[0-9]$/.test(t)) return false;
    return true;
  });
  if (!tokens.length) return null;
  const name = tokens.join(" ").replace(/\s+/g, " ").trim();
  return name || null;
}

/* ────────────────────── 7. 카테고리 ────────────────────── */

/** 실제 가계부 카테고리 key 와 1:1. (앱 기본 카테고리: food·dine·home·util·living·transit·gift·leisure·health) */
export const CATEGORY_RULES: { key: string; words: string[] }[] = [
  {
    key: "food",
    words: [
      "이마트", "홈플러스", "롯데마트", "코스트코", "하나로마트", "농협하나로", "노브랜드",
      "마켓컬리", "컬리", "오아시스", "쿠팡프레시", "프레시", "이마트에브리데이", "메가마트",
      "정육", "수산", "청과", "반찬", "식료품", "식자재", "농수산", "쌀", "과일", "야채",
      "파리바게뜨", "뚜레쥬르", "제과", "베이커리", "빵집", "성심당", "던킨", "스타벅스리저브",
    ],
  },
  {
    key: "dine",
    words: [
      "스타벅스", "투썸", "메가커피", "메가엠지씨", "컴포즈", "이디야", "빽다방", "커피",
      "카페", "폴바셋", "커피빈", "할리스", "탐앤탐스", "배달", "배민", "배달의민족", "요기요",
      "쿠팡이츠", "맥도날드", "롯데리아", "버거킹", "맘스터치", "KFC", "서브웨이", "쉐이크쉑",
      "김밥", "분식", "김가네", "본죽", "치킨", "교촌", "BBQ", "비비큐", "bhc", "푸라닭",
      "피자", "도미노", "파파존스", "미스터피자", "국밥", "냉면", "떡볶이", "쭈꾸미", "곱창",
      "삼겹", "고기", "구이", "횟집", "초밥", "스시", "라멘", "우동", "파스타", "이자카야",
      "호프", "주점", "술집", "와인", "식당", "한식", "중식", "일식", "양식", "뷔페", "푸드코트",
      "죽", "샐러드", "도시락", "편의점푸드",
    ],
  },
  {
    key: "home",
    words: [
      "관리비", "아파트", "주택", "임대", "전세", "월세", "부동산", "LH", "SH", "주거",
      "이사", "인테리어", "리모델링", "생활수리", "수리", "가구", "침구", "이케아", "한샘",
      "주담대", "대출이자", "재건축",
    ],
  },
  {
    key: "util",
    words: [
      "KT", "SKT", "SK텔레콤", "LGU", "LG유플러스", "유플러스", "통신", "인터넷", "알뜰폰",
      "한국전력", "전기", "수도", "상수도", "도시가스", "가스", "지역난방", "난방", "정수기",
      "렌탈", "요금", "공과금", "방송", "케이블", "IPTV", "넷플릭스", "유튜브프리미엄", "스포티파이",
      "쿠팡와우", "멜론", "왓챠", "티빙", "웨이브", "구독",
    ],
  },
  {
    key: "living",
    words: [
      "다이소", "무인양품", "무지", "편의점", "GS25", "CU", "씨유", "세븐일레븐", "이마트24",
      "미니스톱", "올리브영", "랄라블라", "생활용품", "세제", "휴지", "청소", "욕실", "주방용품",
      "생필품", "반려", "펫", "화장품", "드럭스토어",
    ],
  },
  {
    key: "transit",
    words: [
      "주유", "GS칼텍스", "칼텍스", "SK에너지", "S-OIL", "에스오일", "오일뱅크", "HD현대오일",
      "셀프주유", "충전소", "지하철", "버스", "택시", "카카오T", "카카오택시", "타다", "우버",
      "KTX", "SRT", "코레일", "티머니", "하이패스", "주차", "정비", "카센터", "타이어",
      "렌터카", "쏘카", "그린카", "전기차충전", "에버온", "교통", "톨게이트", "고속도로",
    ],
  },
  {
    key: "gift",
    words: [
      "꽃", "플라워", "화환", "축의금", "조의금", "부조", "선물", "답례", "청첩장", "상품권",
      "카카오선물", "선물하기", "기프티콘", "떡집", "이바돔",
    ],
  },
  {
    key: "leisure",
    words: [
      "영화", "CGV", "메가박스", "롯데시네마", "공연", "예스24", "교보문고", "알라딘", "서점",
      "여행", "야놀자", "여기어때", "호텔", "항공", "제주항공", "대한항공", "아시아나", "진에어",
      "티웨이", "에어부산", "노래방", "PC방", "게임", "스팀", "넥슨", "배틀넷",
      "운동용품", "취미", "문구", "오피스디포", "알파문구",
    ],
  },
  {
    key: "shopping",
    words: [
      "쿠팡", "네이버쇼핑", "스마트스토어", "무신사", "지그재그", "에이블리", "29CM", "W컨셉",
      "11번가", "G마켓", "지마켓", "옥션", "SSG", "쓱닷컴", "롯데온", "마켓", "쇼핑",
      "백화점", "아울렛", "면세점", "하이마트", "전자랜드", "삼성닷컴", "오늘의집", "무신사스토어",
    ],
  },
  {
    key: "health",
    words: [
      "병원", "의원", "약국", "한의원", "치과", "안과", "피부과", "정형", "내과", "소아과",
      "이비인후과", "산부인과", "비뇨", "신경", "재활", "건강검진", "검진", "메디컬", "클리닉",
      "필라테스", "헬스", "요가", "크로스핏", "클라이밍", "수영", "골프", "테니스", "보험",
      "실손", "약", "영양제", "닥터", "의료",
    ],
  },
];

/**
 * 카테고리 key 별명 — 가계부가 9개(기본)든 8개(쇼핑·여행·여가 분리)든 같은 키워드가
 * 실제로 존재하는 key 로 붙게 해요. 앞에 있는 것이 우선.
 */
const CATEGORY_KEY_ALIASES: Record<string, string[]> = {
  food: ["food", "grocery", "groceries", "food_grocery"],
  dine: ["dine", "cafe", "eating_out", "dining"],
  home: ["home", "util", "housing", "utility"],
  util: ["util", "home", "utility", "housing"],
  living: ["living", "shopping", "daily"],
  transit: ["transit", "trans", "transport", "car"],
  gift: ["gift", "event", "present"],
  leisure: ["leisure", "travel", "trip"],
  shopping: ["shopping", "leisure", "living"],
  health: ["health", "med", "medical"],
};

/** 가맹점 이름 → 카테고리 key (DB 에 실제로 있는 key 만 돌려줘요) */
export function guessCategory(
  merchant: string | null,
  available: { key: string; label?: string }[] | null,
): string | null {
  const has = (k: string) => !!available && available.some((c) => c.key === k);
  const resolve = (ruleKey: string): string | null => (CATEGORY_KEY_ALIASES[ruleKey] || [ruleKey]).find((k) => has(k)) || null;
  const name = String(merchant || "");

  if (name) {
    const lower = name.toLowerCase();
    // 가장 길게 일치한 키워드가 이겨요 — '롯데하이마트'가 '이마트'(식비)로 새지 않도록.
    let bestKey: string | null = null;
    let bestLen = 0;
    for (const rule of CATEGORY_RULES) {
      const key = resolve(rule.key);
      if (!key) continue;
      for (const w of rule.words) {
        if (w.length <= bestLen) continue;
        if (lower.indexOf(w.toLowerCase()) >= 0) {
          bestKey = key;
          bestLen = w.length;
        }
      }
    }
    if (bestKey) return bestKey;
    // 사용자가 직접 만든 카테고리 라벨과 겹치면 그쪽을 우선 (예: 라벨 '반려동물')
    if (available) {
      for (const c of available) {
        const words = String(c.label || "").split(/[·\/,()\s]+/).filter((w) => w.length >= 2);
        for (const w of words) if (lower.indexOf(w.toLowerCase()) >= 0) return c.key;
      }
    }
  }
  // 가계부에 '기타' 카테고리가 있으면 거기에 넣고, 없으면 비워 둘니다(앱에서 ✎로 바로 고칠 수 있어요).
  if (available && has("etc")) return "etc";
  return null;
}

/* ────────────────────── 8. 은행 입출금 (v1.2.0) ────────────────────── */

export type ParsedBank = {
  isBank: boolean; // 은행 입출금 알림으로 보이는가
  bank: string | null; // 토스뱅크 / 카카오뱅크 / SC제일은행 …
  accountName: string | null; // 요청으로 받은 공용 통장 이름(있으면)
  direction: "in" | "out" | null; // 입금 / 출금
  amount: number | null; // 거래 금액(원)
  balance: number | null; // 알림에 찍힌 잔액(원)
  party: string | null; // 적요 · 입금자 · 사용처
  date: string; // YYYY-MM-DD (KST)
  dateFromText: boolean;
  excluded: boolean; // 중복 집계 방지용 제외 표시
  excludeReason: string | null;
  warnings: string[];
  raw: string;
};

/** 은행 이름 — 카드사와 헷갈리지 않게 '은행/뱅크'가 붙은 표기만 봐요. */
const BANK_RULES: { name: string; re: RegExp }[] = [
  { name: "토스뱅크", re: /토스\s*뱅크/i },
  { name: "카카오뱅크", re: /카카오\s*뱅크/i },
  { name: "케이뱅크", re: /케이\s*뱅크/i },
  { name: "SC제일은행", re: /(SC|에스씨)\s*제일|제일\s*은행/i },
  { name: "신한은행", re: /신한\s*은행|신한\s*SOL|신한\s*쏠편한/i },
  { name: "KB국민은행", re: /KB\s*국민\s*은행|국민\s*은행|KB\s*스타뱅킹/i },
  { name: "하나은행", re: /하나\s*은행|하나원큐/i },
  { name: "우리은행", re: /우리\s*은행|우리\s*WON|위비\s*뱅크/i },
  { name: "IBK기업은행", re: /IBK|기업\s*은행/i },
  { name: "NH농협은행", re: /NH\s*농협\s*은행|농협\s*은행|NH\s*올원/i },
  { name: "수협은행", re: /수협\s*은행/i },
];

/** 은행 앱(패키지·이름)으로 은행 보정 — 푸시 본문에 은행명이 없는 경우가 많아요. */
const BANK_BY_APP: { re: RegExp; name: string }[] = [
  { re: /viva\.republica\.toss|tossbank|토스뱅크/i, name: "토스뱅크" },
  { re: /kakaobank|kakao\.bank/i, name: "카카오뱅크" },
  { re: /kbank|케이뱅크/i, name: "케이뱅크" },
  { re: /scbank|standardchartered|sc제일|제일은행/i, name: "SC제일은행" },
  { re: /shinhanbank|신한은행/i, name: "신한은행" },
  { re: /kbstar|kbbank|국민은행/i, name: "KB국민은행" },
  { re: /hanabank|하나은행/i, name: "하나은행" },
  { re: /wooribank|우리은행/i, name: "우리은행" },
  { re: /ibk|기업은행/i, name: "IBK기업은행" },
  { re: /nhbank|농협은행/i, name: "NH농협은행" },
];

export function detectBank(text: string, app?: string): string | null {
  const t = normalize(text);
  for (const r of BANK_RULES) if (r.re.test(t)) return r.name;
  const a = String(app || "");
  if (a) for (const r of BANK_BY_APP) if (r.re.test(a)) return r.name;
  return null;
}

/** 입금 신호 — '이체'만 있을 때 출금으로 보기 전에 먼저 확인해요. */
const BANK_IN_RE = /(입금|받은\s*돈|받았|들어왔|입금되었|캐시백|환급)/;
/** 출금 신호 */
const BANK_OUT_RE = /(출금|보낸\s*돈|나갔|출금되었|자동\s*이체|이체\s*출금|송금|결제\s*대금|카드\s*대금)/;
/** 방향을 가리키는 낱말이 전혀 없을 때만 쓰는 약한 신호 */
const BANK_TRANSFER_RE = /이체/;
/**
 * '보냈' 은 은행마다 뜻이 반대예요.
 *  · 카카오뱅크 입금 알림: "홍길동님이 10,000원을 보냈어요" → 받은 돈(입금)
 *  · 내가 보낸 알림: "홍길동님에게 10,000원을 보냈어요" / "10,000원을 보냈어요" → 출금
 */
const BANK_SENT_TO_RE = /(님에게|님께|에게)\s*[\d,]*\s*원?\s*(?:을|를)?\s*보냈/;
const BANK_SENT_FROM_RE = /(님이|님께서|께서)\s*[\d,]*\s*원?\s*(?:을|를)?\s*보냈/;
/** 카드 승인 알림은 은행 경로로 보내지 않아요 */
const BANK_CARD_VETO_RE = /(일시불|할부|승인)/;

/** 이중 집계 방지 — 방향과 상관없이 보는 패턴 (본인 계좌 내부이동) */
const BANK_EXCLUDE_RULES: { re: RegExp; reason: string }[] = [
  { re: /비상금/, reason: "비상금 내부이동" },
  {
    re: /내부\s*이체|내\s*계좌|본인\s*계좌|모으기|저금통|세이프박스|채우기|스윕|잔돈\s*모으기/,
    reason: "본인 계좌 간 내부이체",
  },
];
/** 출금일 때만 보는 카드대금 패턴 — 카드 사용 내역과 두 번 세지 않도록 */
const BANK_CARD_BILL_RULES: { re: RegExp; reason: string }[] = [
  { re: /카드\s*대금|카드\s*결제|카드값|결제\s*대금/, reason: "카드대금 출금(카드 사용 내역과 중복)" },
  {
    re: /(신한|현대|롯데|하나|삼성|우리|KB\s*국민|국민|NH\s*농협|농협|BC|비씨)\s*카드/,
    reason: "카드대금 출금(카드 사용 내역과 중복)",
  },
];

/** 알림에 찍힌 '잔액 N원' — 가용한도·출금가능금액은 잔액이 아니에요. */
export function extractBalance(text: string): number | null {
  const t = normalize(text);
  const re = /(잔액|잔여\s*금액|남은\s*잔액)\s*(?:은|는|이|가)?\s*[:：]?\s*([\d,]+)\s*원?/g;
  for (const m of t.matchAll(re)) {
    const at = m.index || 0;
    const before = t.slice(Math.max(0, at - 6), at);
    if (/(가용|가능|최대|한도)/.test(before)) continue;
    const v = Number(m[2].replace(/,/g, ""));
    if (isFinite(v) && v >= 0) return v;
  }
  return null;
}

const BANK_PARTY_STOP = new Set([
  "입금", "출금", "이체", "완료", "잔액", "원", "원화", "KRW", "계좌", "통장", "자동이체", "정상",
  "처리", "님", "귀하", "받는분", "보낸분", "보낸사람", "받는사람", "입금자", "출금자", "거래", "내역",
  "알림", "체크", "카드", "대금", "결제", "송금", "이체완료", "입금완료", "출금완료", "atm",
  "출금가능", "현재", "오늘", "방금", "잔여", "금액", "요청", "정산", "수취", "예금주", "보냄", "받음",
  "받았어요", "보냈어요", "받았습니다", "보냈습니다", "입금되었습니다", "출금되었습니다", "정상처리",
  "처리되었습니다", "완료됨", "받았음", "보냈음",
]);

function isBankWordToken(tok: string): boolean {
  if (/은행$|뱅크$/.test(tok)) return true;
  return BANK_RULES.some((r) => r.name.replace(/\s/g, "") === tok);
}

/** 적요·입금자·사용처만 남겨요. 은행명·금액·잔액·날짜·방향 낱말을 모두 걷어냅니다. */
export function extractBankParty(raw: string): string | null {
  let s = " " + normalize(raw) + " ";

  s = s.replace(/[\[［][^\]］]{1,30}[\]］]/g, " ");
  s = s.replace(/(web|국외|해외)\s*발신/gi, " ");
  s = s.replace(/(잔액|잔여\s*금액|남은\s*잔액)\s*[:：]?\s*-?[\d,]+\s*원?/g, " ");
  s = s.replace(/[-−]?\s*(?:\d{1,3}(?:,\d{3})+|\d+)(?:\.\d+)?\s*(?:원|KRW)/gi, " ");
  s = s.replace(/₩\s*[\d,]+/g, " ");
  s = s.replace(/\[?[\d,]+\]?\s*KRW\b/gi, " ");
  s = s.replace(/\d{4}\s*[.\-\/]\s*\d{1,2}\s*[.\-\/]\s*\d{1,2}/g, " ");
  s = s.replace(/(?<![\d,])\d{1,2}\s*[\/.]\s*\d{1,2}(?![\d])/g, " ");
  s = s.replace(/\d{1,2}\s*월\s*\d{1,2}\s*일/g, " ");
  s = s.replace(/(?<![0-9])\d{1,2}\s*:\s*\d{2}(?![0-9])/g, " ");
  s = s.replace(/(주식회사|\(주\)|㈜)/g, " ");
  s = s.replace(/[()\[\]{}]/g, " ");
  s = s.replace(/[\/|,·•]/g, " ");
  s = s.replace(/\s+/g, " ").trim();

  const tokens: string[] = [];
  for (const tok of s.split(" ")) {
    let t = tok.replace(/[^0-9A-Za-z가-힣*]/g, "");
    t = t.replace(/(님에게|님께서|님이|님께|에게|께서|님)$/, "");
    if (!t) continue;
    if (/^[\d,*]+$/.test(t)) continue;
    if (BANK_PARTY_STOP.has(t)) continue;
    if (isBankWordToken(t)) continue;
    if (/(어요|습니다|니다)$/.test(t)) continue;
    if (t.length === 1) continue; // 조사(을·를·이·가·은·는 …)나 남은 숫자 한 자리는 적요가 아니에요
    tokens.push(t);
  }
  if (!tokens.length) return null;
  return tokens.join(" ").slice(0, 60).trim() || null;
}

export function parseBankAlert(input: {
  body: string;
  title?: string;
  app?: string;
  accountName?: string;
  now?: Date;
  excludePatterns?: string[];
}): ParsedBank {
  const raw = joinText(input.title, input.body).trim();
  const now = input.now || new Date();
  const warnings: string[] = [];
  const text = raw;

  const bank = detectBank(text, input.app);
  const cardVeto = BANK_CARD_VETO_RE.test(text);

  const inM = BANK_IN_RE.exec(text);
  const outM = BANK_OUT_RE.exec(text);
  let direction: "in" | "out" | null = null;
  if (inM && outM) direction = inM.index <= outM.index ? "in" : "out";
  else if (inM) direction = "in";
  else if (outM) direction = "out";
  else if (/보냈/.test(text)) direction = BANK_SENT_TO_RE.test(text) ? "out" : (BANK_SENT_FROM_RE.test(text) ? "in" : "out");
  else if (BANK_TRANSFER_RE.test(text)) direction = "out";

  const { date, fromText } = extractDate(text, now);
  let amount = extractAmount(text).amount;
  if (amount === null) {
    const wonM = text.match(/₩\s*([\d,]+)/) || text.match(/(?<![\d,])([\d,]{4,})\s*원/);
    if (wonM) {
      const v = Number(wonM[1].replace(/,/g, ""));
      if (isFinite(v) && v > 0) amount = Math.round(v);
    }
  }
  const balance = extractBalance(text);
  const party = extractBankParty(text);

  const isBank = !cardVeto && direction !== null && !!(bank || balance !== null || input.accountName);

  if (direction === null) warnings.push("입금/출금 구분을 찾지 못했어요.");
  if (amount === null) warnings.push("거래 금액을 찾지 못했어요.");
  if (balance === null) warnings.push("알림에 잔액이 없어 통장 잔액은 그대로 둬요.");
  if (!bank) warnings.push("은행 이름을 찾지 못했어요. accountName 을 함께 보내 주세요.");

  let excluded = false;
  let excludeReason: string | null = null;
  /* 제외 판단은 적요(사용처) 기준 — 통장 이름에 들어 있는 '비상금' 같은 낱말 때문에
     모든 거래가 제외되지 않도록, 계좌명과 은행명은 걷어내고 비교해요. */
  let excludeSource = party && party.trim() ? party : text.replace(/[\[［][^\]］]{1,30}[\]］]/g, " ");
  if (input.accountName) {
    const full = normalize(input.accountName);
    excludeSource = excludeSource.split(full).join(" ");
    for (const w of full.split(/\s+/)) {
      if (w.length >= 2) excludeSource = excludeSource.split(w).join(" ");
    }
  }
  const rules = BANK_EXCLUDE_RULES.concat(direction === "out" ? BANK_CARD_BILL_RULES : []);
  for (const r of rules) {
    if (r.re.test(excludeSource)) {
      excluded = true;
      excludeReason = r.reason;
      break;
    }
  }
  if (!excluded) {
    for (const p of input.excludePatterns || []) {
      const pat = String(p || "").trim();
      if (!pat) continue;
      try {
        if (new RegExp(pat, "i").test(excludeSource)) {
          excluded = true;
          excludeReason = "직접 지정한 제외 문구(" + pat + ")";
          break;
        }
      } catch (_) {
        warnings.push("제외 문구 \"" + pat + "\" 는 정규식으로 읽지 못해 건너뛰었어요.");
      }
    }
  }

  return {
    isBank,
    bank,
    accountName: input.accountName ? normalize(input.accountName) : null,
    direction,
    amount,
    balance,
    party,
    date,
    dateFromText: fromText,
    excluded,
    excludeReason,
    warnings,
    raw,
  };
}

/* ────────────────────── 9. 한 건 파싱 ────────────────────── */

const CANCEL_RE = /(취소|승인\s*취소|결제\s*취소|매입\s*취소|취소\s*완료|취소\s*처리)/;
/** 승인 건이 아니라 '청구·한도·발급' 안내인 알림 — 금액이 있어도 저장하면 안 돼요 */
const BILLING_NOTICE_RE =
  /(결제\s*예정\s*금액|결제\s*예정|청구\s*금액|이용\s*대금|명세서|결제일\s*안내|한도\s*안내|한도\s*조회|카드\s*발급|발급\s*완료|비밀번호|인증\s*번호|승인\s*내역\s*조회|이벤트|당첨)/;
/** 승인 건이라는 신호 — 은행 입출금·인증번호를 카드 결제로 오인하지 않게 */
const APPROVAL_HINT_RE = /(승인|일시불|할부|자동\s*납부|자동\s*결제|정기\s*승인|후불\s*교통|취소)/;
const POINT_RE = /(포인트|P\b|마일리지|적립)/;

export function parseAlert(input: {
  body: string;
  title?: string;
  app?: string;
  cardHint?: string;
  now?: Date;
  categories?: { key: string; label?: string }[] | null;
}): Parsed {
  const raw = joinText(input.title, input.body).trim();
  const warnings: string[] = [];
  const now = input.now || new Date();

  const text = raw;
  const card = extractCard(text, input.app);
  // cardHint 는 '신한 공용', '현대 the Green', '롯데 1234' 처럼 카드사·카드명·끝4자를 보정해요.
  if (input.cardHint) {
    const hint = normalize(input.cardHint);
    const hintedIssuer = detectIssuer(hint);
    if (hintedIssuer && !card.issuer) card.issuer = hintedIssuer;
    const l4 = hint.match(/(?<![0-9])(\d{4})(?![0-9])/);
    if (l4 && !card.last4) card.last4 = l4[1];
    if (!card.name) {
      for (const cn of CARD_NAMES) {
        if (hint.toLowerCase().indexOf(cn.toLowerCase()) >= 0) {
          card.name = cn;
          break;
        }
      }
    }
  }

  const isCancel = CANCEL_RE.test(text);
  const { amount, foreign } = extractAmount(text);
  const { date, fromText } = extractDate(text, now);
  const merchant = extractMerchant(text);
  const installmentM = text.match(/할부\s*(\d{1,2})\s*개월/);

  const looksCard = !!(
    (amount !== null || foreign !== null) &&
    // 승인 신호가 있어야 카드 결제 (은행 입출금·인증번호·청구 안내는 제외)
    (APPROVAL_HINT_RE.test(text) || /(카드|체크)/.test(text)) &&
    !(BILLING_NOTICE_RE.test(text) && !/(승인|일시불|할부)/.test(text))
  );

  let kind: Parsed["kind"] = "unknown";
  if (!looksCard) kind = "unknown";
  else if (isCancel) kind = "cancel";
  else if (amount === null && foreign !== null) kind = "foreign";
  else if (amount === null && POINT_RE.test(text)) kind = "point";
  else if (amount !== null) kind = "approval";

  if (!merchant) warnings.push("가맹점명을 찾지 못했어요. 직접 고쳐 주세요.");
  if (!amount && !foreign) warnings.push("금액을 찾지 못했어요.");
  if (!fromText) warnings.push("알림에 날짜가 없어 오늘 날짜로 기록했어요.");
  if (isCancel) warnings.push("결제 취소 알림이에요. 마이너스 금액으로 기록해 승인 내역과 상쇄해요.");
  if (foreign && !amount) warnings.push("해외 결제라 원화 금액을 알 수 없어요. amountKrw 를 함께 보내 주세요.");
  if (installmentM) warnings.push(installmentM[1] + "개월 할부 결제예요.");

  const categoryKey = kind === "approval" ? guessCategory(merchant, input.categories ?? null) : null;

  return {
    isCard: looksCard,
    kind,
    amount,
    foreign,
    merchant,
    date,
    dateFromText: fromText,
    installments: installmentM ? Number(installmentM[1]) : null,
    card,
    categoryKey,
    warnings,
    raw,
  };
}

/* ────────────────────── 10. Supabase REST ────────────────────── */

type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

function restHeaders(key: string, extra?: Record<string, string>): Record<string, string> {
  return Object.assign(
    {
      "apikey": key,
      "Authorization": "Bearer " + key,
      "Content-Type": "application/json",
      "Accept": "application/json",
    },
    extra || {},
  );
}

async function restGet(
  base: string,
  key: string,
  path: string,
  fetchImpl: FetchLike,
): Promise<{ ok: boolean; status: number; data: unknown; error: string | null }> {
  try {
    const res = await fetchImpl(base + "/rest/v1/" + path, { method: "GET", headers: restHeaders(key) });
    const txt = await res.text();
    let data: unknown = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch (_) {
      data = txt;
    }
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok ? null : (typeof data === "object" && data && "message" in (data as Record<string, unknown>))
        ? String((data as Record<string, unknown>).message)
        : txt.slice(0, 300),
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String((e as Error)?.message || e) };
  }
}

async function restInsert(
  base: string,
  key: string,
  table: string,
  row: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<{ ok: boolean; status: number; data: unknown; error: string | null }> {
  try {
    const res = await fetchImpl(base + "/rest/v1/" + table, {
      method: "POST",
      headers: restHeaders(key, { Prefer: "return=representation" }),
      body: JSON.stringify(row),
    });
    const txt = await res.text();
    let data: unknown = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch (_) {
      data = txt;
    }
    const errObj = data as Record<string, unknown> | null;
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok
        ? null
        : errObj && typeof errObj === "object" && ("message" in errObj || "details" in errObj)
        ? String(errObj.message || errObj.details)
        : txt.slice(0, 300),
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String((e as Error)?.message || e) };
  }
}

async function restPatch(
  base: string,
  key: string,
  path: string,
  patch: Record<string, unknown>,
  fetchImpl: FetchLike,
): Promise<{ ok: boolean; status: number; data: unknown; error: string | null }> {
  try {
    const res = await fetchImpl(base + "/rest/v1/" + path, {
      method: "PATCH",
      headers: restHeaders(key, { Prefer: "return=representation" }),
      body: JSON.stringify(patch),
    });
    const txt = await res.text();
    let data: unknown = null;
    try {
      data = txt ? JSON.parse(txt) : null;
    } catch (_) {
      data = txt;
    }
    const errObj = data as Record<string, unknown> | null;
    return {
      ok: res.ok,
      status: res.status,
      data,
      error: res.ok
        ? null
        : errObj && typeof errObj === "object" && ("message" in errObj || "details" in errObj)
        ? String(errObj.message || errObj.details)
        : txt.slice(0, 300),
    };
  } catch (e) {
    return { ok: false, status: 0, data: null, error: String((e as Error)?.message || e) };
  }
}

/* ────────────────────── 11. 중복 판단 ────────────────────── */
function squash(s: string): string {
  return normalize(s).toLowerCase().replace(/[\s()\[\]{}·.,\/\-_+]/g, "");
}

/** 같은 날·같은 금액·비슷한 가맹점이 최근 5분 안에 있으면 중복 */
export function isDuplicate(
  rows: { id?: string; title?: string; amount?: number; tx_date?: string; updated_at?: string }[],
  candidate: { title: string; amount: number; date: string },
  now: Date = new Date(),
): { duplicate: boolean; row: Record<string, unknown> | null } {
  const cutoff = now.getTime() - DEDUPE_WINDOW_MS;
  const want = squash(candidate.title);
  for (const r of rows || []) {
    if (!r) continue;
    if (String(r.tx_date || "").slice(0, 10) !== candidate.date) continue;
    if (Number(r.amount) !== candidate.amount) continue;
    const when = r.updated_at ? Date.parse(String(r.updated_at)) : NaN;
    if (isFinite(when) && when < cutoff) continue;
    const got = squash(String(r.title || ""));
    if (got === want || (want && got && (got.indexOf(want) >= 0 || want.indexOf(got) >= 0))) {
      return { duplicate: true, row: r as Record<string, unknown> };
    }
  }
  return { duplicate: false, row: null };
}

/* ────────────────────── 12. 요청 처리 ────────────────────── */

export type Deps = {
  env?: (key: string) => string | undefined;
  fetchImpl?: FetchLike;
  now?: Date;
};

function safeEqual(a: string, b: string): boolean {
  const x = String(a);
  const y = String(b);
  if (x.length !== y.length) return false;
  let diff = 0;
  for (let i = 0; i < x.length; i++) diff |= x.charCodeAt(i) ^ y.charCodeAt(i);
  return diff === 0;
}

export const SERVICE = "ingest-card-msg";
export const VERSION = "1.3.0";

export async function handle(req: Request, deps: Deps = {}): Promise<Response> {
  const env = deps.env || ((k: string) => Deno.env.get(k));
  const fetchImpl: FetchLike = deps.fetchImpl || ((input, init) => fetch(input, init));
  const now = deps.now || new Date();

  const reply = (body: unknown, status = 200): Response =>
    new Response(JSON.stringify(body), {
      status,
      headers: Object.assign(
        { "Content-Type": "application/json; charset=utf-8", "Cache-Control": "no-store" },
        CORS,
      ),
    });

  if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: CORS });

  const needToken = (env("CARD_INGEST_TOKEN") || "").trim();

  // 살아 있는지 확인용 (MacroDroid '연결 테스트'). 토큰·데이터는 노출하지 않아요.
  if (req.method === "GET") {
    return reply({
      ok: true,
      service: SERVICE,
      version: VERSION,
      tokenConfigured: !!needToken,
      usage: "POST { token, body, sourceType?, accountName?, who?, cardHint?, dryRun? }",
    });
  }
  if (req.method !== "POST") return reply({ ok: false, action: "error", error: "POST 로 호출해 주세요" }, 405);

  let payload: Record<string, unknown> = {};
  try {
    const raw = await req.text();
    payload = raw ? JSON.parse(raw) : {};
  } catch (_) {
    return reply({ ok: false, action: "error", error: "JSON 본문을 읽지 못했어요" }, 400);
  }

  /* ── 토큰 확인 ── */
  const headerToken = req.headers.get("x-ingest-token") || "";
  const givenToken = String(payload.token || headerToken || "").trim();
  if (!needToken) {
    return reply({
      ok: false,
      action: "error",
      needSecret: true,
      error: "서버에 CARD_INGEST_TOKEN 시크릿이 없어요. 아무것도 저장하지 않았어요.",
      hint: "Supabase 대시보드 → Edge Functions → Secrets 에서 CARD_INGEST_TOKEN 을 정하고, " +
        "MacroDroid 본문의 \"token\" 값과 똑같이 맞춰 주세요.",
    }, 503);
  }
  if (!givenToken || !safeEqual(givenToken, needToken)) {
    return reply({
      ok: false,
      action: "error",
      error: "토큰이 맞지 않아요.",
      hint: "요청 본문의 token 값(또는 x-ingest-token 헤더)을 CARD_INGEST_TOKEN 과 똑같이 넣어 주세요.",
    }, 401);
  }

  /* ── 입력 ── */
  const bodyText = String(payload.body ?? payload.message ?? payload.text ?? payload.msg ?? "").trim();
  const title = payload.title ? String(payload.title).trim() : undefined;
  if (!bodyText && !title) {
    return reply({ ok: false, action: "error", error: "body(알림 본문)가 비어 있어요" }, 400);
  }
  if ((bodyText + (title || "")).length > MAX_BODY_LEN) {
    return reply({ ok: false, action: "error", error: "본문이 너무 길어요(2,000자 이하)" }, 400);
  }

  const dryRun = payload.dryRun === true || String(payload.dryRun) === "true" || String(payload.dryRun) === "1";
  const who = payload.who ? String(payload.who).trim() : "";
  const cardHint = payload.cardHint ? String(payload.cardHint).trim() : "";
  const categoryOverride = payload.categoryKey ? String(payload.categoryKey).trim() : "";
  const expectLast4 = payload.expectLast4 ? String(payload.expectLast4).replace(/\D/g, "").slice(-4) : "";
  const expectText = payload.expectText ? String(payload.expectText).trim() : "";
  const payMethod = payload.payMethod ? String(payload.payMethod).trim() : DEFAULT_PAY_METHOD;
  const expenseAccountHint = payload.expenseAccountName ? String(payload.expenseAccountName).trim() : "";
  const linkCardBalance = !(
    payload.linkBalance === false ||
    String(payload.linkBalance) === "false" ||
    String(payload.linkBalance) === "0"
  );
  const amountOverride = Number(payload.amountKrw);
  const app = payload.app ? String(payload.app).trim() : undefined;
  const sourceTypeRaw = String(payload.sourceType || "auto").trim().toLowerCase();
  const sourceType = sourceTypeRaw === "bank" || sourceTypeRaw === "card" ? sourceTypeRaw : "auto";
  const accountName = payload.accountName ? normalize(String(payload.accountName)).trim() : "";
  const excludePatterns: string[] = Array.isArray(payload.excludePatterns)
    ? (payload.excludePatterns as unknown[]).map((v) => String(v))
    : (payload.excludePatterns ? [String(payload.excludePatterns)] : []);

  /* ── 환경 ── */
  const supabaseUrl = (env("SUPABASE_URL") || "").replace(/\/+$/, "");
  const serviceKey = env("SUPABASE_SERVICE_ROLE_KEY") || "";
  if (!supabaseUrl || !serviceKey) {
    return reply({
      ok: false,
      action: "error",
      error: "SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY 가 없어 DB에 연결하지 못했어요.",
      hint: "Supabase Edge Functions 는 이 두 값을 자동으로 넣어 줍니다. 직접 실행 중이라면 환경변수를 확인해 주세요.",
    }, 500);
  }

  /* ── 가계부·카테고리 ── */
  const hhIdParam = payload.householdId ? String(payload.householdId).trim() : "";
  let householdId = hhIdParam;
  if (!householdId) {
    const hh = await restGet(supabaseUrl, serviceKey, "households?select=id,name&order=created_at.asc&limit=1", fetchImpl);
    if (!hh.ok) {
      return reply({ ok: false, action: "error", error: "가계부를 불러오지 못했어요", detail: hh.error }, 502);
    }
    const rows = Array.isArray(hh.data) ? hh.data as Record<string, unknown>[] : [];
    if (!rows.length) {
      return reply({ ok: false, action: "error", error: "가계부(households)가 하나도 없어요", hint: "가계부 앱에 먼저 로그인해 초기 세팅을 해 주세요." }, 409);
    }
    householdId = String(rows[0].id);
  }

  const catRes = await restGet(
    supabaseUrl,
    serviceKey,
    "categories?select=key,label&household_id=eq." + encodeURIComponent(householdId) + "&order=sort_order.asc",
    fetchImpl,
  );
  const categories = Array.isArray(catRes.data)
    ? (catRes.data as Record<string, unknown>[]).map((c) => ({ key: String(c.key), label: c.label ? String(c.label) : "" }))
    : null;

  /* ── 파싱 ── */
  const parsed = parseAlert({
    body: bodyText,
    title,
    app,
    cardHint,
    now,
    categories,
  });
  if (amountOverride > 0) {
    parsed.amount = Math.round(amountOverride);
    if (parsed.kind === "foreign" || parsed.kind === "unknown") parsed.kind = "approval";
    parsed.warnings = parsed.warnings.filter((w) => w.indexOf("원화 금액") < 0);
  }
  if (parsed.categoryKey) parsed.categoryKey = guessCategory(parsed.merchant, categories) || parsed.categoryKey;
  // 카테고리 직접 지정(예: 현대 공용 카드는 'util') — 가계부에 실제로 있는 key 일 때만 써요.
  if (categoryOverride && (!categories || categories.some((c) => c.key === categoryOverride))) {
    parsed.categoryKey = categoryOverride;
  }

  /* ══════════ 은행 입출금 경로 (v1.2.0) ══════════ */
  const bankParsed = parseBankAlert({
    body: bodyText,
    title,
    app,
    accountName,
    now,
    excludePatterns,
  });
  if (sourceType === "bank" || (sourceType === "auto" && bankParsed.isBank)) {
    const won = (n: number) => Math.abs(Math.round(n)).toLocaleString("ko-KR") + "원";
    const bankBase = { ok: true, service: SERVICE, sourceType: "bank", householdId, bank: bankParsed };

    if (!bankParsed.isBank) {
      return reply(Object.assign({}, bankBase, {
        ok: false,
        action: "ignored",
        error: "은행 입출금 알림으로 보이지 않았어요.",
        hint: "sourceType=bank 로 보낼 때는 본문에 입금·출금 같은 방향 문구가 있어야 해요.",
      }), 200);
    }

    // 계좌별 리스너에서 다른 통장 알림을 가려내고 싶을 때 (카드의 expectText 와 같은 역할)
    if (expectText && normalize(bankParsed.raw).toLowerCase().indexOf(normalize(expectText).toLowerCase()) < 0) {
      return reply(Object.assign({}, bankBase, {
        ok: false,
        action: "skipped_expect_text",
        error: "알림에 \"" + expectText + "\" 가 없어서 저장하지 않았어요",
        hint: "계좌별 리스너라면 expectText(예: \"생활비\")를 알림에 실제로 나오는 문구로 바꿔 주세요.",
      }), 200);
    }

    const bankAmount = amountOverride > 0 ? Math.round(amountOverride) : bankParsed.amount;
    if (!bankAmount) {
      return reply(Object.assign({}, bankBase, {
        ok: false,
        action: "need_amount",
        error: "통장 알림에서 금액을 찾지 못했어요.",
        hint: "amountKrw 에 거래 금액을 함께 보내 주세요. (예: \"amountKrw\": 12300)",
      }), 200);
    }

    const isIncome = bankParsed.direction === "in";
    const ym = bankParsed.date.slice(0, 7);
    const payForBank = payload.payMethod
      ? String(payload.payMethod).trim()
      : (accountName || (bankParsed.bank ? bankParsed.bank + " 통장" : "은행 통장"));
    const bankTitle = String(
      bankParsed.party ||
        ((bankParsed.bank ? bankParsed.bank + " " : "통장 ") + (isIncome ? "입금" : "출금")),
    ).slice(0, MAX_TITLE_LEN);
    let bankCat: string | null = null;
    if (!isIncome && !bankParsed.excluded) {
      bankCat = guessCategory(bankParsed.party, categories);
      if (categoryOverride && (!categories || categories.some((c) => c.key === categoryOverride))) bankCat = categoryOverride;
    }

    /* 잔액 반영 대상 찾기 — 같은 household·같은 달의 현금(cash) 행에서 이름으로 찾아요. */
    type BalPlan = {
      matched: boolean;
      reason: string | null;
      id?: string;
      name?: string;
      ym?: string;
      before?: number;
      after?: number;
      applied?: boolean;
      candidates?: string[];
    };
    const balanceNow = bankParsed.balance;

    async function planBankBalance(): Promise<BalPlan> {
      if (balanceNow === null) return { matched: false, reason: "no_balance_in_text" };
      const q = "asset_snapshots?select=id,name,amount,ym,kind&household_id=eq." +
        encodeURIComponent(householdId) + "&kind=eq.cash&ym=eq." + ym + "&order=name.asc";
      const res = await restGet(supabaseUrl, serviceKey, q, fetchImpl);
      if (!res.ok) return { matched: false, reason: "snapshot_query_failed" };
      const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
      if (!rows.length) return { matched: false, reason: "no_snapshot_for_ym" };
      const nn = (v: unknown) => normalize(String(v ?? "")).replace(/\s+/g, "").toLowerCase();
      const allNames = rows.map((r) => String(r.name ?? ""));
      let picks: Record<string, unknown>[] = [];
      if (accountName) {
        picks = rows.filter((r) => nn(r.name) === nn(accountName));
        if (!picks.length) {
          picks = rows.filter((r) => {
            const n = nn(r.name);
            const a = nn(accountName);
            return n.indexOf(a) >= 0 || a.indexOf(n) >= 0;
          });
        }
      }
      if (!picks.length) {
        // 알림 본문·제목에 계좌 이름이 그대로 들어 있는 경우
        picks = rows.filter((r) => {
          const n = nn(r.name);
          return n.length >= 3 && nn(bankParsed.raw).indexOf(n) >= 0;
        });
      }
      if (!picks.length && bankParsed.bank) {
        const b = nn(bankParsed.bank).replace(/(은행|뱅크)$/, "");
        if (b.length >= 2) picks = rows.filter((r) => nn(r.name).indexOf(b) >= 0);
      }
      if (picks.length > 1) {
        return { matched: false, reason: "ambiguous_account", candidates: picks.map((r) => String(r.name ?? "")) };
      }
      if (!picks.length) return { matched: false, reason: "no_matching_account", candidates: allNames };
      const row = picks[0];
      return {
        matched: true,
        reason: null,
        id: String(row.id),
        name: String(row.name ?? ""),
        ym: String(row.ym ?? ym),
        before: Number(row.amount) || 0,
        after: balanceNow,
      };
    }

    /* 중복 확인 — 같은 날·같은 금액·같은 적요가 5분 안에 또 오면 스킵 */
    const dupQBank = "transactions?select=id,title,amount,tx_date,updated_at,kind" +
      "&household_id=eq." + encodeURIComponent(householdId) +
      "&tx_date=eq." + bankParsed.date +
      "&amount=eq." + Math.abs(bankAmount) +
      "&updated_at=gte." + encodeURIComponent(new Date(now.getTime() - DEDUPE_WINDOW_MS).toISOString()) +
      "&order=updated_at.desc&limit=10";
    const dupResBank = await restGet(supabaseUrl, serviceKey, dupQBank, fetchImpl);
    const dupRowsBank = dupResBank.ok && Array.isArray(dupResBank.data)
      ? (dupResBank.data as Record<string, unknown>[])
      : [];
    const dupBank = isDuplicate(dupRowsBank, { title: bankTitle, amount: Math.abs(bankAmount), date: bankParsed.date }, now);
    if (dupBank.duplicate) {
      return reply(Object.assign({}, bankBase, {
        action: "duplicate",
        saved: null,
        duplicateOf: dupBank.row,
        balanceUpdate: { matched: false, reason: "duplicate" },
        message: "같은 통장 " + (isIncome ? "입금" : "출금") + "이 이미 기록돼 있어 건너뛰었어요 · " +
          bankTitle + " " + won(bankAmount),
      }), 200);
    }

    const balPlan = await planBankBalance();

    /* created_by (누가 기록했는지) */
    let createdByBank: string | null = null;
    if (who) {
      const m = await restGet(
        supabaseUrl,
        serviceKey,
        "household_members?select=user_id,label&household_id=eq." + encodeURIComponent(householdId) +
          "&label=eq." + encodeURIComponent(who) + "&limit=1",
        fetchImpl,
      );
      if (m.ok && Array.isArray(m.data) && m.data.length) {
        createdByBank = String((m.data as Record<string, unknown>[])[0].user_id);
      }
    }

    const bankRow = {
      household_id: householdId,
      ym,
      tx_date: bankParsed.date,
      kind: isIncome ? "income" : EXPENSE_KIND,
      category_key: bankCat,
      title: bankTitle,
      amount: Math.abs(bankAmount),
      pay_method: payForBank,
      is_excluded: bankParsed.excluded,
      created_by: createdByBank,
      updated_at: new Date(now.getTime()).toISOString(),
    };

    if (dryRun) {
      return reply(Object.assign({}, bankBase, {
        action: "dry_run",
        wouldSave: bankRow,
        balanceUpdate: balPlan,
        message: "(미리보기) " + (isIncome ? "입금" : "출금") + " · " + bankTitle + " " + won(bankAmount) +
          " → " + (isIncome ? "수입" : (bankCat || "카테고리 없음")) +
          (bankParsed.excluded ? " · 제외(" + (bankParsed.excludeReason || "중복 집계 방지") + ")" : "") +
          (balPlan.matched ? " · 잔액 " + won(Number(balPlan.after)) + " 반영 예정" : ""),
      }), 200);
    }

    const insBank = await restInsert(supabaseUrl, serviceKey, "transactions", bankRow, fetchImpl);
    if (!insBank.ok) {
      return reply(Object.assign({}, bankBase, {
        ok: false,
        action: "error",
        error: "가계부에 통장 내역을 저장하지 못했어요",
        detail: insBank.error,
        hint: insBank.status === 401 || insBank.status === 403
          ? "SUPABASE_SERVICE_ROLE_KEY 가 service_role 키인지 확인해 주세요."
          : "잠시 뒤 다시 시도해 주세요.",
      }), 502);
    }
    const savedBankRow = Array.isArray(insBank.data) ? (insBank.data as Record<string, unknown>[])[0] : null;

    /* 잔액 반영 — 실패해도 거래 저장은 그대로 두고 응답에만 알려요. */
    if (balPlan.matched && balPlan.id) {
      const patched = await restPatch(
        supabaseUrl,
        serviceKey,
        "asset_snapshots?id=eq." + encodeURIComponent(balPlan.id),
        { amount: Number(balPlan.after) },
        fetchImpl,
      );
      balPlan.applied = patched.ok;
      if (!patched.ok) {
        balPlan.reason = "patch_failed";
        bankParsed.warnings.push("통장 잔액을 반영하지 못했어요: " + (patched.error || "DB 오류"));
      }
    }

    const msgParts = [
      "통장 " + (isIncome ? "입금" : "출금") + " 기록 · " + bankTitle + " " + won(bankAmount) +
      " (" + bankParsed.date.slice(5).replace("-", ".") + ")",
    ];
    if (bankParsed.excluded) msgParts.push("제외 표시(" + (bankParsed.excludeReason || "중복 집계 방지") + ")");
    else if (!isIncome && bankCat) msgParts.push("→ " + bankCat);
    if (balPlan.matched) msgParts.push("잔액 " + won(Number(balPlan.after)) + (balPlan.applied ? " 반영" : " 반영 실패"));
    else if (balPlan.reason === "no_snapshot_for_ym") msgParts.push(ym + " 자산 기록이 없어 잔액은 그대로 둠");

    return reply(Object.assign({}, bankBase, {
      action: bankParsed.excluded ? "inserted_excluded" : (isIncome ? "inserted_income" : "inserted_expense"),
      saved: savedBankRow
        ? {
          id: savedBankRow.id,
          tx_date: savedBankRow.tx_date,
          ym: savedBankRow.ym,
          title: savedBankRow.title,
          amount: Number(savedBankRow.amount),
          kind: savedBankRow.kind,
          category_key: savedBankRow.category_key,
          pay_method: savedBankRow.pay_method,
          is_excluded: savedBankRow.is_excluded,
          created_by: savedBankRow.created_by,
        }
        : bankRow,
      balanceUpdate: balPlan,
      message: msgParts.join(" · "),
    }), 200);
  }

  const base = { ok: true, service: SERVICE, parsed, householdId };
  const cardInfo = parsed.card;

  // 카드 끝 4자리·문구로 걸러 달라는 요청이 있으면 불일치 시 저장하지 않아요(공용/용돈 카드 분리용).
  if (expectText && normalize(parsed.raw).toLowerCase().indexOf(normalize(expectText).toLowerCase()) < 0) {
    return reply(Object.assign({}, base, {
      ok: false,
      action: "skipped_expect_text",
      error: "알림에 \"" + expectText + "\" 가 없어서 저장하지 않았어요",
      hint: "MacroDroid 의 조건(알림 문구 포함)이나 expectText 값을 확인해 주세요.",
    }), 200);
  }
  if (expectLast4 && parsed.card.last4 && parsed.card.last4 !== expectLast4) {
    return reply(Object.assign({}, base, {
      ok: false,
      action: "skipped_card_mismatch",
      error: "카드 끝자리가 " + parsed.card.last4 + " 라서 저장하지 않았어요 (기대: " + expectLast4 + ")",
      hint: "MacroDroid 의 카드 필터를 확인하거나 expectLast4 값을 바꿔 주세요.",
    }), 200);
  }

  if (!parsed.isCard) {
    return reply(Object.assign({}, base, {
      action: "ignored",
      message: "카드 승인·은행 입출금 알림으로 보이지 않아 저장하지 않았어요.",
    }), 200);
  }

  if (parsed.kind === "point") {
    return reply(Object.assign({}, base, {
      action: "ignored",
      message: "포인트 사용 알림이라 저장하지 않았어요.",
    }), 200);
  }

  /* ── 취소 알림은 승인 내역과 상쇄되도록 마이너스 금액으로 기록 ── */
  const isCancel = parsed.kind === "cancel";
  const money = (n: number) => (n < 0 ? "-" : "") + Math.abs(n).toLocaleString("ko-KR") + "원";

  if (!parsed.amount) {
    return reply(Object.assign({}, base, {
      ok: false,
      action: "need_amount",
      error: isCancel
        ? (parsed.foreign
          ? "취소 알림이지만 해외 결제(" + parsed.foreign.currency + " " + parsed.foreign.value + ")라 원화 금액을 알 수 없어요."
          : "취소 알림이지만 금액을 찾지 못해 기록하지 않았어요.")
        : (parsed.foreign
          ? "해외 결제(" + parsed.foreign.currency + " " + parsed.foreign.value + ")라 원화 금액을 알 수 없어요."
          : "금액을 찾지 못했어요."),
      hint: "amountKrw 에 원화 금액을 함께 보내 주세요. (예: \"amountKrw\": 3900)",
    }), 200);
  }

  // 취소는 -금액. 부호가 달라 승인 72,490원과 취소 -72,490원이 서로 다른 건으로 남아 상쇄돼요.
  const amountForSave = isCancel ? -Math.abs(parsed.amount) : parsed.amount;

  /* ── 취소 원거래 (14일 안 같은 금액의 승인 기록) — 안내용, 못 찾아도 저장은 계속 ── */
  let cancelMatch: Record<string, unknown> | null = null;
  if (isCancel) {
    const q = "transactions?select=id,title,amount,tx_date,category_key&household_id=eq." +
      encodeURIComponent(householdId) + "&amount=eq." + Math.abs(parsed.amount) +
      "&tx_date=gte." + shiftDate(parsed.date, -14) + "&tx_date=lte." + shiftDate(parsed.date, 1) +
      "&order=tx_date.desc&limit=1";
    const found = await restGet(supabaseUrl, serviceKey, q, fetchImpl);
    if (found.ok && Array.isArray(found.data) && found.data.length) {
      cancelMatch = (found.data as Record<string, unknown>[])[0];
    } else {
      parsed.warnings.push("최근 14일 안에 같은 금액의 승인 기록이 없어요. 취소 금액만 마이너스로 남을 수 있으니 앱에서 확인해 주세요.");
    }
  }

  /* ── 취소도 원 결제와 같은 카테고리로 넣어야 카테고리 합계가 상쇄돼요 ── */
  if (isCancel && !parsed.categoryKey) {
    parsed.categoryKey = guessCategory(parsed.merchant, categories);
  }

  /* ── 중복 확인 (취소는 음수 금액 기준으로 승인과 똑같이) ── */
  const baseTitle = parsed.merchant || (cardInfo.issuer ? cardInfo.issuer + " 카드결제" : "카드 결제");
  const title2 = (isCancel ? "[취소] " + baseTitle.slice(0, MAX_TITLE_LEN - 5) : baseTitle)
    .slice(0, MAX_TITLE_LEN);
  const dupQ = "transactions?select=id,title,amount,tx_date,updated_at,category_key" +
    "&household_id=eq." + encodeURIComponent(householdId) +
    "&tx_date=eq." + parsed.date +
    "&amount=eq." + amountForSave +
    "&updated_at=gte." + encodeURIComponent(new Date(now.getTime() - DEDUPE_WINDOW_MS).toISOString()) +
    "&order=updated_at.desc&limit=10";
  const dupRes = await restGet(supabaseUrl, serviceKey, dupQ, fetchImpl);
  const dupRows = dupRes.ok && Array.isArray(dupRes.data) ? dupRes.data as Record<string, unknown>[] : [];
  const dup = isDuplicate(dupRows, { title: title2, amount: amountForSave, date: parsed.date }, now);
  if (dup.duplicate) {
    return reply(Object.assign({}, base, {
      action: "duplicate",
      saved: null,
      duplicateOf: dup.row,
      message: "같은 " + (isCancel ? "취소" : "결제") + "가 이미 기록돼 있어 건너뛰었어요 · " + title2 + " " +
        money(amountForSave),
    }), 200);
  }

  /* ── created_by (누구 카드인지) ── */
  let createdBy: string | null = null;
  if (who) {
    const m = await restGet(
      supabaseUrl,
      serviceKey,
      "household_members?select=user_id,label&household_id=eq." + encodeURIComponent(householdId) +
        "&label=eq." + encodeURIComponent(who) + "&limit=1",
      fetchImpl,
    );
    if (m.ok && Array.isArray(m.data) && m.data.length) {
      createdBy = String((m.data as Record<string, unknown>[])[0].user_id);
    }
  }

  /* ── 카드 결제의 출금 통장 (v1.3.0) ──
     기본은 '생활비 통장'에서 나간 것으로 기록해요. 이번 달(same ym) 현금 스냅샷 중
     생활비/LOVE BANK 가 들어간 행이 한 개로 특정되면 그 행의 잔액도 결제 금액만큼 줄여요.
     은행 입출금 알림은 위 은행 경로에서 끝나기 때문에 여기서 또 빼지 않아요(이중 차감 없음). */
  type CardBalPlan = {
    matched: boolean;
    reason: string | null;
    id?: string;
    name?: string;
    ym?: string;
    before?: number;
    after?: number;
    applied?: boolean;
  };
  const cardYm = parsed.date.slice(0, 7);
  async function planCardAccount(): Promise<{ plan: CardBalPlan; name: string }> {
    if (!linkCardBalance) return { plan: { matched: false, reason: "link_disabled" }, name: "" };
    const q = "asset_snapshots?select=id,name,amount,ym,kind&household_id=eq." +
      encodeURIComponent(householdId) + "&kind=eq.cash&ym=eq." + encodeURIComponent(cardYm) + "&order=name.asc";
    const res = await restGet(supabaseUrl, serviceKey, q, fetchImpl);
    if (!res.ok) return { plan: { matched: false, reason: "snapshot_query_failed" }, name: "" };
    const rows = Array.isArray(res.data) ? (res.data as Record<string, unknown>[]) : [];
    if (!rows.length) return { plan: { matched: false, reason: "no_snapshot_for_ym" }, name: "" };
    const nn = (v: unknown) => normalize(String(v ?? "")).replace(/\s+/g, "").toLowerCase();
    let picks: Record<string, unknown>[] = [];
    if (expenseAccountHint) picks = rows.filter((r) => nn(r.name) === nn(expenseAccountHint));
    if (!picks.length) picks = rows.filter((r) => isLivingAccountName(String(r.name ?? "")));
    if (!picks.length) return { plan: { matched: false, reason: "no_living_account" }, name: "" };
    const names = Array.from(new Set(picks.map((r) => String(r.name ?? ""))));
    if (names.length > 1) {
      return { plan: { matched: false, reason: "ambiguous_account" }, name: "" };
    }
    const hit = picks[0];
    const before = Number(hit.amount) || 0;
    return {
      name: String(hit.name ?? ""),
      plan: {
        matched: true,
        reason: null,
        id: String(hit.id ?? ""),
        name: String(hit.name ?? ""),
        ym: String(hit.ym ?? cardYm),
        before,
        after: before - amountForSave,   // 승인은 -금액, 취소(-금액)는 +금액으로 되돌아요
        applied: false,
      },
    };
  }
  const cardAcct = await planCardAccount();

  /* ── 저장 ── */
  const row = {
    household_id: householdId,
    ym: parsed.date.slice(0, 7),
    tx_date: parsed.date,
    kind: EXPENSE_KIND,
    category_key: parsed.categoryKey,
    title: title2,
    amount: amountForSave,
    pay_method: cardAcct.plan.matched
      ? encodeExpensePay(payMethod, String(cardAcct.plan.name), true)
      : payMethod,
    is_excluded: false,
    created_by: createdBy,
    updated_at: new Date(now.getTime()).toISOString(),
  };

  if (dryRun) {
    return reply(Object.assign({}, base, {
      action: "dry_run",
      wouldSave: row,
      expenseAccount: cardAcct.plan,
      message: "(미리보기) " + parsed.date + " · " + title2 + " " + money(amountForSave) + " → " +
        (parsed.categoryKey || "카테고리 없음") +
        (cardAcct.plan.matched ? " · " + cardAcct.plan.name + " 잔액 " + money(Number(cardAcct.plan.after)) + " 반영 예정" : ""),
    }), 200);
  }

  const ins = await restInsert(supabaseUrl, serviceKey, "transactions", row, fetchImpl);
  if (!ins.ok) {
    return reply(Object.assign({}, base, {
      ok: false,
      action: "error",
      error: "가계부에 저장하지 못했어요",
      detail: ins.error,
      hint: ins.status === 401 || ins.status === 403
        ? "SUPABASE_SERVICE_ROLE_KEY 가 service_role 키인지 확인해 주세요."
        : "잠시 뒤 다시 시도해 주세요.",
    }), 502);
  }
  const savedRow = Array.isArray(ins.data) ? (ins.data as Record<string, unknown>[])[0] : null;

  /* 잔액 반영 — 실패해도 결제 기록은 남기고, 앱이 나중에 이 내역을 빼거나 지울 때
     잔액을 또 건드리지 않도록 연동 표시(l)를 false 로 바꿔 둬요. */
  const cardBal = cardAcct.plan;
  if (cardBal.matched && cardBal.id) {
    const patched = await restPatch(
      supabaseUrl,
      serviceKey,
      "asset_snapshots?id=eq." + encodeURIComponent(cardBal.id),
      { amount: Number(cardBal.after) },
      fetchImpl,
    );
    cardBal.applied = patched.ok;
    if (!patched.ok) {
      cardBal.reason = "patch_failed";
      parsed.warnings.push("생활비 통장 잔액을 반영하지 못했어요: " + (patched.error || "DB 오류"));
      if (savedRow && savedRow.id) {
        await restPatch(
          supabaseUrl,
          serviceKey,
          "transactions?id=eq." + encodeURIComponent(String(savedRow.id)),
          { pay_method: encodeExpensePay(payMethod, String(cardBal.name), false) },
          fetchImpl,
        );
      }
    } else if (savedRow) {
      savedRow.pay_method = row.pay_method;
    }
  }

  return reply(Object.assign({}, base, {
    action: isCancel ? "inserted_cancel" : "inserted",
    cancelMatch: isCancel ? cancelMatch : undefined,
    expenseAccount: cardBal,
    saved: savedRow
      ? {
        id: savedRow.id,
        tx_date: savedRow.tx_date,
        ym: savedRow.ym,
        title: savedRow.title,
        amount: Number(savedRow.amount),
        category_key: savedRow.category_key,
        pay_method: savedRow.pay_method,
        created_by: savedRow.created_by,
      }
      : row,
    message: (isCancel
      ? money(amountForSave) + " 취소 내역 기록 완료 · " + baseTitle + " (" +
        parsed.date.slice(5).replace("-", ".") + ")"
      : "가계부에 저장했어요 · " + title2 + " " + money(amountForSave) + " (" +
        parsed.date.slice(5).replace("-", ".") + ")") +
      (cardBal.matched
        ? " · " + cardBal.name + " 잔액 " + money(Number(cardBal.after)) + (cardBal.applied ? " 반영" : " 반영 실패")
        : (cardBal.reason === "no_snapshot_for_ym"
          ? " · " + cardYm + " 자산 기록이 없어 통장 잔액은 그대로"
          : (cardBal.reason === "no_living_account" ? " · 생활비 통장을 찾지 못해 잔액은 그대로" : ""))),
  }), 200);
}

if (import.meta.main) Deno.serve((req: Request) => handle(req));
