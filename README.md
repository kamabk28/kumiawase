# Ensemble Board

吹奏楽部の組み合わせ練習を、スマートフォンから共有・管理するWebアプリです。

- GitHub Pagesでフロントエンドを公開
- Google Apps Scriptを認証付きWeb APIとして使用
- Googleスプレッドシートへ無料で保存
- Cloudflare Turnstileでログイン時のボット対策
- 最後の利用から90日間は同じブラウザで再入力不要
- 予定の登録・編集、時間／部屋の重複チェック
- 10秒以内の削除取り消し
- 過去予定のアーカイブ表示
- スマートフォンはカード表示、PCは2列表示

## デモ

セットアップ前でも、URLの末尾に `?demo=1` を付けるとサンプルデータで操作を確認できます。

```text
https://kamabk28.github.io/ensemble-practice-board/?demo=1
```

デモで行った変更は保存されません。

## 構成

```text
index.html             メイン画面
setup.html             パスワード設定値のローカル生成ツール
css/                   画面デザイン
js/                    UI・API通信・入力検証
gas/Code.gs            GASバックエンド
gas/appsscript.json    GASマニフェスト
tests/                 自動テスト
```

実際の通信は次の流れです。

```text
GitHub Pages → GAS Web API → Google Spreadsheet
                  ↓
          Cloudflare Turnstile検証
```

## 初期設定

[SETUP.md](SETUP.md) の手順に沿って、Turnstile、スプレッドシート、GAS、フロントエンド設定を接続してください。秘密情報をリポジトリへ保存する手順はありません。

## 開発と確認

Node.js 20以上で実行します。追加パッケージのインストールは不要です。

```bash
npm test
npm run check
```

ローカル表示は任意の静的HTTPサーバーを使用し、`?demo=1` を付けて開きます。

```bash
python -m http.server 4173
```

## セキュリティ上の考え方

- パスワード自体はブラウザにもGitHubにも保存しません。
- GASにはソルト付きハッシュだけを保存します。
- 認証後のブラウザには、GASが署名した期限付きトークンだけを保存します。
- すべての予定APIはトークンをサーバー側で検証します。
- Turnstile秘密鍵とセッション署名鍵はGASのスクリプトプロパティだけに保存します。
- ユーザー入力はHTMLとして挿入せず、テキストとして描画します。
- 削除は行削除ではなく論理削除とし、変更履歴も残します。

共有パスワード方式のため、パスワードを知っている人は全員同じ権限です。個人を特定する監査や、利用者ごとの権限分けは行いません。
