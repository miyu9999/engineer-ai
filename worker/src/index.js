// エンジニアAI Workers中継
// env.ANTHROPIC_API_KEYが設定されていれば実際にAnthropic APIを呼ぶ。
// 未設定（ローカル確認時など）はモック応答を返す。
//
// POST /          : 業務改善の提案（最大3件）
// POST /prototype : 提案1件をもとに、ブラウザで動く試作品HTMLを生成
import { containsNgWord, FALLBACK_MESSAGE } from './filter.js';
import { SUGGEST_SYSTEM_PROMPT, PROTOTYPE_SYSTEM_PROMPT } from './prompts.js';

const RATE_LIMIT_MESSAGE = '本日の受付は終了しました。明日またお試しください。';
const UPSTREAM_ERROR_MESSAGE = 'ただいま混み合っています。時間をおいて再度お試しください。';
const INVALID_INPUT_MESSAGE = '入力内容を確認してください。';

const MAX_TASK_NAME_LENGTH = 50;
const MAX_TASKS = 10;

function todayKeyJST() {
  const now = new Date();
  const jst = new Date(now.getTime() + 9 * 60 * 60 * 1000);
  return jst.toISOString().slice(0, 10);
}

// KVは結果整合性（反映まで数秒〜数十秒かかることがある）で、同時アクセス時に
// カウントがわずかにずれる可能性がある。このアプリの回数制限は予算超過を防ぐための
// 目安であり、1回単位の厳密性より「桁違いに呼ばれない」ことが重要なため許容する。
// 日付キーは2日でexpireするので、古いカウンタの掃除は不要。
const KV_TTL_SECONDS = 60 * 60 * 24 * 2;

async function getCount(env, key) {
  const value = await env.RATE_LIMIT_KV.get(key);
  return value ? Number(value) : 0;
}

async function increment(env, key, currentCount) {
  await env.RATE_LIMIT_KV.put(key, String(currentCount + 1), { expirationTtl: KV_TTL_SECONDS });
}

// 呼び出し種別ごとにカウンタを分ける（提案と試作品でコストが大きく違うため）。
// 制限に達している場合はカウンタを増やさずに拒否する。
async function checkAndConsumeRateLimit(env, kind, ip, totalLimit, perUserLimit) {
  const date = todayKeyJST();
  const globalKey = `${kind}:global:${date}`;
  const userKey = `${kind}:ip:${ip}:${date}`;

  const [globalCount, userCount] = await Promise.all([
    getCount(env, globalKey),
    getCount(env, userKey),
  ]);
  if (globalCount >= totalLimit || userCount >= perUserLimit) {
    return false;
  }

  await Promise.all([
    increment(env, globalKey, globalCount),
    increment(env, userKey, userCount),
  ]);
  return true;
}

function validateTasks(tasks) {
  if (!Array.isArray(tasks) || tasks.length === 0 || tasks.length > MAX_TASKS) return false;
  return tasks.every((t) => typeof t?.name === 'string' && t.name.length > 0 && t.name.length <= MAX_TASK_NAME_LENGTH);
}

// モデルが指示に反してJSONを```json ... ```で囲んで返すことがあるため、そのフェンスだけ取り除く。
function stripCodeFence(text) {
  const trimmed = text.trim();
  const match = trimmed.match(/^```(?:json)?\s*([\s\S]*?)\s*```$/);
  return match ? match[1] : trimmed;
}

async function callAnthropic(systemPrompt, userPayload, env, maxTokens) {
  const res = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'x-api-key': env.ANTHROPIC_API_KEY,
      'anthropic-version': '2023-06-01',
    },
    body: JSON.stringify({
      model: 'claude-sonnet-5',
      max_tokens: maxTokens,
      system: systemPrompt,
      messages: [{ role: 'user', content: JSON.stringify(userPayload) }],
    }),
  });
  if (!res.ok) {
    throw new Error(`anthropic api error: ${res.status}`);
  }
  const data = await res.json();
  // content[0]は`thinking`ブロックのことがあるため、type:'text'のブロックを探す。
  const textBlock = data.content?.find((block) => block.type === 'text');
  return JSON.parse(stripCodeFence(textBlock?.text ?? ''));
}

// ANTHROPIC_API_KEY未設定時のモック応答（ローカル確認用）
function buildMockSuggestions(payload) {
  const taskName = payload?.tasks?.[0]?.name ?? '業務の転記作業';
  return {
    suggestions: [
      {
        task: taskName,
        idea: 'Googleフォーム＋スプレッドシートで自動集計',
        effort: '小',
        expectedReduction: '週1〜2時間',
      },
    ],
    note: '自社向けに具体化したい場合はご相談ください。',
  };
}

function buildMockPrototype(payload) {
  const taskName = payload?.task?.name ?? '業務';
  return {
    declined: false,
    html: `<!DOCTYPE html>\n<html lang="ja"><head><meta charset="UTF-8"><title>${taskName} 試作品（モック）</title></head><body><h1>${taskName}の試作品（モック応答）</h1><p>ANTHROPIC_API_KEY未設定時のローカル確認用ダミーです。</p></body></html>`,
    filename: 'prototype.html',
    description: `${taskName}のモック試作品`,
  };
}

function corsHeaders(origin, allowedOrigin) {
  const headers = {
    'Access-Control-Allow-Methods': 'POST, OPTIONS',
    'Access-Control-Allow-Headers': 'Content-Type',
  };
  if (origin === allowedOrigin) {
    headers['Access-Control-Allow-Origin'] = allowedOrigin;
  }
  return headers;
}

function jsonResponse(body, status, headers) {
  return new Response(JSON.stringify(body), { status, headers });
}

async function handleSuggest(payload, env, ip, headers) {
  if (!payload?.industry || !validateTasks(payload.tasks)) {
    return jsonResponse({ ok: false, reason: 'invalid_input', message: INVALID_INPUT_MESSAGE }, 200, headers);
  }

  const totalLimit = Number(env.DAILY_LIMIT_TOTAL || 15);
  const perUserLimit = Number(env.DAILY_LIMIT_PER_USER || 2);
  const allowed = await checkAndConsumeRateLimit(env, 'suggest', ip, totalLimit, perUserLimit);
  if (!allowed) {
    return jsonResponse({ ok: false, reason: 'rate_limited', message: RATE_LIMIT_MESSAGE }, 200, headers);
  }

  let result;
  try {
    result = env.ANTHROPIC_API_KEY
      ? await callAnthropic(SUGGEST_SYSTEM_PROMPT, payload, env, 1000)
      : buildMockSuggestions(payload);
  } catch (e) {
    return jsonResponse({ ok: false, reason: 'upstream_error', message: UPSTREAM_ERROR_MESSAGE }, 200, headers);
  }

  if (containsNgWord(JSON.stringify(result))) {
    return jsonResponse({ ok: false, reason: 'ng_word', message: FALLBACK_MESSAGE }, 200, headers);
  }

  return jsonResponse({ ok: true, ...result }, 200, headers);
}

async function handlePrototype(payload, env, ip, headers) {
  const taskName = payload?.task?.name;
  const idea = payload?.suggestion?.idea;
  if (!payload?.industry || typeof taskName !== 'string' || taskName.length === 0 ||
      taskName.length > MAX_TASK_NAME_LENGTH || typeof idea !== 'string' || idea.length === 0) {
    return jsonResponse({ ok: false, reason: 'invalid_input', message: INVALID_INPUT_MESSAGE }, 200, headers);
  }

  const totalLimit = Number(env.PROTOTYPE_DAILY_LIMIT_TOTAL || 8);
  const perUserLimit = Number(env.PROTOTYPE_DAILY_LIMIT_PER_USER || 1);
  const allowed = await checkAndConsumeRateLimit(env, 'prototype', ip, totalLimit, perUserLimit);
  if (!allowed) {
    return jsonResponse({ ok: false, reason: 'rate_limited', message: RATE_LIMIT_MESSAGE }, 200, headers);
  }

  let result;
  try {
    result = env.ANTHROPIC_API_KEY
      ? await callAnthropic(PROTOTYPE_SYSTEM_PROMPT, payload, env, 6000)
      : buildMockPrototype(payload);
  } catch (e) {
    return jsonResponse({ ok: false, reason: 'upstream_error', message: UPSTREAM_ERROR_MESSAGE }, 200, headers);
  }

  if (containsNgWord(JSON.stringify(result))) {
    return jsonResponse({ ok: false, reason: 'ng_word', message: FALLBACK_MESSAGE }, 200, headers);
  }

  if (result.declined) {
    return jsonResponse({ ok: false, reason: 'declined', message: result.declineReason || FALLBACK_MESSAGE }, 200, headers);
  }

  return jsonResponse({ ok: true, html: result.html, filename: result.filename, description: result.description }, 200, headers);
}

export default {
  async fetch(request, env) {
    const allowedOrigin = env.ALLOWED_ORIGIN;
    const origin = request.headers.get('Origin') || '';

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders(origin, allowedOrigin) });
    }

    if (request.method !== 'POST') {
      return new Response('Method Not Allowed', { status: 405 });
    }

    if (origin !== allowedOrigin) {
      return jsonResponse({ ok: false, reason: 'forbidden_origin' }, 403, { 'Content-Type': 'application/json' });
    }

    const headers = { 'Content-Type': 'application/json', ...corsHeaders(origin, allowedOrigin) };

    let payload;
    try {
      payload = await request.json();
    } catch {
      return jsonResponse({ ok: false, reason: 'invalid_json' }, 400, headers);
    }

    const ip = request.headers.get('CF-Connecting-IP') || 'unknown';
    const path = new URL(request.url).pathname;

    if (path === '/prototype') {
      return handlePrototype(payload, env, ip, headers);
    }
    return handleSuggest(payload, env, ip, headers);
  },
};
