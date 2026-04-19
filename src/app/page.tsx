import { redirect } from "next/navigation";

import { getCurrentUser } from "@/server/auth/session";

import { HomeScreen } from "@/features/home/home-screen";

export default async function Home() {
  const initialUser = await getCurrentUser();
  // ログイン済みでオンボーディング未完了なら /onboarding へ強制リダイレクト (issue #26)。
  // 未ログインや未完了なら HomeScreen 側でログイン誘導 / リダイレクトをハンドル。
  if (initialUser && !initialUser.onboardingCompletedAt) {
    redirect("/onboarding");
  }
  return (
    <main className="flex min-h-screen flex-col items-center gap-6 p-6 sm:p-8">
      <HomeScreen
        initialUser={
          initialUser
            ? {
                id: initialUser.id,
                email: initialUser.email,
                displayName: initialUser.displayName,
                githubLogin: initialUser.githubLogin,
                dailyGoal: initialUser.dailyGoal,
              }
            : null
        }
      />
    </main>
  );
}
