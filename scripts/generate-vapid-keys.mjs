import { createECDH, randomBytes } from "node:crypto";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();

const publicKey = ecdh.getPublicKey(undefined, "uncompressed").toString("base64url");
const privateKey = ecdh.getPrivateKey().toString("base64url");
const webhookSecret = randomBytes(32).toString("base64url");

console.log("以下はCloudflare Pagesの設定画面へ登録し、リポジトリへ保存しないでください。");
console.log(`VAPID_PUBLIC_KEY=${publicKey}`);
console.log(`VAPID_PRIVATE_KEY=${privateKey}`);
console.log("VAPID_SUBJECT=mailto:あなたのメールアドレス");
console.log(`PUSH_WEBHOOK_SECRET=${webhookSecret}`);
