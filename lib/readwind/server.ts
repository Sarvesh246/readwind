import { neon } from "@neondatabase/serverless";
import { createRemoteJWKSet, jwtVerify } from "jose";
import { AwsClient } from "aws4fetch";
import { managedAuth } from "./auth-server";
export function sql() {
  if (!process.env.DATABASE_URL) throw new Error("Database is not configured");
  return neon(process.env.DATABASE_URL);
}
let jwks: ReturnType<typeof createRemoteJWKSet>;
export async function owner(request: Request) {
  const token = request.headers
    .get("authorization")
    ?.match(/^Bearer (.+)$/)?.[1];
  if (!token) {
    if (
      request.method !== "GET" &&
      request.headers.get("origin") !== new URL(request.url).origin
    )
      return null;
    try {
      const { data } = await managedAuth().getSession();
      return data?.user?.id || null;
    } catch {
      return null;
    }
  }
  if (!process.env.NEON_AUTH_JWKS_URL || !process.env.NEON_AUTH_BASE_URL)
    return null;
  try {
    jwks ||= createRemoteJWKSet(new URL(process.env.NEON_AUTH_JWKS_URL));
    const { payload } = await jwtVerify(token, jwks, {
      issuer: new URL(process.env.NEON_AUTH_BASE_URL).origin,
      audience: new URL(process.env.NEON_AUTH_BASE_URL).origin,
      algorithms: ["EdDSA"],
    });
    return payload.sub || null;
  } catch {
    return null;
  }
}
export function storageFetch(key: string, init?: RequestInit) {
  const client = new AwsClient({
    service: "s3",
    region: process.env.AWS_REGION || "us-east-2",
    accessKeyId: process.env.AWS_ACCESS_KEY_ID!,
    secretAccessKey: process.env.AWS_SECRET_ACCESS_KEY!,
  });
  const endpoint = process.env.AWS_ENDPOINT_URL_S3!.replace(/\/$/, "");
  return client.fetch(
    `${endpoint}/${bucket}/${key.split("/").map(encodeURIComponent).join("/")}`,
    init,
  );
}
export const bucket = "folio-books";
export const unauthorized = () =>
  Response.json({ error: "Please sign in again." }, { status: 401 });
