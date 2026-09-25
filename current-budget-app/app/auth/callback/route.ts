import { base64url } from "jose";
import { NextResponse } from "next/server";
import {
  authCookies,
  clearAuthCookie,
  cognitoConfig,
  safeReturnPath,
  verifyCognitoIdToken,
} from "@/app/product-auth";

export const dynamic = "force-dynamic";

type OAuthState = {
  state: string;
  nonce: string;
  verifier: string;
  returnTo: string;
};

export async function GET(request: Request) {
  const config = cognitoConfig();
  const url = new URL(request.url);
  if (!config) return NextResponse.redirect(new URL("/", url));
  const raw = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)__Host-current-oauth=([^;]+)/)?.[1];
  let saved: OAuthState | null = null;
  try {
    if (raw)
      saved = JSON.parse(
        new TextDecoder().decode(base64url.decode(decodeURIComponent(raw))),
      );
  } catch {
    // Invalid state is handled below.
  }
  const code = url.searchParams.get("code");
  if (!saved || !code || saved.state !== url.searchParams.get("state"))
    return NextResponse.redirect(new URL("/auth/login", url));

  try {
    const tokenResponse = await fetch(`${config.domain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "authorization_code",
        client_id: config.clientId,
        redirect_uri: config.redirectUri,
        code,
        code_verifier: saved.verifier,
      }),
    });
    if (!tokenResponse.ok) throw new Error("Code exchange failed");
    const tokens = (await tokenResponse.json()) as Record<string, unknown>;
    if (
      typeof tokens.id_token !== "string" ||
      typeof tokens.refresh_token !== "string"
    )
      throw new Error("Cognito tokens are incomplete");
    await verifyCognitoIdToken(tokens.id_token, config, saved.nonce);
    const response = NextResponse.redirect(
      new URL(safeReturnPath(saved.returnTo), url),
    );
    clearAuthCookie(response, authCookies.oauth);
    response.cookies.set(authCookies.id, tokens.id_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    response.cookies.set(authCookies.refresh, tokens.refresh_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 30 * 86400,
    });
    return response;
  } catch (cause) {
    console.error("Cognito sign-in failed", cause);
    const response = NextResponse.redirect(new URL("/auth/login", url));
    clearAuthCookie(response, authCookies.oauth);
    return response;
  }
}
