# Cloudflare Pages移行・通知設定

このアプリの通知は、Cloudflare Pages FunctionsとWorkers KVを使うWeb Pushです。予定を登録したGASがPages Functionsへ通知を依頼し、通知を許可した各端末へ配信します。

```text
予定を登録
    ↓
Google Apps Script
    ↓ 認証済みWebhook
Cloudflare Pages Functions
    ↓
Workers KVに登録された端末 → Web Push通知
```

設定は基本的にCloudflare DashboardとApps Scriptの画面で手動で行います。`VAPID_PRIVATE_KEY`、`SESSION_SECRET`、`PUSH_WEBHOOK_SECRET`は秘密情報なので、GitHubやファイルへ保存しないでください。

## 事前準備

- Cloudflareアカウント
- Cloudflareと接続できるGitHubアカウント
- このリポジトリへ反映済みの通知対応コード
- 現在GASで使っている `SESSION_SECRET` と `SESSION_VERSION`
- 現在Turnstileで使っているウィジェット

Pages Functionsを使うため、Cloudflare Dashboardからのファイル直接アップロードではなく、Git連携でデプロイします。

## 1. 通知用の鍵をローカルで作る

Node.js 20以上が入ったPCで、このリポジトリのフォルダを開いて実行します。

```powershell
npm install
npm run push:keys
```

次の4項目が表示されます。

- `VAPID_PUBLIC_KEY`
- `VAPID_PRIVATE_KEY`
- `VAPID_SUBJECT`
- `PUSH_WEBHOOK_SECRET`

`VAPID_SUBJECT` の `あなたのメールアドレス` は、管理者が受信できるメールアドレスへ置き換えます。表示された値はパスワード管理ツールなどへ一時保存し、リポジトリへ追加しないでください。

## 2. PagesプロジェクトをGitHubから作る

1. [Cloudflare Dashboard](https://dash.cloudflare.com/)へログインします。
2. 左側の `Workers & Pages` を開きます。
3. `Create application` → `Pages` → `Connect to Git` を選びます。
4. GitHub連携を許可し、リポジトリ `kamabk28/kumiawase` を選びます。
5. Production branchを `main` にします。
6. Build settingsを次のように設定します。

| 項目 | 値 |
|---|---|
| Framework preset | `None` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Root directory | 空欄 |

7. `Save and Deploy` を押します。
8. 完了後、`https://プロジェクト名.pages.dev` を開き、画面が表示されることを確認します。

この段階では通知用KVと秘密情報が未設定なので、通常の画面は表示できても通知はまだ使えません。

## 3. 通知先を保存するKVを作る

1. Cloudflare Dashboardの `Storage & Databases` → `KV` を開きます。
2. `Create a namespace` を押します。
3. 名前を `kumiawase-push-subscriptions` などにして作成します。
4. `Workers & Pages` へ戻り、作成したPagesプロジェクトを開きます。
5. `Settings` → `Bindings` → `Add` → `KV namespace` を選びます。
6. Variable nameを必ず `PUSH_SUBSCRIPTIONS` にします。
7. KV namespaceに、今作成した名前空間を選びます。
8. Productionへ保存します。プレビュー環境でも通知を試すならPreviewにも同じBindingを追加します。

## 4. Pagesの変数と秘密情報を登録する

Pagesプロジェクトの `Settings` → `Variables and Secrets` → `Add` から、Productionへ次を登録します。

| 名前 | 種類 | 値 |
|---|---|---|
| `VAPID_PUBLIC_KEY` | Text | 手順1で生成した公開鍵 |
| `VAPID_PRIVATE_KEY` | Secret（Encrypt） | 手順1で生成した秘密鍵 |
| `VAPID_SUBJECT` | Text | `mailto:管理者のメールアドレス` |
| `PUSH_WEBHOOK_SECRET` | Secret（Encrypt） | 手順1で生成したWebhook秘密鍵 |
| `SESSION_SECRET` | Secret（Encrypt） | GASで現在使っている値と完全に同じ値 |
| `SESSION_VERSION` | Text | GASで現在使っている数字。通常は `1` |

登録後、`Deployments` から最新デプロイのメニューを開いて再デプロイします。Bindingや変数は、設定後のデプロイから反映されます。

次のURLをブラウザで開き、`"enabled":true` と公開鍵が返ることを確認します。

```text
https://プロジェクト名.pages.dev/api/push/config
```

## 5. Turnstileへ新しいホスト名を追加する

1. Cloudflare Dashboardの `Turnstile` を開きます。
2. このアプリで使用中のウィジェットを編集します。
3. 許可ホスト名へ `プロジェクト名.pages.dev` を追加します。
4. 独自ドメインを使う場合は、そのホスト名も追加します。
5. 旧GitHub Pagesと並行稼働する間は `kamabk28.github.io` を削除しません。

同じTurnstileウィジェットを使うなら、`js/config.js` の `turnstileSiteKey` は変更不要です。別のウィジェットを作った場合だけ、新しいサイトキーへ変更します。

## 6. GASへ通知Webhookを設定する

1. スプレッドシートから `拡張機能` → `Apps Script` を開きます。
2. `gas/Code.gs` の最新版をApps Scriptのコードへ反映して保存します。
3. `プロジェクトの設定` → `スクリプト プロパティ` を開きます。
4. 次を追加します。

| プロパティ | 値 |
|---|---|
| `PUSH_WEBHOOK_URL` | `https://プロジェクト名.pages.dev/api/push/broadcast` |
| `PUSH_WEBHOOK_SECRET` | Pagesへ登録した値と完全に同じ値 |
| `ALLOWED_HOSTNAMES` | `kamabk28.github.io,プロジェクト名.pages.dev` |

`ALLOWED_HOSTNAME` は移行中もそのまま残して構いません。コードは `ALLOWED_HOSTNAME` と、カンマ区切りの `ALLOWED_HOSTNAMES` の両方を許可します。

5. Apps Script右上の `デプロイ` → `デプロイを管理` を開きます。
6. Webアプリの鉛筆アイコンを押し、バージョンを `新バージョン` にしてデプロイします。

コードを保存しただけでは、既存の `/exec` Webアプリへは反映されません。

## 7. 通知を端末で有効にして動作確認する

1. `https://プロジェクト名.pages.dev` を開き、いつものパスワードでログインします。
2. 画面上部の音符ボタンを押します。
3. `この端末で通知を受け取る` を押します。
4. ブラウザの確認画面で通知を許可します。
5. `テスト通知` を押し、端末に通知が表示されることを確認します。
6. 別端末または別ブラウザから新しい予定を1件登録します。
7. 通知を許可した端末で「新しい予定が追加されました」と表示されることを確認します。

通知は端末ごとの設定です。パスワードを知っていてログインしたことがあるだけでは自動で許可されず、各端末で一度通知をONにする必要があります。ログアウトすると、その端末の通知購読も解除します。

iPhone／iPadはSafariでサイトをホーム画面へ追加し、そのホーム画面アイコンから開いて通知をONにしてください。AndroidやPCでも、OSまたはブラウザ側で通知を無効にしていると届きません。

## 8. 独自ドメインを使う場合

1. Pagesプロジェクトの `Custom domains` → `Set up a domain` を開きます。
2. 使用するドメインまたはサブドメインを入力します。
3. Cloudflareの案内に従ってDNSを設定します。
4. Turnstileの許可ホスト名とGASの `ALLOWED_HOSTNAMES` へ独自ドメインを追加します。
5. GASの `PUSH_WEBHOOK_URL` を独自ドメインのURLへ変える場合は、変更後にテストします。

## 9. GitHub Pagesから切り替える

Pages版でログイン、予定の登録・編集・削除、テスト通知、実際の新規予定通知を確認するまではGitHub Pagesを残しておくと安全です。確認後に利用者へ新URLを案内します。

GitHub Pagesを止める作業は必須ではありません。止める場合は、十分に確認してからGitHubのPages設定または既存のPages用Actionsワークフローを無効化します。

## 制限とトラブル確認

- 現在の実装は1回の予定作成につき最大45端末へ配信します。45端末を超える規模ではCloudflare Queuesなどを使う構成へ変更してください。
- 通知設定画面が「設定が必要」：Pagesの変数、KV Binding、再デプロイを確認します。
- ログインできない：Turnstileの許可ホスト名とGASの `ALLOWED_HOSTNAMES` を確認します。
- テスト通知は届くが新規予定通知が届かない：GASの `PUSH_WEBHOOK_URL`、`PUSH_WEBHOOK_SECRET`、GASの新バージョン再デプロイを確認します。
- 一部端末だけ届かない：その端末でログインし直し、通知を一度停止してから再度ONにします。
- パスワード変更で `SESSION_VERSION` を増やした場合：以前の通知購読は自動的に無効になるため、各端末でログインし直して通知をONにします。

Cloudflare公式資料：

- [PagesのGit連携](https://developers.cloudflare.com/pages/get-started/git-integration/)
- [Pages Functions](https://developers.cloudflare.com/pages/functions/get-started/)
- [Pages FunctionsのBindingsとSecrets](https://developers.cloudflare.com/pages/functions/bindings/)
- [Pagesの独自ドメイン](https://developers.cloudflare.com/pages/configuration/custom-domains/)
- [Turnstileのホスト名管理](https://developers.cloudflare.com/turnstile/additional-configuration/hostname-management/)
- [Workersの利用上限](https://developers.cloudflare.com/workers/platform/limits/)
