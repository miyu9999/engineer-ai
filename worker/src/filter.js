// 出力の禁止語チェック（engineer-ai-spec.md 3章の「二重の保険」の2つ目）。
// index.jsのWorkersエントリポイントとは分離している
// （Workers runtimeはエントリファイルの名前付きexportをハンドラとして解釈するため、
//  テスト用の定数・関数をindex.js側にexportすると起動エラーになる）。
//
// 叩き台の禁止語リスト。本番投入前にmedical部門のレビューが必要。10ケースでの検証結果は test-cases.md 参照。
export const NG_WORDS = [
  // 病名・症状名
  'うつ', '抑うつ', 'メンタル不調', '適応障害', '不安障害', '双極性障害',
  '統合失調症', 'パニック障害', '睡眠障害', 'PTSD', '燃え尽き症候群', 'バーンアウト',
  // 医療的判断
  '診断', '休職', '受診', '就業制限', '業務制限', '就業可否', '通院',
  // 資格を騙る表現
  '産業医',
];

export const FALLBACK_MESSAGE =
  '申し訳ございません、この件についてはAIから回答できません。気になる場合はご相談ください。';

export function containsNgWord(text) {
  return NG_WORDS.some((word) => text.includes(word));
}
