import { env } from "cloudflare:workers";
import { cookies } from "next/headers";
import type { NextResponse } from "next/server";
import { getChatGPTUser, type ChatGPTUser } from "./chatgpt-auth";
import { verifyCognitoIdToken } from "@/lib/cognito-token";
export { verifyCognitoIdToken } from "@/lib/cognito-token";

export const authCookies = {
  id: "__Host-current-id",
  refresh: "__Host-current-refresh",
  oauth: "__Host-current-oauth",
} as const;

export function clearAuthCookie(response: NextResponse, name: string) {
  response.cookies.set(name, "", {
    httpOnly: true,
    secure: true,
    sameSite: "lax",
    path: "/",
    maxAge: 0,
  });
}

type CognitoConfig = {
  issuer: string;
  domain: string;
  clientId: string;
  redirectUri: string;
};

export function cognitoConfig(): CognitoConfig | null {
  const issuer = env.COGNITO_ISSUER?.replace(/\/$/, "");
  const domain = env.COGNITO_DOMAIN?.replace(/\/$/, "");
  const clientId = env.COGNITO_CLIENT_ID;
  const redirectUri = env.COGNITO_REDIRECT_URI;
  if (!issuer || !domain || !clientId || !redirectUri) return null;
  if (
    !/^https:\/\/cognito-idp\.[a-z0-9-]+\.amazonaws\.com\/[a-z0-9_-]+$/i.test(
      issuer,
    ) ||
    !/^https:\/\/[a-z0-9.-]+$/.test(domain) ||
    !/^https:\/\/[a-z0-9.-]+\/auth\/callback$/.test(redirectUri)
  )
    throw new Error("Cognito configuration is invalid");
  return { issuer, domain, clientId, redirectUri };
}

export async function getAppUser(): Promise<ChatGPTUser | null> {
  const config = cognitoConfig();
  if (!config) return getChatGPTUser();
  const token = (await cookies()).get(authCookies.id)?.value;
  if (!token) return null;
  try {
    return await verifyCognitoIdToken(token, config);
  } catch {
    return null;
  }
}

export async function hasRefreshSession(): Promise<boolean> {
  return Boolean((await cookies()).get(authCookies.refresh)?.value);
}

export function safeReturnPath(value: string | null): string {
  if (!value?.startsWith("/") || value.startsWith("//")) return "/";
  try {
    const url = new URL(value, "https://current.local");
    if (
      url.origin !== "https://current.local" ||
      url.pathname.startsWith("/auth/")
    )
      return "/";
    return `${url.pathname}${url.search}${url.hash}`;
  } catch {
    return "/";
  }
}

export function authLoginPath(returnTo = "/") {
  return `/auth/login?return_to=${encodeURIComponent(safeReturnPath(returnTo))}`;
}
