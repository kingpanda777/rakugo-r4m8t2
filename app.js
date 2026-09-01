'use strict';
/* ==========================================================================
   落語ログ  app.js

   ・データはすべて localStorage（この端末の中）に置く。
     外部へ送信する処理は入れないこと。写真も端末内だけ。
   ・localStorage の読み書きは必ず try-catch で囲む。
     保存できない端末（プライベートブラウズなど）でも画面は動くこと。
   ・あらすじは利用者が手で入力する。自動生成はしない。
   ========================================================================== */

const KEY = 'rakugo-log-v1';

/* 固定の選択肢。自由入力にしないのは、表記ゆれで集計がばらけるため */
const MEDIA = ['CD', '配信（音のみ）', '配信（映像あり）', 'DVD', '寄席・ホール', 'その他'];
const TAGS = ['笑える', 'しんみり', 'こわい', 'お見事', 'バカバカしい', '眠くなった'];
const MAX_TAGS = 3;

/* 代数の候補。実際に使われたものと合わせて出す */
const GEN_BASE = ['初代', '二代目', '三代目', '四代目', '五代目',
                  '六代目', '七代目', '八代目', '九代目', '十代目'];

let db = blankDb();
let storageOK = true;   // false なら「保存できません」の帯を出す
let listTab = 'work';   // 一覧のタブ: 'work' | 'performer'
let form = null;        // 入力画面で選択中の 視聴方法・評価・タグ

/* ------------------------------------------------------------------ 小道具 */

const $ = (sel, root) => (root || document).querySelector(sel);
const $$ = (sel, root) => Array.prototype.slice.call((root || document).querySelectorAll(sel));

function esc(s) {
  return String(s == null ? '' : s)
    .replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;').replace(/'/g, '&#39;');
}

function uid() {
  return Date.now().toString(36) + Math.random().toString(36).slice(2, 7);
}

function today() {
  const d = new Date();
  const p = (n) => String(n).padStart(2, '0');
  return d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate());
}

function fmtDate(s) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(s || '');
  return m ? (+m[1]) + '年' + (+m[2]) + '月' + (+m[3]) + '日' : '日付なし';
}

function uniq(arr) {
  const out = [];
  arr.forEach((v) => { if (v && out.indexOf(v) < 0) out.push(v); });
  return out;
}

/* [[キー, 中身の配列], ...] を返す */
function groupBy(items, keyOf) {
  const map = new Map();
  items.forEach((it) => {
    const k = keyOf(it);
    if (!map.has(k)) map.set(k, []);
    map.get(k).push(it);
  });
  return Array.from(map.entries());
}

function byDateDesc(a, b) {
  return String(b.date || '').localeCompare(String(a.date || '')) ||
         String(b.id).localeCompare(String(a.id));
}

function lastDate(logs) {
  return logs.reduce((m, l) => (String(l.date || '') > m ? String(l.date) : m), '');
}

function starHtml(n) {
  if (!n) return '<span class="rate none">評価なし</span>';
  return '<span class="rate" aria-label="5段階中' + n + '">' +
         '★'.repeat(n) + '<span class="off">' + '★'.repeat(5 - n) + '</span></span>';
}

/* 印象タグの色は CSS の .t0〜.t5 で持つ。TAGS の並び順と対応させる */
function tagClass(t) {
  const i = TAGS.indexOf(t);
  return 't' + (i < 0 ? 5 : i);
}

/* ------------------------------------------------------------ 保存と読み出し */

function blankDb() {
  return { version: 1, performers: [], works: [], logs: [] };
}

/* localStorage が使えるかを、実際に書いて確かめる。
   プライベートブラウズや設定で例外になる端末があるため */
function probeStorage() {
  try {
    localStorage.setItem(KEY + '-probe', '1');
    localStorage.removeItem(KEY + '-probe');
    return true;
  } catch (e) {
    return false;
  }
}

function loadDb() {
  let raw = null;
  try {
    raw = localStorage.getItem(KEY);
  } catch (e) {
    return blankDb();
  }
  if (!raw) return blankDb();
  try {
    const d = JSON.parse(raw);
    return {
      version: 1,
      performers: Array.isArray(d.performers) ? d.performers : [],
      works: Array.isArray(d.works) ? d.works : [],
      logs: Array.isArray(d.logs) ? d.logs : []
    };
  } catch (e) {
    /* 壊れた中身で上書きして消してしまわないよう、元の文字列を退避しておく */
    try { localStorage.setItem(KEY + '-broken-' + Date.now(), raw); } catch (e2) { /* 容量不足なら諦める */ }
    return blankDb();
  }
}

function saveDb() {
  if (!storageOK) return true;   // 保存できない端末では、この画面を開いている間だけ持つ
  try {
    localStorage.setItem(KEY, JSON.stringify(db));
    return true;
  } catch (e) {
    return false;
  }
}

/* 保存を試し、失敗したら元に戻して知らせる。
   引数の snapshot は { works, performers, logs } の配列コピー */
function persist(snapshot, message) {
  if (saveDb()) return true;
  if (snapshot) {
    db.works = snapshot.works;
    db.performers = snapshot.performers;
    db.logs = snapshot.logs;
  }
  alert(message || 'この端末の保存容量がいっぱいで、保存できませんでした。\n演者の写真を減らすと空きが作れます。');
  return false;
}

function snap() {
  return { works: db.works.slice(), performers: db.performers.slice(), logs: db.logs.slice() };
}

/* ---------------------------------------------------------------- 検索まわり */

const workById = (id) => db.works.filter((w) => w.id === id)[0] || null;
const perfById = (id) => db.performers.filter((p) => p.id === id)[0] || null;
const logsOfWork = (id) => db.logs.filter((l) => l.workId === id);
const logsOfPerf = (id) => db.logs.filter((l) => l.performerId === id);

function findWork(title) {
  const t = String(title).trim();
  return db.works.filter((w) => w.title === t)[0] || null;
}

/* 演者は「名前 + 代数」で一意。襲名で同名の別人がいるため */
function findPerf(name, gen) {
  const n = String(name).trim(), g = String(gen || '').trim();
  return db.performers.filter((p) => p.name === n && String(p.gen || '') === g)[0] || null;
}

function perfLabel(p) {
  if (!p) return '（不明な演者）';
  return (p.gen ? p.gen + ' ' : '') + p.name;
}

function perfThumb(p) {
  if (p.photo) return '<img class="rthumb" src="' + esc(p.photo) + '" alt="">';
  return '<div class="rph" aria-hidden="true">' + esc(String(p.name || '？').slice(0, 1)) + '</div>';
}

/* ============================================================ 画面：一覧 */

/* タブの下に置く数字3つ。囲みを作らず、文字だけで並べる */
function numsHtml() {
  const ym = today().slice(0, 7);
  const thisMonth = db.logs.filter((l) => String(l.date || '').slice(0, 7) === ym).length;
  const works = db.works.filter((w) => logsOfWork(w.id).length).length;

  /* 「多い印象」は延べ数がいちばん多いタグ。同数なら TAGS の並び順で先のもの */
  let top = '—';
  let best = 0;
  TAGS.forEach((t) => {
    const n = db.logs.filter((l) => (l.tags || []).indexOf(t) >= 0).length;
    if (n > best) { best = n; top = t; }
  });

  return '<div class="nums">' +
    '<div class="num"><span>今月</span><b>' + thisMonth + '</b></div>' +
    '<div class="num"><span>演目</span><b>' + works + '</b></div>' +
    '<div class="num acc"><span>多い印象</span><b>' + esc(top) + '</b></div>' +
    '</div>';
}

function viewList() {
  const segs =
    '<div class="segs">' +
    '<button data-act="tab" data-tab="work" class="' + (listTab === 'work' ? 'on' : '') + '">演目で見る</button>' +
    '<button data-act="tab" data-tab="performer" class="' + (listTab === 'performer' ? 'on' : '') + '">演者で見る</button>' +
    '</div>';

  if (!db.logs.length) {
    return '<div class="empty">まだ記録がありません。<br>上の「記録する」から、最初の一席を追加してください。</div>';
  }
  const head = numsHtml() + segs;

  let rows;
  if (listTab === 'work') {
    /* 演目タブ：演目名の下に、記録のある演者名 */
    rows = db.works.map((w) => {
      const logs = logsOfWork(w.id);
      return {
        id: w.id, kind: 'work', title: w.title, thumb: '',
        sub: uniq(logs.map((l) => perfLabel(perfById(l.performerId)))).join(' ・ '),
        n: logs.length, last: lastDate(logs)
      };
    });
  } else {
    /* 演者タブ：演者名の下に、聴いた演目名 */
    rows = db.performers.map((p) => {
      const logs = logsOfPerf(p.id);
      return {
        id: p.id, kind: 'performer', title: perfLabel(p), thumb: perfThumb(p),
        sub: uniq(logs.map((l) => (workById(l.workId) || {}).title)).join(' ・ '),
        n: logs.length, last: lastDate(logs)
      };
    });
  }

  /* 並び順は「最近聴いた順」。記録アプリなので直近のものを上に出す。
     同じ日に聴いたものが並んだときは 件数の多い順 → 名前順 で決める
     （決めておかないと、開くたびに順番が変わって落ち着かない） */
  rows = rows.filter((r) => r.n > 0).sort((a, b) =>
    b.last.localeCompare(a.last) || b.n - a.n || a.title.localeCompare(b.title, 'ja'));

  return head + '<div class="rows">' + rows.map((r) =>
    '<a class="row" href="#/' + r.kind + '/' + esc(r.id) + '">' + r.thumb +
    '<div class="rtext"><div class="rtitle">' + esc(r.title) + '</div>' +
    '<div class="rmeta">' + (esc(r.sub) || '&nbsp;') + '</div></div>' +
    '<span class="cnt">' + r.n + '件</span></a>'
  ).join('') + '</div>';
}

/* ========================================================== 画面：演目の詳細 */

function viewWork(id) {
  const w = workById(id);
  if (!w) return notFound();
  const logs = logsOfWork(id);

  /* 演目 → 演者 → 聴いた回 の3階層 */
  const groups = groupBy(logs, (l) => l.performerId)
    .sort((a, b) => lastDate(b[1]).localeCompare(lastDate(a[1])));

  const body = groups.map((g) => {
    const p = perfById(g[0]);
    const inner = g[1].slice().sort(byDateDesc).map(logCard).join('');
    return '<div class="pgroup"><h3 class="pname">' +
      (p ? '<a href="#/performer/' + esc(p.id) + '">' + esc(perfLabel(p)) + '</a>' : '（不明な演者）') +
      '<span class="count">' + g[1].length + '件</span></h3>' +
      '<div class="plogs">' + inner + '</div></div>';
  }).join('');

  return '<a class="back" href="#/">← 一覧にもどる</a>' +
    '<h2 class="dtitle">' + esc(w.title) + '</h2>' +
    '<div class="dsub">記録 ' + logs.length + '件 ・ 演者 ' + groups.length + '人</div>' +
    (w.summary
      ? '<div class="summary">' + esc(w.summary) + '</div>'
      : '<div class="note">あらすじは未入力です。</div>') +
    '<div class="acts"><button data-act="open-work-edit">演目名・あらすじを編集</button></div>' +
    workEditForm(w) +
    (body || '<div class="empty">この演目の記録がありません。</div>');
}

function workEditForm(w) {
  return '<div class="card" id="edit-box" hidden>' +
    '<div class="field"><label for="e-title">演目名</label>' +
    '<input type="text" id="e-title" value="' + esc(w.title) + '"></div>' +
    '<div class="field"><label for="e-summary">あらすじ要約<span class="opt">任意・3〜4行程度</span></label>' +
    '<textarea id="e-summary" placeholder="自分の言葉で書いておくと、あとで思い出しやすくなります">' + esc(w.summary || '') + '</textarea>' +
    '<div class="note">自動では入りません。空欄のままでも構いません。</div></div>' +
    '<button class="primary" data-act="save-work" data-id="' + esc(w.id) + '">保存する</button>' +
    '<button class="ghost" data-act="close-edit">やめる</button>' +
    '<button class="ghost danger" data-act="del-work" data-id="' + esc(w.id) + '">この演目を削除する</button>' +
    '</div>';
}

/* ========================================================== 画面：演者の詳細 */

function viewPerformer(id) {
  const p = perfById(id);
  if (!p) return notFound();
  const logs = logsOfPerf(id);

  const groups = groupBy(logs, (l) => l.workId)
    .sort((a, b) => lastDate(b[1]).localeCompare(lastDate(a[1])));

  const body = groups.map((g) => {
    const w = workById(g[0]);
    const inner = g[1].slice().sort(byDateDesc).map(logCard).join('');
    return '<div class="pgroup"><h3 class="pname">' +
      (w ? '<a href="#/work/' + esc(w.id) + '">' + esc(w.title) + '</a>' : '（不明な演目）') +
      '<span class="count">' + g[1].length + '件</span></h3>' +
      '<div class="plogs">' + inner + '</div></div>';
  }).join('');

  return '<a class="back" href="#/">← 一覧にもどる</a>' +
    (p.photo ? '<img class="photo" src="' + esc(p.photo) + '" alt="' + esc(p.name) + 'の写真" style="margin-top:16px">' : '') +
    '<h2 class="dtitle">' + esc(perfLabel(p)) + '</h2>' +
    '<div class="dsub">記録 ' + logs.length + '件 ・ 演目 ' + groups.length + '席</div>' +
    (p.memo ? '<div class="summary">' + esc(p.memo) + '</div>' : '') +
    '<div class="acts"><button data-act="open-perf-edit">写真・代数・メモを編集</button></div>' +
    perfEditForm(p) +
    (body || '<div class="empty">この演者の記録がありません。</div>');
}

function perfEditForm(p) {
  return '<div class="card" id="edit-box" hidden>' +
    '<div class="field"><label for="e-name">名前</label>' +
    '<input type="text" id="e-name" value="' + esc(p.name) + '"></div>' +
    '<div class="field"><label for="e-gen">代数<span class="opt">任意</span></label>' +
    '<input type="text" id="e-gen" list="dl-gens" value="' + esc(p.gen || '') + '" placeholder="例：五代目"></div>' +
    '<div class="field"><label for="e-photo">プロフィール写真<span class="opt">任意</span></label>' +
    '<input type="file" id="e-photo" accept="image/*">' +
    '<div class="note">200ピクセル角に縮小してから保存します。元の写真はそのままです。</div>' +
    (p.photo ? '<button class="ghost danger" data-act="del-photo" data-id="' + esc(p.id) + '">写真を削除する</button>' : '') +
    '</div>' +
    '<div class="field"><label for="e-memo">メモ<span class="opt">任意</span></label>' +
    '<textarea id="e-memo">' + esc(p.memo || '') + '</textarea></div>' +
    '<button class="primary" data-act="save-perf" data-id="' + esc(p.id) + '">保存する</button>' +
    '<button class="ghost" data-act="close-edit">やめる</button>' +
    '<button class="ghost danger" data-act="del-perf" data-id="' + esc(p.id) + '">この演者を削除する</button>' +
    '</div>';
}

/* 1回分の聴取記録。演目側・演者側の両方から使う。
   1行目に 日付／視聴方法／★（★は右端）、その下にメモ、さらに下に印象タグ */
function logCard(l) {
  return '<div class="log">' +
    '<div class="logtop"><span class="logdate">' + esc(fmtDate(l.date)) + '</span>' +
    (l.medium ? '<span class="logway">' + esc(l.medium) + '</span>' : '') +
    starHtml(l.rating) + '</div>' +
    (l.memo ? '<div class="logmemo">' + esc(l.memo) + '</div>' : '') +
    ((l.tags && l.tags.length)
      ? '<div class="tags">' + l.tags.map((t) =>
          '<span class="tag ' + tagClass(t) + '">' + esc(t) + '</span>').join('') + '</div>'
      : '') +
    '<div class="acts">' +
    '<button data-act="edit-log" data-id="' + esc(l.id) + '">編集</button>' +
    '<button class="danger" data-act="del-log" data-id="' + esc(l.id) + '">削除</button>' +
    '</div></div>';
}

function notFound() {
  return '<div class="empty">見つかりませんでした。<br><a href="#/">一覧にもどる</a></div>';
}

/* ============================================================ 画面：入力 */

function viewForm(logId) {
  form = null;
  const editing = logId ? db.logs.filter((l) => l.id === logId)[0] : null;
  if (logId && !editing) return notFound();

  const w = editing ? workById(editing.workId) : null;
  const p = editing ? perfById(editing.performerId) : null;

  form = {
    logId: editing ? editing.id : null,
    medium: editing ? (editing.medium || '') : '',
    rating: editing ? (editing.rating || 0) : 0,
    tags: editing ? (editing.tags || []).slice(0, MAX_TAGS) : []
  };

  const mediaBtns = MEDIA.map((m) =>
    '<button data-act="medium" data-v="' + esc(m) + '"' +
    (form.medium === m ? ' class="on"' : '') + '>' + esc(m) + '</button>').join('');

  const starBtns = [1, 2, 3, 4, 5].map((n) =>
    '<button data-act="star" data-v="' + n + '" aria-label="星' + n + '"' +
    (form.rating >= n ? ' class="on"' : '') + '>★</button>').join('');

  /* タグのボタンは選ぶとそのタグ自身の色になる。色は .t0〜.t5 が持つ */
  const tagBtns = TAGS.map((t) =>
    '<button class="' + tagClass(t) + '" data-act="tag" data-tag="' + esc(t) + '">' +
    esc(t) + '</button>').join('');

  return '<h2 class="sec">' + (editing ? '記録を編集' : '聴いた記録を追加') + '</h2>' +

    '<div class="field"><label for="f-work">演目</label>' +
    '<input type="text" id="f-work" list="dl-works" autocomplete="off" placeholder="例：芝浜" value="' + esc(w ? w.title : '') + '">' +
    '<div class="hint" id="h-work"></div></div>' +

    '<div class="field" id="wrap-summary" hidden>' +
    '<label for="f-summary">あらすじ要約<span class="opt">任意・3〜4行程度</span></label>' +
    '<textarea id="f-summary" placeholder="自分の言葉で書いておくと、あとで思い出しやすくなります"></textarea>' +
    '<div class="note">空欄のままでも保存できます。あとから演目のページで書き足せます。</div></div>' +

    '<div class="field"><label for="f-name">演者</label>' +
    '<input type="text" id="f-name" list="dl-names" autocomplete="off" placeholder="例：古今亭志ん生" value="' + esc(p ? p.name : '') + '"></div>' +

    '<div class="field"><label for="f-gen">代数<span class="opt">任意</span></label>' +
    '<input type="text" id="f-gen" list="dl-gens" autocomplete="off" placeholder="例：五代目" value="' + esc(p ? (p.gen || '') : '') + '">' +
    '<div class="hint" id="h-perf"></div></div>' +

    '<div class="field"><label for="f-date">聴いた日</label>' +
    '<input type="date" id="f-date" value="' + esc(editing ? editing.date : today()) + '"></div>' +

    '<div class="field"><label>視聴方法</label>' +
    '<div class="pills" id="f-media">' + mediaBtns + '</div></div>' +

    '<div class="field"><label>評価</label>' +
    '<div class="starpick" id="f-stars">' + starBtns + '</div>' +
    '<div class="note">同じ星をもう一度押すと「評価なし」に戻ります。</div></div>' +

    '<div class="field"><label>印象タグ<span class="opt">3つまで</span></label>' +
    '<div class="taggrid" id="f-tags">' + tagBtns + '</div></div>' +

    '<div class="field"><label for="f-memo">メモ<span class="opt">任意</span></label>' +
    '<textarea id="f-memo">' + esc(editing ? (editing.memo || '') : '') + '</textarea></div>' +

    /* 「名前を直したのか、別の演目・演者に付け替えたのか」を聞く欄。
       聞くことがあるときだけ中身が入る（askHtml / nextAsk） */
    '<div id="ask"></div>' +

    '<button class="primary" data-act="save-log">' + (editing ? '変更を保存' : '記録する') + '</button>' +
    (editing ? '<button class="ghost" data-act="cancel-edit" data-id="' + esc(editing.workId) + '">やめる</button>' : '') +
    '<div class="note">演者の写真とメモは、保存したあと演者のページから追加できます。</div>';
}

/* 入力画面の候補（オートコンプリート）を用意する */
function fillDatalists() {
  const gens = uniq(GEN_BASE.concat(db.performers.map((p) => p.gen).filter(Boolean)));
  $('#dl-works').innerHTML = db.works.map((w) => '<option value="' + esc(w.title) + '">').join('');
  $('#dl-names').innerHTML = uniq(db.performers.map((p) => p.name)).map((n) => '<option value="' + esc(n) + '">').join('');
  $('#dl-gens').innerHTML = gens.map((g) => '<option value="' + esc(g) + '">').join('');
}

/* 入力中の「新規か既存か」を出し分ける */
function updateHints() {
  const title = ($('#f-work') || {}).value;
  const name = ($('#f-name') || {}).value;
  const gen = ($('#f-gen') || {}).value;
  if (title == null) return;

  const hw = $('#h-work'), wrap = $('#wrap-summary');
  const t = String(title).trim();
  if (!t) {
    hw.className = 'hint'; hw.textContent = '';
    wrap.hidden = true;
  } else if (findWork(t)) {
    hw.className = 'hint'; hw.textContent = '登録済みの演目です。';
    wrap.hidden = true;
  } else {
    hw.className = 'hint new'; hw.textContent = '新しい演目として登録します。';
    wrap.hidden = false;
  }

  const hp = $('#h-perf');
  const n = String(name).trim(), g = String(gen || '').trim();
  if (!n) {
    hp.className = 'hint'; hp.textContent = '';
  } else if (findPerf(n, g)) {
    hp.className = 'hint'; hp.textContent = '登録済みの演者です。';
  } else {
    const others = db.performers.filter((p) => p.name === n).map((p) => p.gen || '代数なし');
    if (others.length) {
      hp.className = 'hint dup';
      hp.textContent = '同じ名前で「' + others.join('・') + '」が登録済みです。同じ人なら代数を合わせてください。別人ならこのまま進みます。';
    } else {
      hp.className = 'hint new';
      hp.textContent = '新しい演者として登録します。';
    }
  }
}

function paintTags() {
  $$('#f-tags button').forEach((b) => {
    const on = form.tags.indexOf(b.dataset.tag) >= 0;
    b.classList.toggle('on', on);
    /* 3つ選んだあと、4つ目は押しても何も起きない。それが見て分かるように薄くする */
    b.classList.toggle('locked', !on && form.tags.length >= MAX_TAGS);
  });
}

function paintStars() {
  $$('#f-stars button').forEach((b) => {
    b.classList.toggle('on', form.rating >= Number(b.dataset.v));
  });
}

function paintMedia() {
  $$('#f-media button').forEach((b) => {
    b.classList.toggle('on', b.dataset.v === form.medium);
  });
}

function saveLog() {
  const title = $('#f-work').value.trim();
  const name = $('#f-name').value.trim();
  if (!title) { alert('演目を入れてください。'); $('#f-work').focus(); return; }
  if (!name) { alert('演者を入れてください。'); $('#f-name').focus(); return; }

  const v = {
    title: title,
    name: name,
    gen: $('#f-gen').value.trim(),
    summary: ($('#f-summary') && !$('#wrap-summary').hidden) ? $('#f-summary').value.trim() : '',
    date: $('#f-date').value || today(),
    memo: $('#f-memo').value.trim()
  };

  form.ask = { values: v, queue: buildQuestions(v), answers: {} };
  nextAsk();
}

/* 記録の編集で「演目名・演者名を書き換えた」とき、それが
   ・その演目／演者の名前を直したかった（＝全部の記録に反映）
   ・この記録だけ別の演目／演者に付け替えたかった（＝新規に分ける）
   のどちらなのかは、入力からは決められない。だから聞く。

   黙って改名すると「演者を取り違えて記録していた」場合に
   その演者の記録すべてを巻き添えで改名してしまう。
   逆に黙って新規作成すると、名前の打ち直しのたびに演目が枝分かれする
   （2026-09-01 に報告された不具合がこれ）。

   新規の記録（logId なし）と、既にある名前を入れた場合は迷わないので聞かない。 */
function buildQuestions(v) {
  const qs = [];
  if (!form.logId) return qs;
  const cur = db.logs.filter((l) => l.id === form.logId)[0];
  if (!cur) return qs;

  const curW = workById(cur.workId);
  if (curW && curW.title !== v.title && !findWork(v.title)) {
    qs.push({ kind: 'work', from: curW.title, to: v.title, n: logsOfWork(curW.id).length });
  }
  const curP = perfById(cur.performerId);
  if (curP && (curP.name !== v.name || String(curP.gen || '') !== v.gen) &&
      !findPerf(v.name, v.gen)) {
    qs.push({
      kind: 'perf', from: perfLabel(curP), n: logsOfPerf(curP.id).length,
      to: perfLabel({ name: v.name, gen: v.gen })
    });
  }
  return qs;
}

function askHtml(q) {
  const what = q.kind === 'work' ? '演目' : '演者';
  const lone = q.n === 1
    ? '<span>元の「' + esc(q.from) + '」は記録が0件になり、一覧から消えます</span>'
    : '<span>ほかの ' + (q.n - 1) + '件は「' + esc(q.from) + '」のままです</span>';
  return '<div class="ask">' +
    '<div class="askq">' + what + '名が変わっています</div>' +
    '<div class="askd">「' + esc(q.from) + '」　→　「' + esc(q.to) + '」</div>' +
    '<div class="askn">どちらのつもりか選んでください。</div>' +
    '<button class="askbtn" data-act="ask" data-a="rename">' +
    'この' + what + 'の名前を直す' +
    '<span>「' + esc(q.from) + '」の記録 ' + q.n + '件すべてが「' + esc(q.to) + '」になります</span>' +
    '</button>' +
    '<button class="askbtn" data-act="ask" data-a="move">' +
    '別の' + what + 'として分ける' +
    '<span>この記録だけが「' + esc(q.to) + '」になります</span>' + lone +
    '</button>' +
    /* すぐ下の「やめる」（編集をやめて戻る）と紛らわしいので言葉を変える */
    '<button class="ghost" data-act="ask-cancel">入力に戻って直す</button>' +
    '</div>';
}

function nextAsk() {
  const a = form.ask;
  if (!a.queue.length) { form.ask = null; commitLog(a.values, a.answers); return; }
  const box = $('#ask');
  box.innerHTML = askHtml(a.queue[0]);
  if (box.scrollIntoView) box.scrollIntoView({ block: 'center' });
}

function commitLog(v, ans) {
  const before = snap();
  const cur = form.logId ? db.logs.filter((l) => l.id === form.logId)[0] : null;

  /* --- 演目。既にある名前ならそれに付け替える（IDで紐づくので改名しても切れない） */
  let w = findWork(v.title);
  if (!w) {
    if (ans.work === 'rename' && cur) {
      const oldId = cur.workId;
      db.works = db.works.map((x) => (x.id === oldId ? { id: x.id, title: v.title, summary: x.summary } : x));
      w = workById(oldId);
    } else {
      w = { id: uid(), title: v.title, summary: v.summary };
      db.works = db.works.concat([w]);
    }
  }

  /* --- 演者。名前＋代数で一意。代数だけの修正も改名として扱える */
  let p = findPerf(v.name, v.gen);
  if (!p) {
    if (ans.perf === 'rename' && cur) {
      const oldId = cur.performerId;
      db.performers = db.performers.map((x) => (
        x.id === oldId ? { id: x.id, name: v.name, gen: v.gen, photo: x.photo, memo: x.memo } : x
      ));
      p = perfById(oldId);
    } else {
      p = { id: uid(), name: v.name, gen: v.gen, photo: '', memo: '' };
      db.performers = db.performers.concat([p]);
    }
  }

  const rec = {
    id: form.logId || uid(),
    workId: w.id,
    performerId: p.id,
    date: v.date,
    medium: form.medium,
    rating: form.rating,
    tags: form.tags.slice(),
    memo: v.memo
  };

  if (form.logId) {
    db.logs = db.logs.map((l) => (l.id === form.logId ? rec : l));
  } else {
    db.logs = db.logs.concat([rec]);
  }

  if (!persist(before)) return;   // 失敗したら入力画面のまま残す
  location.hash = '#/work/' + w.id;
}

/* ============================================================ 画面：集計 */

/* 棒は1系列なので単色（朱）。印象タグのところだけ、items に cls を入れて
   タグ自身の色にする。値は必ず横に文字で添えるので、色が読めなくても分かる */
function barsHtml(items, unit) {
  if (!items.length) return '<div class="empty">まだ記録がありません。</div>';
  const max = items.reduce((m, i) => Math.max(m, i.value), 0) || 1;
  return '<div class="bars">' + items.map((i) =>
    '<div class="brow"><div class="bhead">' +
    '<span class="blab">' + esc(i.label) + '</span>' +
    '<span class="bval">' + i.value + (unit || '回') +
    (i.extra ? ' ・ ' + esc(i.extra) : '') + '</span></div>' +
    '<div class="btrack">' +
    (i.value > 0
      ? '<div class="bfill ' + (i.cls || '') + '" style="width:' + Math.round(i.value / max * 100) + '%"></div>'
      : '') +
    '</div></div>'
  ).join('') + '</div>';
}

function monthsHtml(logs) {
  const now = new Date();
  const cols = [];
  for (let i = 11; i >= 0; i--) {
    const d = new Date(now.getFullYear(), now.getMonth() - i, 1);
    const key = d.getFullYear() + '-' + String(d.getMonth() + 1).padStart(2, '0');
    cols.push({ key: key, label: (d.getMonth() + 1) + '月', y: d.getFullYear(), m: d.getMonth() + 1, value: 0 });
  }
  logs.forEach((l) => {
    const k = String(l.date || '').slice(0, 7);
    const c = cols.filter((x) => x.key === k)[0];
    if (c) c.value += 1;
  });
  const max = cols.reduce((m, c) => Math.max(m, c.value), 0) || 1;

  const body = cols.map((c) =>
    '<div class="mcol">' +
    '<span class="mval">' + (c.value || '') + '</span>' +
    '<div class="mbarbox"><div class="mbar' + (c.value ? '' : ' zero') + '" style="height:' +
    (c.value ? Math.max(6, Math.round(c.value / max * 100)) : 2) + '%"></div></div>' +
    '<span class="mlab">' + c.label + '</span></div>'
  ).join('');

  const a = cols[0], b = cols[cols.length - 1];
  return '<div><div class="months">' + body + '</div>' +
    '<div class="cap">' + a.y + '年' + a.m + '月 〜 ' + b.y + '年' + b.m + '月（直近12か月）</div></div>';
}

function viewStats() {
  const logs = db.logs;
  if (!logs.length) {
    return '<div class="empty">まだ記録がありません。<br>「記録する」から追加すると、ここに集計が出ます。</div>';
  }

  const rated = logs.filter((l) => l.rating > 0);
  const avg = rated.length ? (rated.reduce((s, l) => s + l.rating, 0) / rated.length).toFixed(1) : '—';

  const nums = '<div class="nums four">' +
    '<div class="num"><span>聴いた回数</span><b>' + logs.length + '</b></div>' +
    '<div class="num"><span>演目</span><b>' + db.works.filter((w) => logsOfWork(w.id).length).length + '</b></div>' +
    '<div class="num"><span>演者</span><b>' + db.performers.filter((p) => logsOfPerf(p.id).length).length + '</b></div>' +
    '<div class="num"><span>平均の★</span><b>' + avg + '</b></div>' +
    '</div>';

  /* 演目ランキング */
  const workRank = db.works.map((w) => ({ label: w.title, value: logsOfWork(w.id).length }))
    .filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 12);

  /* 演者別 */
  const perfRank = db.performers.map((p) => ({ label: perfLabel(p), value: logsOfPerf(p.id).length }))
    .filter((x) => x.value > 0).sort((a, b) => b.value - a.value).slice(0, 12);

  /* 印象タグ。1回の記録に最大3つ付くので延べ数で数える */
  const tagTotal = logs.reduce((s, l) => s + ((l.tags || []).length), 0);
  const tagRows = TAGS.map((t) => {
    const n = logs.filter((l) => (l.tags || []).indexOf(t) >= 0).length;
    return {
      label: t, value: n, cls: 'tagbar ' + tagClass(t),
      extra: tagTotal ? Math.round(n / tagTotal * 100) + '%' : ''
    };
  }).sort((a, b) => b.value - a.value);

  /* 視聴方法。件数だけでなく平均評価も添える（生と音のみで差が出るかを見たい） */
  const mediaRows = MEDIA.map((m) => {
    const ls = logs.filter((l) => l.medium === m);
    const r = ls.filter((l) => l.rating > 0);
    return {
      label: m, value: ls.length,
      extra: r.length ? '平均★' + (r.reduce((s, l) => s + l.rating, 0) / r.length).toFixed(1) : ''
    };
  }).sort((a, b) => b.value - a.value);

  const noMedium = logs.filter((l) => !l.medium).length;

  return nums +
    '<h2 class="sec">よく聴いた演目</h2>' + barsHtml(workRank) +
    '<h2 class="sec">演者別の聴取回数</h2>' + barsHtml(perfRank) +
    '<h2 class="sec">印象タグ<span class="count">延べ ' + tagTotal + '個</span></h2>' + barsHtml(tagRows, '件') +
    '<h2 class="sec">月別の聴取数</h2>' + monthsHtml(logs) +
    '<h2 class="sec">視聴方法別</h2>' + barsHtml(mediaRows) +
    (noMedium ? '<div class="note">視聴方法が未設定の記録が ' + noMedium + '件あります。</div>' : '');
}

/* ============================================================ 写真の縮小 */

/* スマホの写真は1枚3〜5MB あり、localStorage の上限（約5MB）を1枚で
   使い切ってしまう。200ピクセル角の JPEG に縮めてから保存する。
   正方形に中央で切り抜くので、一覧の丸い枠に収まる */
function shrinkPhoto(file, done) {
  const SIZE = 200;
  const url = URL.createObjectURL(file);
  const img = new Image();
  img.onload = function () {
    try {
      const s = Math.min(img.width, img.height);
      const cv = document.createElement('canvas');
      cv.width = SIZE; cv.height = SIZE;
      cv.getContext('2d').drawImage(img, (img.width - s) / 2, (img.height - s) / 2, s, s, 0, 0, SIZE, SIZE);
      URL.revokeObjectURL(url);
      done(cv.toDataURL('image/jpeg', 0.8));
    } catch (e) {
      URL.revokeObjectURL(url);
      done(null);
    }
  };
  img.onerror = function () { URL.revokeObjectURL(url); done(null); };
  img.src = url;
}

/* ============================================================ 画面の切り替え */

function render() {
  const hash = location.hash.replace(/^#/, '') || '/';
  const seg = hash.split('/').filter(Boolean);
  let nav = 'list', html;

  if (seg[0] === 'new') { nav = 'new'; html = viewForm(null); }
  else if (seg[0] === 'edit') { nav = 'new'; html = viewForm(seg[1]); }
  else if (seg[0] === 'stats') { nav = 'stats'; html = viewStats(); }
  else if (seg[0] === 'work') { html = viewWork(seg[1]); }
  else if (seg[0] === 'performer') { html = viewPerformer(seg[1]); }
  else { html = viewList(); }

  if (seg[0] !== 'new' && seg[0] !== 'edit') form = null;

  $('#app').innerHTML = html;
  $$('.nav a').forEach((a) => a.classList.toggle('on', a.dataset.nav === nav));

  /* アプリ名の下の小さな行。記録が無いうちは出さない */
  const st = $('#stamp');
  st.textContent = db.logs.length
    ? '記録' + db.logs.length + '件・演目' + db.works.filter((w) => logsOfWork(w.id).length).length +
      '・演者' + db.performers.filter((p) => logsOfPerf(p.id).length).length
    : '';

  if (form) { fillDatalists(); updateHints(); paintTags(); }
  window.scrollTo(0, 0);
}

/* ------------------------------------------------------------ 操作の受付 */

function onClick(ev) {
  const btn = ev.target.closest('[data-act]');
  if (!btn) return;
  const act = btn.dataset.act;
  const id = btn.dataset.id;

  if (act === 'tab') { listTab = btn.dataset.tab; render(); return; }

  /* ここから下は入力画面の操作。form が無い＝入力画面ではない */
  if (['medium', 'star', 'tag', 'save-log', 'ask', 'ask-cancel'].indexOf(act) >= 0 && !form) return;

  if (act === 'medium') {
    form.medium = (form.medium === btn.dataset.v) ? '' : btn.dataset.v;
    paintMedia(); return;
  }
  if (act === 'star') {
    const v = Number(btn.dataset.v);
    form.rating = (form.rating === v) ? 0 : v;
    paintStars(); return;
  }
  if (act === 'tag') {
    const t = btn.dataset.tag, i = form.tags.indexOf(t);
    if (i >= 0) form.tags.splice(i, 1);
    else if (form.tags.length >= MAX_TAGS) return;   // 4つ目は何も起きない
    else form.tags.push(t);
    paintTags(); return;
  }
  if (act === 'save-log') { saveLog(); return; }
  if (act === 'cancel-edit') { location.hash = '#/work/' + id; return; }
  if (act === 'ask') {
    if (!form.ask) return;
    form.ask.answers[form.ask.queue[0].kind] = btn.dataset.a;
    form.ask.queue.shift();
    nextAsk();
    return;
  }
  if (act === 'ask-cancel') { form.ask = null; $('#ask').innerHTML = ''; return; }

  if (act === 'edit-log') { location.hash = '#/edit/' + id; return; }
  if (act === 'del-log') {
    if (!confirm('この1回分の記録を削除します。よろしいですか？')) return;
    const before = snap();
    db.logs = db.logs.filter((l) => l.id !== id);
    if (persist(before)) render();
    return;
  }

  if (act === 'open-work-edit' || act === 'open-perf-edit') {
    $('#edit-box').hidden = false; btn.hidden = true; return;
  }
  if (act === 'close-edit') { render(); return; }

  if (act === 'save-work') {
    const title = $('#e-title').value.trim();
    if (!title) { alert('演目名を入れてください。'); return; }
    const summary = $('#e-summary').value.trim();
    const dup = findWork(title);

    /* 同じ名前の演目が既にある。表記ゆれで二重に登録してしまった状態なので、
       「まとめる」入口にする。ここで断るだけだと直す手立てが無くなる */
    if (dup && dup.id !== id) {
      const n = logsOfWork(id).length;
      if (!confirm('「' + title + '」という演目はすでにあります。\n\n' +
                   '2つを1つにまとめますか？\n' +
                   'この演目の記録 ' + n + '件が「' + title + '」に移り、こちらの演目は消えます。')) return;
      const before = snap();
      db.logs = db.logs.map((l) => (l.workId === id ? Object.assign({}, l, { workId: dup.id }) : l));
      /* あらすじは残るほうを優先。残るほうが空なら、消えるほうのものを引き継ぐ */
      if (!dup.summary && summary) {
        db.works = db.works.map((w) => (w.id === dup.id ? Object.assign({}, w, { summary: summary }) : w));
      }
      db.works = db.works.filter((w) => w.id !== id);
      if (persist(before)) location.hash = '#/work/' + dup.id;
      return;
    }

    const before = snap();
    db.works = db.works.map((w) => (w.id === id ? { id: w.id, title: title, summary: summary } : w));
    if (persist(before)) render();
    return;
  }
  if (act === 'del-work') {
    const n = logsOfWork(id).length;
    if (!confirm('この演目と、ひもづく記録 ' + n + '件をまとめて削除します。よろしいですか？')) return;
    const before = snap();
    db.logs = db.logs.filter((l) => l.workId !== id);
    db.works = db.works.filter((w) => w.id !== id);
    if (persist(before)) location.hash = '#/';
    return;
  }

  if (act === 'save-perf') { savePerf(id); return; }
  if (act === 'del-perf') {
    const n = logsOfPerf(id).length;
    if (!confirm('この演者と、ひもづく記録 ' + n + '件をまとめて削除します。よろしいですか？')) return;
    const before = snap();
    db.logs = db.logs.filter((l) => l.performerId !== id);
    db.performers = db.performers.filter((p) => p.id !== id);
    if (persist(before)) location.hash = '#/';
    return;
  }
  if (act === 'del-photo') {
    const before = snap();
    db.performers = db.performers.map((p) => (p.id === id ? Object.assign({}, p, { photo: '' }) : p));
    if (persist(before)) render();
    return;
  }
}

function savePerf(id) {
  const name = $('#e-name').value.trim();
  if (!name) { alert('名前を入れてください。'); return; }
  const gen = $('#e-gen').value.trim();
  const memo = $('#e-memo').value.trim();
  const dup = findPerf(name, gen);

  /* 同じ「名前＋代数」の演者が既にいる＝二重登録。演目と同じくまとめる入口にする */
  if (dup && dup.id !== id) {
    const me = perfById(id);
    const n = logsOfPerf(id).length;
    if (!confirm('「' + perfLabel(dup) + '」はすでに登録されています。\n\n' +
                 '2人を1人にまとめますか？\n' +
                 'この演者の記録 ' + n + '件が「' + perfLabel(dup) + '」に移り、こちらは消えます。')) return;
    const before = snap();
    db.logs = db.logs.map((l) => (l.performerId === id ? Object.assign({}, l, { performerId: dup.id }) : l));
    /* 写真とメモは残るほうを優先。空なら消えるほうのものを引き継ぐ */
    db.performers = db.performers.map((p) => (p.id === dup.id ? Object.assign({}, p, {
      photo: p.photo || (me ? me.photo : ''),
      memo: p.memo || memo
    }) : p));
    db.performers = db.performers.filter((p) => p.id !== id);
    if (persist(before)) location.hash = '#/performer/' + dup.id;
    return;
  }

  const file = $('#e-photo').files[0];

  const commit = (photo) => {
    const before = snap();
    db.performers = db.performers.map((p) => (
      p.id === id ? { id: p.id, name: name, gen: gen, memo: memo, photo: (photo == null ? p.photo : photo) } : p
    ));
    const ok = persist(before,
      '保存できませんでした。写真の分だけ容量が足りていない可能性があります。\n' +
      '他の演者の写真を減らすか、写真なしで保存してください。');
    if (ok) render();
  };

  if (file) {
    shrinkPhoto(file, (dataUrl) => {
      if (!dataUrl) { alert('この写真は読み込めませんでした。写真なしで保存します。'); commit(null); return; }
      commit(dataUrl);
    });
  } else {
    commit(null);
  }
}

/* ------------------------------------------------------------------ 起動 */

storageOK = probeStorage();
db = loadDb();
if (!storageOK) $('#storage-warn').hidden = false;

$('#app').addEventListener('click', onClick);
$('#app').addEventListener('input', (ev) => {
  if (form && ['f-work', 'f-name', 'f-gen'].indexOf(ev.target.id) >= 0) updateHints();
});
window.addEventListener('hashchange', render);
render();
