# エンジニアAI（外向け：AI改善提案）

業種・業務を入力すると、AIが「どの業務を、どんなツールで、どのくらいの手間で減らせるか」を提案するツール。社内コードネーム「産業医エンジニアAI」。

shindan-checker（シゴト健診）とは**別システム**（2026-09-28 Owner判断：診断チェッカー本体には手を入れず、完全に独立したツールとして開発）。連携方法は未定。

## ステータス

- **Workers中継（v1提案＋v1.1試作品）は本番デプロイ済み。フロントエンド（index.html）は未公開**（2026-09-28時点）
- 仕様：[engineer-ai-spec.md](engineer-ai-spec.md)（v1本文＋末尾「v1.1 追加仕様」）
- v1（テキストでの改善提案）：
  1. Workers中継をローカルで作成、モック応答で動作確認済み
  2. 同意ボタン・結果表示付きの単体フロントエンド（`index.html`）を作成、ブラウザ実動作確認済み
  3. システムプロンプト作成（[system-prompt.md](system-prompt.md)）＋架空ケース10件で禁止語フィルタの動作確認済み。本物のAPIでも再検証済み（[test-cases.md](test-cases.md)）。実APIでのみ判明した不具合（JSONがコードフェンスで返ってきてパース失敗）も発見・修正済み
  4. Cloudflare Workers本番デプロイ済み。レート制限をインメモリからKVに置き換え済み。`ANTHROPIC_API_KEY`はCloudflare Secretとして設定済み
- v1.1（その場で動く試作品を作る）：
  - Worker：`POST /prototype`エンドポイント追加。提案と試作品でレート制限カウンタを分離（`kind:global:date`/`kind:ip:date`形式）。入力の長さ・件数バリデーション追加
  - システムプロンプトを`src/prompts.js`に分離し、提案用・試作品用の2本立てに（[system-prompt.md](system-prompt.md)参照）
  - フロント：各提案に「この案の試作品を作る」ボタン→隔離枠（`sandbox="allow-scripts"`のiframe、`srcdoc`はDOM経由で設定）でプレビュー→CSP差し込みで外部通信を遮断→HTMLダウンロード→相談導線（Gmailへのmailtoリンク、`quruquru99999@gmail.com`）
  - 実API（`claude-sonnet-5`）で検証済み（[test-cases-prototype.md](test-cases-prototype.md)）。通常ケース（試作品が実際にブラウザで動作、外部通信なしを確認）・断るべきケース（健康/ストレス記録系のツール依頼を正しく拒否）の両方をブラウザ実行で確認
  - 実装中に見つけたバグ：モデルが`thinking`ブロックを先に返すことがあり、`content[0]`決め打ちだとJSON抽出に失敗していた。`type: 'text'`のブロックを探す形に修正（両エンドポイントに影響していたため修正の効果は提案側にも及ぶ）
  - **本番デプロイ・動作確認済み**：`https://engineer-ai-relay.quruquru99999.workers.dev`（`/`と`/prototype`の両方）。公開後1週間は様子見のため、提案`DAILY_LIMIT_TOTAL=5`・試作品`PROTOTYPE_DAILY_LIMIT_TOTAL=3`に絞ってある（`worker/wrangler.toml`）
- **残り**：フロントエンド（`index.html`）をGitHub Pagesなどで公開（新規リポジトリ作成が必要、Owner確認の上で実施）。集計機能（v1.1「v1.1でもやらないこと」参照）は別タスク

## ファイル構成

- `index.html`：フロントエンド（業種・業務入力→AI提案表示→試作品生成・プレビュー・ダウンロード、単体で動作）
- `worker/`：Cloudflare Workers中継
  - `src/index.js`：Origin確認・ルーティング（`/`＝提案、`/prototype`＝試作品）・回数制限（種別ごとに分離）・`ANTHROPIC_API_KEY`があれば実API呼び出し／なければモック応答
  - `src/prompts.js`：提案用・試作品用システムプロンプト
  - `src/filter.js`：出力の禁止語チェック（二重の保険。試作品のhtml本文も対象）
- `system-prompt.md`：システムプロンプト2本（`worker/src/prompts.js`と同内容）
- `test-cases.md`／`verify-cases.mjs`：提案の架空ケース10件の検証結果とスクリプト
- `test-cases-prototype.md`：試作品の架空ケース検証結果

## 注意

- 禁止語リスト（`worker/src/filter.js`内`NG_WORDS`）はengineer-ai-spec.md 3章の例をもとにした叩き台。医師法まわりの最終判断はmedical部門のレビューが必要
- `index.html`の`AI_RELAY_URL`は本番Worker URLを指している。**フロントエンドをローカルで動かすUIテストをするときは、一時的に`http://localhost:8787`に戻し、確認後に本番URLへ戻すこと**（本番Originチェックの都合上、localhostからは直接本番Workerを呼べない）
- `worker/.dev.vars`（git管理外）に本物のAPIキーを保存している。ローカルで`wrangler dev`すると実際にAnthropic APIを呼ぶので、テスト時はコール回数に注意
- Cloudflare KVのレート制限カウンタは日付キーで2日後に自動失効する。テストで消費した分を戻したい場合は`wrangler kv key delete <キー名> --namespace-id d68cdca97fb94c068c60f99f092f45ed --remote`で手動リセット可能
