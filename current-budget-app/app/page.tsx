import { redirect } from "next/navigation";
import {
  authLoginPath,
  cognitoConfig,
  getAppUser,
  hasRefreshSession,
} from "./product-auth";
import BudgetClient from "./budget-client";

export const dynamic = "force-dynamic";

export default async function Home() {
  const user = await getAppUser();
  if (!user) {
    if (cognitoConfig() && (await hasRefreshSession()))
      redirect("/auth/refresh?return_to=%2F");
    return (
      <main className="signin-shell">
        <div className="signin-card">
          <div className="brand-sign">∿</div>
          <h1>Current</h1>
          <p>Sign in to open your budget.</p>
          <a className="primary-link" href={authLoginPath("/")} target="_top">
            {cognitoConfig()
              ? "Sign in or create account"
              : "Sign in with ChatGPT"}
          </a>
        </div>
      </main>
    );
  }
  return <BudgetClient />;
}
