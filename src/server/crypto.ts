import { createCipheriv, createDecipheriv, randomBytes, scryptSync } from "node:crypto";

/** AES-256-GCM für Webhook-URLs und Passwörter. Schlüssel aus APP_SECRET, nie aus der Datenbank. */
export type SecretBox = { encrypt(plain: string): string; decrypt(boxed: string): string };

export function createSecretBox(appSecret: string | undefined): SecretBox {
  if (!appSecret || appSecret.length < 16) throw new Error("APP_SECRET fehlt oder ist kürzer als 16 Zeichen");
  const key = scryptSync(appSecret, "softversion/v1", 32);
  return {
    encrypt(plain) {
      const iv = randomBytes(12);
      const c = createCipheriv("aes-256-gcm", key, iv);
      const data = Buffer.concat([c.update(plain, "utf8"), c.final()]);
      return ["v1", iv.toString("base64"), c.getAuthTag().toString("base64"), data.toString("base64")].join(":");
    },
    decrypt(boxed) {
      const [v, iv, tag, data] = boxed.split(":");
      if (v !== "v1") throw new Error("Unbekanntes Geheimnis-Format");
      const d = createDecipheriv("aes-256-gcm", key, Buffer.from(iv, "base64"));
      d.setAuthTag(Buffer.from(tag, "base64"));
      return Buffer.concat([d.update(Buffer.from(data, "base64")), d.final()]).toString("utf8");
    },
  };
}

/** Anzeige in der UI: nur Host, Rest maskiert. */
export function maskUrl(url: string) {
  try {
    return `${new URL(url).origin}/…`;
  } catch {
    return "…";
  }
}
