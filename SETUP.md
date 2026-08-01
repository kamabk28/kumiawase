# Ensemble Board 初期設定

設定は、Cloudflare Turnstile → Googleスプレッドシート／GAS → GitHub Pagesの順で行います。パスワードや秘密鍵をGitHubへ書き込まないでください。

## 1. Cloudflare Turnstileを作る

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)へログインします。
2. 左側の「Turnstile」からウィジェットを追加します。
3. 名前を `Ensemble Board`、ウィジェットモードを `Managed` にします。
4. 許可するホスト名に `kamabk28.github.io` を追加します。
5. 作成後に表示される「サイトキー」と「秘密鍵」を一時的に控えます。

サイトキーは公開情報なので、後で `js/config.js` に書きます。秘密鍵はGASのスクリプトプロパティだけに保存します。

## 2. パスワード用の設定値を作る

GitHub Pagesの `setup.html` を開きます。公開前はローカルHTTPサーバーから開いても構いません。

1. 部員へ共有するパスワードを入力します。
2. ホスト名が `kamabk28.github.io` になっていることを確認します。
3. 「設定値を生成」を押します。
4. 表示された5項目を一時的に控えます。

生成される項目は次のとおりです。

| プロパティ | 内容 |
|---|---|
| `PASSWORD_SALT` | パスワードハッシュ用のランダム値 |
| `PASSWORD_HASH` | パスワードのハッシュ |
| `SESSION_SECRET` | 90日認証トークンの署名鍵 |
| `SESSION_VERSION` | セッションの世代。最初は `1` |
| `ALLOWED_HOSTNAME` | Turnstileを許可するホスト名 |

入力したパスワード自体は送信・保存されません。

## 3. GoogleスプレッドシートとGASを作る

1. Googleスプレッドシートを新規作成し、名前を `Ensemble Board Data` などにします。
2. 「拡張機能」→「Apps Script」を開きます。
3. `gas/Code.gs` の内容をApps Scriptの `コード.gs` へ貼り付けます。
4. Apps Script左側の「プロジェクトの設定」でマニフェスト表示を有効にします。
5. `appsscript.json` を開き、`gas/appsscript.json` の内容に置き換えます。

次に「プロジェクトの設定」→「スクリプト プロパティ」へ以下を追加します。

| プロパティ | 値 |
|---|---|
| `PASSWORD_SALT` | 手順2で生成した値 |
| `PASSWORD_HASH` | 手順2で生成した値 |
| `SESSION_SECRET` | 手順2で生成した値 |
| `SESSION_VERSION` | `1` |
| `ALLOWED_HOSTNAME` | `kamabk28.github.io` |
| `TURNSTILE_SECRET` | Cloudflareで発行された秘密鍵 |

`SPREADSHEET_ID` は次の操作で自動設定されるため、手入力は不要です。

## 4. シートを初期化する

1. Apps Script上部の関数選択から `setupSheets` を選びます。
2. 「実行」を押します。
3. Googleの権限確認画面が出たら、このスプレッドシートと外部通信の権限を許可します。
4. 元のスプレッドシートに `Schedules`、`Settings`、`ChangeLog` が作られたことを確認します。
5. 必要なら `getSetupStatus` を実行し、ログの `ready` が `true` か確認します。

楽器や部屋を後から増やしたい場合は、`Settings` シートへ行を追加できます。`enabled` は `TRUE` にします。「その他」の自由入力は設定不要です。

## 5. GASをWeb APIとして公開する

1. Apps Script右上の「デプロイ」→「新しいデプロイ」を押します。
2. 種類は「ウェブアプリ」を選択します。
3. 「次のユーザーとして実行」は自分を選びます。
4. 「アクセスできるユーザー」は `全員` を選びます。
5. デプロイし、末尾が `/exec` のWebアプリURLをコピーします。

学校のGoogle Workspaceで「全員」を選べない場合は、個人GoogleアカウントでスプレッドシートとGASを作る必要があります。

GASコードを後で変更した場合は、「デプロイを管理」→鉛筆アイコン→「新バージョン」で更新してください。コードを保存しただけでは公開版へ反映されません。

## 6. GitHub Pages側を接続する

GitHubの `js/config.js` を編集します。

```js
window.APP_CONFIG = Object.freeze({
  apiUrl: "ここにGASの/exec URL",
  turnstileSiteKey: "ここにTurnstileのサイトキー",
  pollIntervalMs: 30_000,
  requestTimeoutMs: 20_000,
  sessionStorageKey: "ensemble-board-session-v1",
  undoStorageKey: "ensemble-board-undo-v1",
});
```

秘密鍵ではなく「サイトキー」を書く点に注意してください。変更を `main` ブランチへ反映すると、GitHub Actionsがテスト後にPagesへ公開します。

公開URLは次の予定です。

```text
https://kamabk28.github.io/ensemble-practice-board/
```

## パスワードを変更する

1. `setup.html` で新しいパスワードから `PASSWORD_SALT` と `PASSWORD_HASH` を生成します。
2. GASのスクリプトプロパティで2項目を置き換えます。
3. `SESSION_VERSION` を現在の数字から1つ増やします。

これで、以前ログインしていた全ブラウザが無効になり、新しいパスワードの入力が必要になります。`SESSION_SECRET` は通常変更不要です。

## 困ったとき

- 初期設定画面のまま：`js/config.js` のURLまたはサイトキーが仮値のままです。
- 「GASの公開設定を確認」：Webアプリのアクセス対象が「全員」か、URLが `/exec` で終わるか確認します。
- Turnstileが出ない：Cloudflare側のホスト名と `ALLOWED_HOSTNAME` を確認します。
- 登録できない：`setupSheets` が完了しているか、GASを新バージョンへ再デプロイしたか確認します。
- 変更がサイトへ反映されない：GitHubの「Actions」でPagesワークフローの完了を確認します。
