# Security

## 秘密情報をコミットしない

次の値はGitHubリポジトリへ保存しません。

- 共有パスワード
- `TURNSTILE_SECRET`
- `SESSION_SECRET`
- `PASSWORD_SALT`
- `PASSWORD_HASH`
- Googleの認証情報
- `.clasp.json` / `.clasprc.json`

TurnstileのサイトキーとGAS WebアプリURLは、ブラウザから利用する公開情報です。

## セッション

認証後のトークンはブラウザの `localStorage` へ保存されます。共有端末では利用後に「ログアウト」を押してください。サイトデータを削除すると、そのブラウザのトークンも削除されます。

## 問題が起きた場合

パスワード流出が疑われる場合は、パスワードを変更して `SESSION_VERSION` を増やしてください。Turnstile秘密鍵が流出した場合はCloudflare Dashboardでローテーションします。
