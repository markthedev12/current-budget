import { base64url } from "jose";
import { NextResponse } from "next/server";
import { chatGPTSignInPath } from "@/app/chatgpt-auth";
import { authCookies, cognitoConfig, safeReturnPath } from "@/app/product-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  const returnTo = safeReturnPath(url.searchParams.get("return_to"));
  const config = cognitoConfig();
  if (!config)
    return NextResponse.redirect(new URL(chatGPTSignInPath(returnTo), url));

  const verifier = base64url.encode(crypto.getRandomValues(new Uint8Array(32)));
  const challenge = base64url.encode(
    new Uint8Array(
      await crypto.subtle.digest("SHA-256", new TextEncoder().encode(verifier)),
    ),
  );
  const state = base64url.encode(crypto.getRandomValues(new Uint8Array(24)));
  const nonce = base64url.encode(crypto.getRandomValues(new Uint8Array(24)));
  const authorize = new URL(`${config.domain}/oauth2/authorize`);
  authorize.searchParams.set("response_type", "code");
  authorize.searchParams.set("client_id", config.clientId);
  authorize.searchParams.set("redirect_uri", config.redirectUri);
  authorize.searchParams.set("scope", "openid email profile");
  authorize.searchParams.set("code_challenge_method", "S256");
  authorize.searchParams.set("code_challenge", challenge);
  authorize.searchParams.set("state", state);
  authorize.searchParams.set("nonce", nonce);

  const response = NextResponse.redirect(authorize);
  response.cookies.set(
    authCookies.oauth,
    base64url.encode(
      new TextEncoder().encode(
        JSON.stringify({ state, nonce, verifier, returnTo }),
      ),
    ),
    { httpOnly: true, secure: true, sameSite: "lax", path: "/", maxAge: 600 },
  );
  return response;
}
