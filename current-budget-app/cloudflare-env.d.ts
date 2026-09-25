declare namespace Cloudflare {
  interface Env {
    DB?: D1Database;
    BUCKET?: R2Bucket;
    INITIAL_OWNER_EMAIL?: string;
    INITIAL_PARTNER_EMAIL?: string;
    COGNITO_ISSUER?: string;
    COGNITO_DOMAIN?: string;
    COGNITO_CLIENT_ID?: string;
    COGNITO_REDIRECT_URI?: string;
  }
}
