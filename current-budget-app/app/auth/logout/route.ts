import { NextResponse } from "next/server";
import { chatGPTSignOutPath } from "@/app/chatgpt-auth";
import {
  authCookies,
  clearAuthCookie,
  cognitoConfig,
} from "@/app/product-auth";

export const dynamic = "force-dynamic";

export async function GET(request: Request) {
  const url = new URL(request.url);
  if (!cognitoConfig())
    return NextResponse.redirect(new URL(chatGPTSignOutPath("/"), url));
  const response = NextResponse.redirect(new URL("/", url));
  clearAuthCookie(response, authCookies.id);
  clearAuthCookie(response, authCookies.refresh);
  clearAuthCookie(response, authCookies.oauth);
  return response;
}
