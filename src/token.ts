import { readFile } from "node:fs/promises";
import { dirname, isAbsolute, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { SignJWT, importPKCS8 } from "jose";

const PROJECT_ROOT = resolve(dirname(fileURLToPath(import.meta.url)), "..");

export interface AppleConfig {
  teamId: string;
  keyId: string;
  mediaId: string;
  privateKeyPath: string;
  storefront: string;
  userToken: string;
}

export function loadConfig(): AppleConfig {
  const required = ["APPLE_TEAM_ID", "APPLE_KEY_ID", "APPLE_MEDIA_ID", "APPLE_PRIVATE_KEY_PATH"];
  for (const name of required) {
    if (!process.env[name]) throw new Error(`Missing env var: ${name}`);
  }
  return {
    teamId: process.env.APPLE_TEAM_ID!,
    keyId: process.env.APPLE_KEY_ID!,
    mediaId: process.env.APPLE_MEDIA_ID!,
    privateKeyPath: isAbsolute(process.env.APPLE_PRIVATE_KEY_PATH!)
      ? process.env.APPLE_PRIVATE_KEY_PATH!
      : resolve(PROJECT_ROOT, process.env.APPLE_PRIVATE_KEY_PATH!),
    storefront: process.env.APPLE_STOREFRONT ?? "us",
    userToken: process.env.APPLE_MUSIC_USER_TOKEN ?? "",
  };
}

let cachedToken: { token: string; exp: number } | null = null;

export async function getDeveloperToken(config: AppleConfig): Promise<string> {
  const now = Math.floor(Date.now() / 1000);
  if (cachedToken && cachedToken.exp - 60 > now) return cachedToken.token;

  const pem = await readFile(config.privateKeyPath, "utf8");
  const privateKey = await importPKCS8(pem, "ES256");

  const exp = now + 60 * 60 * 24 * 180;
  const token = await new SignJWT({})
    .setProtectedHeader({ alg: "ES256", kid: config.keyId })
    .setIssuer(config.teamId)
    .setIssuedAt(now)
    .setExpirationTime(exp)
    .sign(privateKey);

  cachedToken = { token, exp };
  return token;
}
