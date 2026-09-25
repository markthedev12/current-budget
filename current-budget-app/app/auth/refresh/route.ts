import { NextResponse } from "next/server";
import {
  authCookies,
  authLoginPath,
  clearAuthCookie,
  cognitoConfig,
  safeReturnPath,
  verifyCognitoIdToken,
} from "@/app/product-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeReturnPath(url.searchParams.get("return_to"));
  const config = cognitoConfig();
  const refresh = request.headers
    .get("cookie")
    ?.match(/(?:^|;\s*)__Host-current-refresh=([^;]+)/)?.[1];
  if (!config || !refresh)
    return NextResponse.redirect(new URL(authLoginPath(returnTo), url));
  try {
    const tokenResponse = await fetch(`${config.domain}/oauth2/token`, {
      method: "POST",
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
      body: new URLSearchParams({
        grant_type: "refresh_token",
        client_id: config.clientId,
        refresh_token: decodeURIComponent(refresh),
      }),
    });
    if (!tokenResponse.ok) throw new Error("Session refresh failed");
    const tokens = (await tokenResponse.json()) as Record<string, unknown>;
    if (typeof tokens.id_token !== "string")
      throw new Error("No identity token");
    await verifyCognitoIdToken(tokens.id_token, config);
    const response = NextResponse.redirect(new URL(returnTo, url));
    response.cookies.set(authCookies.id, tokens.id_token, {
      httpOnly: true,
      secure: true,
      sameSite: "lax",
      path: "/",
      maxAge: 3600,
    });
    if (typeof tokens.refresh_token === "string")
      response.cookies.set(authCookies.refresh, tokens.refresh_token, {
        httpOnly: true,
        secure: true,
        sameSite: "lax",
        path: "/",
        maxAge: 30 * 86400,
      });
    return response;
  } catch {
    const response = NextResponse.redirect(
      new URL(authLoginPath(returnTo), url),
    );
    clearAuthCookie(response, authCookies.id);
    clearAuthCookie(response, authCookies.refresh);
    return response;
  }
}
