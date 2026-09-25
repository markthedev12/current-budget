import { createRemoteJWKSet, jwtVerify } from "jose";

export type VerifiedUser = {
  userId: string;
  email: string;
  fullName: string | null;
  displayName: string;
};

const jwksCache = new Map<string, ReturnType<typeof createRemoteJWKSet>>();
export async function verifyCognitoIdToken(
  token: string,
  config: { issuer: string; clientId: string },
  expectedNonce?: string,
): Promise<VerifiedUser> {
  let jwks = jwksCache.get(config.issuer);
  if (!jwks) {
    jwks = createRemoteJWKSet(
      new URL(`${config.issuer}/.well-known/jwks.json`),
    );
    jwksCache.set(config.issuer, jwks);
  }
  const { payload } = await jwtVerify(token, jwks, {
    issuer: config.issuer,
    audience: config.clientId,
    algorithms: ["RS256"],
  });
  if (
    payload.token_use !== "id" ||
    payload.email_verified !== true ||
    typeof payload.email !== "string" ||
    !payload.sub ||
    (expectedNonce && payload.nonce !== expectedNonce)
  )
    throw new Error("Cognito identity is incomplete");
  const email = payload.email.trim().toLowerCase();
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email))
    throw new Error("Cognito email is invalid");
  const fullName = typeof payload.name === "string" ? payload.name : null;
  return {
    userId: `cognito:${payload.sub}`,
    email,
    fullName,
    displayName: fullName ?? email,
  };
}
