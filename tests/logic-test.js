/* 画面生成と集計を Node 上で確かめる簡易テスト。
   ブラウザの代わりに最小限の偽 DOM を置いて app.js を読み込み、
   各画面の HTML と集計の数を突き合わせる。
   実行： node tests/logic-test.js                                        */
const fs = require('fs');
const vm = require('vm');

function el() {
  return {
    hidden: false, innerHTML: '', value: '', files: [],
    dataset: {}, classList: { toggle() {}, add() {}, remove() {} },
    addEventListener() {}, focus() {}, closest() { return null; }
  };
}
const store = {};
const sandbox = {
  console,
  document: {
    querySelector: () => el(),
    querySelectorAll: () => [],
    createElement: () => el()
  },
  window: { scrollTo() {}, addEventListener() {} },
  location: { hash: '' },
  localStorage: {
    getItem: (k) => (k in store ? store[k] : null),
    setItem: (k, v) => { store[k] = String(v); },
    removeItem: (k) => { delete store[k]; }
  },
  alert: (m) => { console.log('       （画面に出る案内） ' + m); },
  confirm: () => true,
  history: { back() {} },
  Map, Math, Date, JSON, Number, String, Array, Object, RegExp, Error
};
sandbox.globalThis = sandbox;
vm.createContext(sandbox);
vm.runInContext(fs.readFileSync(__dirname + '/../app.js', 'utf8'), sandbox, { filename: 'app.js' });

const run = (code) => vm.runInContext(code, sandbox);

/* --- 試しのデータ ---------------------------------------------------- */
run(`
db = {
  version: 1,
  performers: [
    { id: 'p1', name: '古今亭志ん生', gen: '五代目', photo: '', memo: 'うまい' },
    { id: 'p2', name: '古今亭志ん生', gen: '六代目', photo: '', memo: '' },
    { id: 'p3', name: '柳家喬太郎', gen: '', photo: '', memo: '' }
  ],
  works: [
    { id: 'w1', title: '芝浜', summary: '魚屋の勝が浜で財布を拾う。' },
    { id: 'w2', title: '<script>いたずら', summary: '' }
  ],
  logs: [
    { id: 'l1', workId: 'w1', performerId: 'p1', date: '2026-09-01', medium: 'CD', rating: 5, tags: ['お見事','しんみり'], memo: 'よい' },
    { id: 'l2', workId: 'w1', performerId: 'p1', date: '2026-08-20', medium: 'CD', rating: 4, tags: ['しんみり'], memo: '' },
    { id: 'l3', workId: 'w1', performerId: 'p3', date: '2026-07-15', medium: '寄席・ホール', rating: 5, tags: ['笑える','お見事','バカバカしい'], memo: '' },
    { id: 'l4', workId: 'w2', performerId: 'p2', date: '2026-09-01', medium: '配信（映像あり）', rating: 0, tags: [], memo: '' }
  ]
};
`);

let ng = 0;
function ok(name, cond) {
  console.log((cond ? '  OK   ' : '  NG   ') + name);
  if (!cond) ng++;
}

console.log('\n== 一覧（演目タブ） ==');
let h = run('listTab="work"; viewList()');
ok('演目名が出る', h.includes('芝浜'));
ok('演者名が並ぶ', h.includes('五代目 古今亭志ん生') && h.includes('柳家喬太郎'));
ok('件数が3件', h.includes('>3件<'));
ok('同じ日付なら件数の多い順', h.indexOf('芝浜') < h.indexOf('いたずら'));
ok('入力された文字がHTMLとして解釈されない', !h.includes('<script>いたずら') && h.includes('&lt;script&gt;'));

console.log('\n== 一覧（演者タブ） ==');
h = run('listTab="performer"; viewList()');
ok('同名別人が2人出る', (h.match(/古今亭志ん生/g) || []).length === 2);
ok('写真なしは頭文字の丸', h.includes('class="rph"') && h.includes('>古<'));

console.log('\n== 演目の詳細 ==');
h = run('viewWork("w1")');
ok('あらすじが出る', h.includes('魚屋の勝'));
ok('演者ごとにまとまる', (h.match(/class="pgroup"/g) || []).length === 2);
ok('志ん生の下に2回分', (h.match(/class="log"/g) || []).length === 3);
ok('新しい日付が上', h.indexOf('2026年9月1日') < h.indexOf('2026年8月20日'));
ok('星が5つ', h.includes('★★★★★'));
h = run('viewWork("w2")');
ok('あらすじ未入力の案内', h.includes('あらすじは未入力です'));
ok('評価0は「評価なし」', h.includes('評価なし'));

console.log('\n== 演者の詳細 ==');
h = run('viewPerformer("p1")');
ok('襲名の代数つきで出る', h.includes('五代目 古今亭志ん生'));
ok('演目ごとにまとまる', h.includes('芝浜') && (h.match(/class="log"/g) || []).length === 2);
ok('見つからないIDでも落ちない', run('viewPerformer("zzz")').includes('見つかりませんでした'));

console.log('\n== 入力画面 ==');
h = run('viewForm(null)');
ok('視聴方法6つ', (h.match(/data-act="medium"/g) || []).length === 6);
ok('印象タグ6つ', (h.match(/data-act="tag"/g) || []).length === 6);
ok('星5つ', (h.match(/data-act="star"/g) || []).length === 5);
ok('日付の初期値は今日', h.includes('id="f-date" value="' + run('today()')));
h = run('viewForm("l1")');
ok('編集時に演目が入る', h.includes('value="芝浜"'));
ok('編集時に代数が入る', h.includes('value="五代目"'));
ok('編集時のタグが入る', run('JSON.stringify(form.tags)') === '["お見事","しんみり"]');
ok('編集時の評価が入る', run('form.rating') === 5);

console.log('\n== 印象タグの上限 ==');
run('form.tags = ["笑える","しんみり","こわい"]');
ok('3つで打ち止め（4つ目は増えない）', run(`
  var t="お見事", i=form.tags.indexOf(t);
  if(i<0 && form.tags.length < MAX_TAGS) form.tags.push(t);
  form.tags.length`) === 3);

console.log('\n== 集計 ==');
h = run('viewStats()');
ok('聴いた回数4', h.includes('<b>4</b>'));
ok('演目2 演者3', h.includes('<b>2</b>') && h.includes('<b>3</b>'));
ok('平均評価4.7（評価なしは計算から外す）', h.includes('<b>4.7</b>'));
ok('タグ延べ6個', h.includes('延べ 6個'));
ok('しんみり2件・33%', h.includes('2件 ・ 33%'));
ok('視聴方法に平均★が付く', h.includes('平均★4.5'));
ok('月別12本の棒', (h.match(/class="mcol"/g) || []).length === 12);
ok('未設定の注意は出ない', !h.includes('視聴方法が未設定'));

/* --- 保存の流れ ------------------------------------------------------
   入力欄が要るので、id ごとに値を返す偽の要素に差し替えて saveLog() を呼ぶ */
console.log('\n== 記録の保存 ==');
const FIELDS = {};
sandbox.document.querySelector = (sel) => {
  const e = el();
  if (sel in FIELDS) e.value = FIELDS[sel];
  if (sel === '#wrap-summary') e.hidden = FIELDS['#wrap-summary-hidden'] !== false;
  return e;
};
run('db = blankDb(); storageOK = true;');
run('viewForm(null); form.medium = "CD"; form.rating = 4; form.tags = ["笑える"];');
Object.assign(FIELDS, {
  '#f-work': ' 時そば ', '#f-name': ' 柳家小さん ', '#f-gen': '五代目',
  '#f-date': '2026-08-31', '#f-memo': ' そばの食べ方 ',
  '#f-summary': 'そば屋との銭の勘定でごまかす。', '#wrap-summary-hidden': false
});
run('saveLog()');
ok('演目が新しく登録される', run('db.works.length') === 1 && run('db.works[0].title') === '時そば');
ok('前後の空白は落ちる', run('db.performers[0].name') === '柳家小さん');
ok('新規演目のあらすじも入る', run('db.works[0].summary') === 'そば屋との銭の勘定でごまかす。');
ok('記録が1件できる', run('db.logs.length') === 1);
ok('視聴方法・評価・タグが入る',
  run('db.logs[0].medium') === 'CD' && run('db.logs[0].rating') === 4 &&
  run('JSON.stringify(db.logs[0].tags)') === '["笑える"]');
ok('保存後は演目のページへ飛ぶ', sandbox.location.hash === '#/work/' + run('db.works[0].id'));
ok('localStorage にも入る', JSON.parse(store['rakugo-log-v1']).logs.length === 1);

run('viewForm(null); form.medium = "寄席・ホール"; form.rating = 5; form.tags = [];');
FIELDS['#f-date'] = '2026-09-01';
FIELDS['#wrap-summary-hidden'] = true;
run('saveLog()');
ok('同じ演目は二重に登録されない', run('db.works.length') === 1);
ok('同じ演者は二重に登録されない', run('db.performers.length') === 1);
ok('記録だけ増える', run('db.logs.length') === 2);

/* 襲名の扱い。名前が同じでも代数が違えば別人 */
run('viewForm(null); form.medium = "CD"; form.rating = 3; form.tags = [];');
FIELDS['#f-gen'] = '六代目';
run('saveLog()');
ok('代数が違えば別の演者になる', run('db.performers.length') === 2);
ok('名前は同じ', run('db.performers[0].name') === run('db.performers[1].name'));

run('viewForm(null)');
FIELDS['#f-work'] = '   ';
const n0 = run('db.logs.length');
run('saveLog()');
ok('演目が空なら保存しない', run('db.logs.length') === n0);
FIELDS['#f-work'] = '時そば';

console.log('\n== 保存できない端末 ==');
run('storageOK = false');
run('viewForm(null); form.medium = "CD"; form.rating = 0; form.tags = [];');
run('saveLog()');
ok('画面は壊れず、その場では記録できる', run('db.logs.length') === n0 + 1);
run('storageOK = true');

/* --- 名前を直したときに記録が置き去りにならないこと ----------------------
   2026-09-01 に報告された不具合。記録の編集画面で演目名を書き換えると、
   演目が2つに割れてその記録1件だけが移ってしまっていた                    */
console.log('\n== 名前を直したときの引き継ぎ ==');

sandbox.fakeClick = (act, extra) => {
  const btn = el();
  btn.dataset = Object.assign({ act: act }, extra || {});
  return { target: { closest: () => btn } };
};

function seedTwo() {
  run(`
  db = {
    version: 1,
    performers: [{ id:'p1', name:'古今亭志ん生', gen:'五代目', photo:'', memo:'' }],
    works: [{ id:'w1', title:'お茶くみ', summary:'元のあらすじ' }],
    logs: [
      { id:'l1', workId:'w1', performerId:'p1', date:'2026-08-30', medium:'CD', rating:5, tags:[], memo:'一回目' },
      { id:'l2', workId:'w1', performerId:'p1', date:'2026-06-11', medium:'CD', rating:4, tags:[], memo:'二回目' }]
  };`);
}
/* 記録 l1 を編集して、演目名と代数を書き換えた状態を作る */
function editL1(title, gen) {
  run('viewForm("l1"); form.medium = "CD"; form.rating = 5; form.tags = [];');
  Object.assign(FIELDS, {
    '#f-work': title, '#f-name': '古今亭志ん生', '#f-gen': gen,
    '#f-date': '2026-08-30', '#f-memo': '一回目', '#wrap-summary-hidden': true
  });
  run('saveLog()');
}
const titlesOf = () => run('JSON.stringify(db.works.map(w=>w.title))');
const perfsOf = () => run('JSON.stringify(db.performers.map(p=>(p.gen||"")+p.name))');
const oneWork = () => run('new Set(db.logs.map(l=>l.workId)).size') === 1;

seedTwo();
editL1('お茶汲み', '五代目');
ok('演目名を書き換えたら、どちらのつもりか聞かれる', run('form.ask.queue.length') === 1);
ok('聞くのは演目のこと', run('form.ask.queue[0].kind') === 'work');
ok('まだ保存されていない', titlesOf() === '["お茶くみ"]');
run('onClick(fakeClick("ask", {a:"rename"}))');
ok('「名前を直す」→ 演目は1つのまま', titlesOf() === '["お茶汲み"]');
ok('「名前を直す」→ 記録2件とも新しい名前に付いてくる', run('db.logs.length') === 2 && oneWork());
ok('「名前を直す」→ あらすじも残る', run('db.works[0].summary') === '元のあらすじ');

seedTwo();
editL1('お茶汲み', '五代目');
run('onClick(fakeClick("ask", {a:"move"}))');
ok('「別の演目として分ける」→ 意図したときだけ分かれる', titlesOf() === '["お茶くみ","お茶汲み"]');
ok('「別の演目として分ける」→ 移るのはその記録だけ', !oneWork());

/* 襲名の代数を後から直すケース */
seedTwo();
editL1('お茶くみ', '六代目');
ok('代数だけ変えても聞かれる', run('form.ask.queue[0].kind') === 'perf');
run('onClick(fakeClick("ask", {a:"rename"}))');
ok('「名前を直す」→ 演者は1人のまま', perfsOf() === '["六代目古今亭志ん生"]');
ok('「名前を直す」→ その演者の記録2件とも付いてくる',
  run('new Set(db.logs.map(l=>l.performerId)).size') === 1);

/* 既にある演目名に変えたときは、聞かずにその演目へ付け替える */
seedTwo();
run(`db.works = db.works.concat([{id:'w2',title:'長屋の花見',summary:''}]);`);
editL1('長屋の花見', '五代目');
ok('既にある演目名なら聞かずに付け替える', run('form.ask') === null);
ok('演目は増えない', run('db.works.length') === 2);
ok('その記録だけが移る', run('db.logs.filter(l=>l.workId==="w2").length') === 1);

/* 新しい記録では聞かない（未登録の名前＝新規登録でよい） */
seedTwo();
run('viewForm(null); form.medium = "CD"; form.rating = 3; form.tags = [];');
Object.assign(FIELDS, { '#f-work': '時そば', '#f-name': '柳家小さん', '#f-gen': '',
  '#f-summary': '', '#wrap-summary-hidden': false });
run('saveLog()');
ok('新規の記録では聞かれない', run('form') === null || run('form && form.ask') === null);
ok('新規の記録では素直に登録される', run('db.works.length') === 2 && run('db.logs.length') === 3);

console.log('\n== 重複した演目・演者をまとめる ==');
seedTwo();
run(`db.works = db.works.concat([{id:'w2',title:'お茶汲み',summary:''}]);
     db.logs = db.logs.concat([{id:'l3',workId:'w2',performerId:'p1',date:'2026-07-01',medium:'DVD',rating:3,tags:[],memo:'三回目'}]);`);
FIELDS['#e-title'] = 'お茶汲み';
FIELDS['#e-summary'] = '元のあらすじ';
run('onClick(fakeClick("save-work", {id:"w1"}))');
ok('同じ名前にすると1つにまとまる', titlesOf() === '["お茶汲み"]');
ok('記録3件すべてが残る', run('db.logs.length') === 3 && oneWork());
ok('空だったあらすじを引き継ぐ', run('db.works[0].summary') === '元のあらすじ');
ok('残ったほうのページへ飛ぶ', sandbox.location.hash === '#/work/w2');

seedTwo();
run(`db.performers = db.performers.concat([{id:'p2',name:'古今亭志ん生',gen:'',photo:'',memo:''}]);
     db.logs = db.logs.concat([{id:'l3',workId:'w1',performerId:'p2',date:'2026-07-01',medium:'DVD',rating:3,tags:[],memo:'三回目'}]);`);
FIELDS['#e-name'] = '古今亭志ん生';
FIELDS['#e-gen'] = '五代目';
FIELDS['#e-memo'] = '名人';
run('onClick(fakeClick("save-perf", {id:"p2"}))');
ok('同じ名前＋代数にすると1人にまとまる', perfsOf() === '["五代目古今亭志ん生"]');
ok('記録3件すべてが残る（演者）',
  run('db.logs.length') === 3 && run('new Set(db.logs.map(l=>l.performerId)).size') === 1);
ok('空だったメモを引き継ぐ', run('db.performers[0].memo') === '名人');

console.log('\n== 記録なしの状態 ==');
sandbox.document.querySelector = () => el();
run('db = blankDb()');
ok('一覧が空の案内', run('viewList()').includes('まだ記録がありません'));
ok('集計が空の案内', run('viewStats()').includes('まだ記録がありません'));

console.log('\n== 保存と読み出し ==');
run(`
db = { version:1, performers:[{id:'p1',name:'あ',gen:'',photo:'',memo:''}], works:[{id:'w1',title:'い',summary:''}],
       logs:[{id:'l1',workId:'w1',performerId:'p1',date:'2026-01-01',medium:'CD',rating:3,tags:[],memo:''}] };
saveDb();
db = blankDb();
db = loadDb();
`);
ok('保存したものが読み戻せる', run('db.logs.length') === 1 && run('db.works[0].title') === 'い');
store['rakugo-log-v1'] = '{こわれたJSON';
run('db = loadDb()');
ok('壊れた保存データでも落ちない', run('db.logs.length') === 0);
ok('壊れた中身は退避される', Object.keys(store).some((k) => k.indexOf('-broken-') > 0));

console.log(ng === 0 ? '\nすべて通りました。' : '\n' + ng + '件 失敗しました。');
process.exit(ng ? 1 : 0);
