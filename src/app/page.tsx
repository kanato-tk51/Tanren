import { getCurrentUser } from "@/server/auth/session";

import { HomeScreen } from "@/features/home/home-screen";

export default async function Home() {
  const initialUser = await getCurrentUser();
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 p-8">
      <HomeScreen
        initialUser={
          initialUser
            ? {
                id: initialUser.id,
                email: initialUser.email,
                displayName: initialUser.displayName,
                dailyGoal: initialUser.dailyGoal,
              }
            : null
        }
      />
    </main>
  );
}
