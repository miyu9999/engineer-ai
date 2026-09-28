// エンジニアAI 共通アプリロジック。
// 各入口ページ（index.html / kaigo/index.html / hoiku/index.html）から
// data.js の後に読み込まれ、#app に画面を描画する。
// ページ側で `const PRESET_INDUSTRY = 'kaigo';`（またはnull）を先に定義しておくと、
// その業種を初期選択した状態で表示する。

const AI_RELAY_URL = 'https://engineer-ai-relay.quruquru99999.workers.dev';
const CONSULT_EMAIL = 'quruquru99999@gmail.com';

let mode = 'individual'; // 'individual' | 'enterprise'
let taskCounter = 0;
let lastPayload = null; // 提案取得時に送った内容（試作品リクエストの元データ）
let lastSuggestions = []; // 直近の提案一覧（試作品ボタンから参照するため）

function renderApp() {
  document.getElementById('app').innerHTML = `
    <div class="mode-tabs">
      <div class="mode-tab ${mode === 'individual' ? 'active' : ''}" onclick="setMode('individual')">個人で使う</div>
      <div class="mode-tab ${mode === 'enterprise' ? 'active' : ''}" onclick="setMode('enterprise')">会社で使う</div>
    </div>
    <div id="mode-body"></div>
  `;
  renderModeBody();
}

function setMode(next) {
  mode = next;
  renderApp();
}

function renderModeBody() {
  const el = document.getElementById('mode-body');
  el.innerHTML = mode === 'individual' ? individualHtml() : enterpriseHtml();
  if (mode === 'individual') {
    initIndividualMode();
  }
}

function enterpriseHtml() {
  return `
    <div class="card enterprise-placeholder">
      <h2>会社で使う</h2>
      <p class="sub">従業員の回答を集計して、会社全体の負担が大きい業務から改善提案・試作品を作る機能を準備中です。</p>
      <p class="sub">ご興味があれば、まずはご相談ください。一緒に業務内容をヒアリングしながら進めます。</p>
      <a href="mailto:${CONSULT_EMAIL}?subject=${encodeURIComponent('エンジニアAI 会社での利用について相談')}"><button type="button">${CONSULT_EMAIL} に相談する</button></a>
    </div>
  `;
}

function individualHtml() {
  return `
    <div class="card">
      <h2>1. 業種・役割</h2>
      <label class="field-label" for="input-industry">業種</label>
      <select id="input-industry" onchange="onIndustryChange()"></select>
      <input type="text" id="input-industry-other" placeholder="業種を入力してください" style="display:none;">

      <label class="field-label" for="input-role">役割</label>
      <select id="input-role" onchange="onRoleChange()"></select>
      <input type="text" id="input-role-other" placeholder="役割を入力してください" style="display:none;">
    </div>

    <div class="card">
      <h2>2. 業務</h2>
      <p class="sub">負荷を感じている業務を入力してください。複数追加できます。</p>
      <div id="task-list"></div>
      <button class="secondary" onclick="addTaskRow()">＋ 業務を追加</button>
    </div>

    <div class="card">
      <h2>3. AIに改善案を聞く</h2>
      <div class="note-box">
        <p>AI（Anthropic Claude）が「どの業務を、どんなツールで、どのくらいの手間で減らせるか」を提案します。健康状態の評価や診断、休職・受診の判断は行いません。</p>
        <p style="font-size:0.8rem;margin-top:8px;">送る項目：業種・役割・入力した業務名・各業務の時間（概算）・つらい理由（選択肢と自由記述）。氏名・会社名・メールなど個人を特定できる情報は入力欄自体がなく、送信されません。<strong>自由記述欄に氏名や病名など人を特定できる情報は書かないでください。</strong></p>
      </div>
      <div style="margin-top:14px;">
        <button id="ai-consent-button" onclick="requestAiSuggestions()">AIに改善案を聞く（回答内容を送信します）</button>
      </div>
      <div id="ai-result"></div>
    </div>
  `;
}

function initIndividualMode() {
  const industrySelect = document.getElementById('input-industry');
  industrySelect.innerHTML =
    INDUSTRIES.map(ind => `<option value="${ind.id}">${ind.name}</option>`).join('') +
    `<option value="other">${OTHER_VALUE}</option>`;

  if (PRESET_INDUSTRY && INDUSTRIES.some(ind => ind.id === PRESET_INDUSTRY)) {
    industrySelect.value = PRESET_INDUSTRY;
  }
  onIndustryChange();

  taskCounter = 0;
  document.getElementById('task-list').innerHTML = '';
  addTaskRow();
}

function onIndustryChange() {
  const industrySelect = document.getElementById('input-industry');
  const otherInput = document.getElementById('input-industry-other');
  const isOther = industrySelect.value === 'other';
  otherInput.style.display = isOther ? '' : 'none';

  const roleSelect = document.getElementById('input-role');
  const industry = INDUSTRIES.find(ind => ind.id === industrySelect.value);
  const roles = industry ? industry.roles : [];
  roleSelect.innerHTML =
    roles.map(r => `<option value="${r}">${r}</option>`).join('') +
    `<option value="other">${OTHER_VALUE}</option>`;
  onRoleChange();
}

function onRoleChange() {
  const roleSelect = document.getElementById('input-role');
  const otherInput = document.getElementById('input-role-other');
  otherInput.style.display = roleSelect.value === 'other' ? '' : 'none';
}

function resolveIndustryName() {
  const select = document.getElementById('input-industry');
  if (select.value === 'other') {
    return document.getElementById('input-industry-other').value.trim();
  }
  const industry = INDUSTRIES.find(ind => ind.id === select.value);
  return industry ? industry.name : '';
}

function resolveRoleName() {
  const select = document.getElementById('input-role');
  if (select.value === 'other') {
    return document.getElementById('input-role-other').value.trim();
  }
  return select.value;
}

function addTaskRow() {
  const id = 'task-' + (taskCounter++);
  const wrapper = document.createElement('div');
  wrapper.className = 'task-card';
  wrapper.id = id;
  wrapper.innerHTML = `
    <button class="remove-btn" onclick="document.getElementById('${id}').remove()">削除</button>
    <label class="field-label">業務名</label>
    <input type="text" class="task-name-input" placeholder="例：日報の転記">
    <label class="field-label">週あたりの時間</label>
    <select class="task-hours-input">
      ${HOURS_OPTIONS.map(h => `<option value="${h}">${h}</option>`).join('')}
    </select>
    <label class="field-label">つらいと感じる理由（複数選択可）</label>
    <div class="reason-options">
      ${REASONS.map((r, i) => `<label><input type="checkbox" class="task-reason-input" value="${r}"> ${r}</label>`).join('')}
    </div>
    <label class="field-label" style="margin-top:8px;">その他の理由（自由記述、任意）</label>
    <input type="text" class="task-reason-other-input" placeholder="当てはまるものがなければ自由にご記入ください">
    <p class="free-text-caution">氏名・病名など人を特定できる情報は書かないでください</p>
  `;
  document.getElementById('task-list').appendChild(wrapper);
}

function collectTasks() {
  return Array.from(document.querySelectorAll('#task-list .task-card')).map(card => {
    const name = card.querySelector('.task-name-input').value.trim();
    const hours = card.querySelector('.task-hours-input').value;
    const reasons = Array.from(card.querySelectorAll('.task-reason-input:checked')).map(cb => cb.value);
    const otherReason = card.querySelector('.task-reason-other-input').value.trim();
    if (otherReason) reasons.push(otherReason);
    return { name, hours, reasons };
  }).filter(t => t.name);
}

function buildAiPayload() {
  return {
    industry: resolveIndustryName(),
    role: resolveRoleName(),
    tasks: collectTasks(),
  };
}

async function requestAiSuggestions() {
  const payload = buildAiPayload();
  if (!payload.industry || payload.tasks.length === 0) {
    alert('業種と、業務を1つ以上入力してください');
    return;
  }
  lastPayload = payload;

  const button = document.getElementById('ai-consent-button');
  const resultBox = document.getElementById('ai-result');
  button.disabled = true;
  button.textContent = '送信中…';
  resultBox.innerHTML = '';

  try {
    const res = await fetch(AI_RELAY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(payload),
    });
    const data = await res.json();
    renderAiResult(data);
  } catch (e) {
    resultBox.innerHTML = '<p class="sub">通信に失敗しました。時間をおいて再度お試しください。</p>';
  } finally {
    button.disabled = false;
    button.textContent = 'AIに改善案を聞く（回答内容を送信します）';
  }
}

function renderAiResult(data) {
  const resultBox = document.getElementById('ai-result');
  if (!data.ok) {
    resultBox.innerHTML = `<p class="sub">${data.message || 'ただいまご利用いただけません。'}</p>`;
    return;
  }
  lastSuggestions = data.suggestions || [];
  const items = lastSuggestions.map((s, i) => `
    <div class="result-item">
      <div class="task-name">${s.task}</div>
      <div>${s.idea}</div>
      <div class="sub">導入の手間：${s.effort} ／ 見込み削減：${s.expectedReduction}</div>
      <div class="prototype-area" id="prototype-area-${i}">
        <button class="secondary" onclick="requestPrototype(${i})">この案の試作品を作る</button>
      </div>
    </div>
  `).join('');
  const noteHtml = data.note ? `<p class="sub" style="margin-top:10px;">${data.note}</p>` : '';
  resultBox.innerHTML = items + noteHtml;
}

// 試作品HTMLの前にCSPを差し込み、外部通信をブロックする（sandbox属性と合わせた二重の安全対策）。
function injectCsp(html) {
  const csp = '<meta http-equiv="Content-Security-Policy" content="default-src \'none\'; script-src \'unsafe-inline\'; style-src \'unsafe-inline\' \'self\'; img-src data:; connect-src \'none\'; form-action \'none\';">';
  if (/<head[^>]*>/i.test(html)) {
    return html.replace(/<head[^>]*>/i, (m) => m + csp);
  }
  if (/<html[^>]*>/i.test(html)) {
    return html.replace(/<html[^>]*>/i, (m) => m + '<head>' + csp + '</head>');
  }
  return csp + html;
}

// 実在の方の情報を入力してしまうのを防ぐ注意書き。AIに生成させず固定文言をフロント側で差し込む
// （medical部門レビュー：ケア記録系の試作品で本物の個人情報を入力させないため）。
function injectSafetyBanner(html) {
  const banner = '<div style="background:#fff3cd;color:#664d03;padding:8px 12px;font-size:12px;font-family:sans-serif;border-bottom:1px solid #ffe69c;">⚠️ これはAIが作った試作品です。実在する方の氏名・個人情報は入力しないでください（見本のダミーデータでお試しください）。</div>';
  if (/<body[^>]*>/i.test(html)) {
    return html.replace(/<body[^>]*>/i, (m) => m + banner);
  }
  return banner + html;
}

async function requestPrototype(index) {
  const area = document.getElementById(`prototype-area-${index}`);
  const suggestion = lastSuggestions[index];
  if (!lastPayload || !suggestion) return;
  const task = lastPayload.tasks.find(t => t.name === suggestion.task) || lastPayload.tasks[0];

  area.innerHTML = '<p class="sub">試作品を作成中…（30秒〜1分ほどかかります）</p>';

  try {
    const res = await fetch(AI_RELAY_URL + '/prototype', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        industry: lastPayload.industry,
        role: lastPayload.role,
        task,
        suggestion,
      }),
    });
    const data = await res.json();
    renderPrototypeResult(area, data);
  } catch (e) {
    area.innerHTML = '<p class="sub">通信に失敗しました。時間をおいて再度お試しください。</p>';
  }
}

function renderPrototypeResult(area, data) {
  if (!data.ok) {
    area.innerHTML = `<p class="sub">${data.message || 'この案の試作品は作成できませんでした。'}</p>`;
    return;
  }

  const safeHtml = injectSafetyBanner(injectCsp(data.html));
  const blobUrl = URL.createObjectURL(new Blob([safeHtml], { type: 'text/html' }));
  const filename = data.filename || 'prototype.html';
  const subject = encodeURIComponent('エンジニアAI 試作品について相談');
  const body = encodeURIComponent(`「${data.description || ''}」の試作品について相談したいです。\n\n（差し支えなければ、業種・やりたいことを教えてください）`);

  area.innerHTML = `
    <p class="sub proto-description"></p>
    <div class="proto-frame-slot"></div>
    <div class="prototype-actions">
      <a href="${blobUrl}" download="${filename}"><button class="secondary" type="button">HTMLをダウンロード</button></a>
    </div>
    <div class="prototype-consult">
      これはAIが作った試作品です。本番で使える形にしたい場合はご相談ください。<br>
      <a href="mailto:${CONSULT_EMAIL}?subject=${subject}&body=${body}">${CONSULT_EMAIL} に相談する</a>
    </div>
  `;
  area.querySelector('.proto-description').textContent = data.description || '';

  // srcdocを属性文字列として組み立てるとエスケープが崩れやすいため、DOM経由で直接設定する。
  const iframe = document.createElement('iframe');
  iframe.className = 'prototype-frame';
  iframe.setAttribute('sandbox', 'allow-scripts');
  area.querySelector('.proto-frame-slot').appendChild(iframe);
  iframe.srcdoc = safeHtml;
}

renderApp();
