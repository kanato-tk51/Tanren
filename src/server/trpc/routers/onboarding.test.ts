import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import type { User } from "@/db/schema";

import { appRouter } from "./index";

const updateSpy = vi.fn();
vi.mock("@/db/client", () => {
  return {
    getDb: () => ({
      update: () => ({
        set: (vals: unknown) => ({
          where: (cond: unknown) => {
            updateSpy(vals, cond);
            return Promise.resolve();
          },
        }),
      }),
    }),
  };
});

function userWith(overrides: Partial<User>): User {
  return {
    id: "u-1",
    email: "x@y.z",
    displayName: null,
    timezone: "Asia/Tokyo",
    dailyGoal: 15,
    notificationTime: null,
    onboardingCompletedAt: null,
    interestDomains: [],
    selfLevel: null,
    createdAt: new Date(),
    ...overrides,
  } as User;
}

describe("onboarding.savePreferences input validation", () => {
  beforeEach(() => updateSpy.mockClear());
  afterEach(() => vi.clearAllMocks());

  const caller = appRouter.createCaller({ user: userWith({}) });

  it("interestDomains が空は reject", async () => {
    await expect(
      caller.onboarding.savePreferences({ interestDomains: [], selfLevel: "junior" }),
    ).rejects.toThrow();
  });

  it("Tier 1 以外の domain は reject (zod enum)", async () => {
    await expect(
      // @ts-expect-error 'os' は Tier 1 でない (security/distributed/...)
      caller.onboarding.savePreferences({ interestDomains: ["os"], selfLevel: "junior" }),
    ).rejects.toThrow();
  });

  it("staff / principal は MVP では reject (concept レンジ外)", async () => {
    await expect(
      // @ts-expect-error staff は MVP の selfLevel に未対応
      caller.onboarding.savePreferences({ interestDomains: ["programming"], selfLevel: "staff" }),
    ).rejects.toThrow();
  });

  it("正しい入力は accept、users への update が呼ばれる", async () => {
    await caller.onboarding.savePreferences({
      interestDomains: ["programming", "network"],
      selfLevel: "mid",
    });
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [vals] = updateSpy.mock.calls[0]!;
    expect(vals).toEqual({
      interestDomains: ["programming", "network"],
      selfLevel: "mid",
    });
  });
});

describe("onboarding.complete prerequisite check", () => {
  beforeEach(() => updateSpy.mockClear());

  it("interestDomains 未設定は PRECONDITION_FAILED", async () => {
    const caller = appRouter.createCaller({
      user: userWith({ interestDomains: [], selfLevel: "junior" }),
    });
    await expect(caller.onboarding.complete()).rejects.toThrow();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("selfLevel 未設定は PRECONDITION_FAILED", async () => {
    const caller = appRouter.createCaller({
      user: userWith({ interestDomains: ["programming"], selfLevel: null }),
    });
    await expect(caller.onboarding.complete()).rejects.toThrow();
    expect(updateSpy).not.toHaveBeenCalled();
  });

  it("両方揃っていれば onboarding_completed_at をセット", async () => {
    const caller = appRouter.createCaller({
      user: userWith({ interestDomains: ["programming"], selfLevel: "junior" }),
    });
    await caller.onboarding.complete();
    expect(updateSpy).toHaveBeenCalledTimes(1);
    const [vals] = updateSpy.mock.calls[0]!;
    expect(vals).toHaveProperty("onboardingCompletedAt");
    expect((vals as { onboardingCompletedAt: Date }).onboardingCompletedAt).toBeInstanceOf(Date);
  });
});

describe("onboarding.getStatus", () => {
  it("未完了ユーザー → completed: false", () => {
    const caller = appRouter.createCaller({ user: userWith({}) });
    const out = caller.onboarding.getStatus();
    return expect(out).resolves.toMatchObject({ completed: false, interestDomains: [] });
  });

  it("完了済みユーザー → completed: true + 設定値", () => {
    const caller = appRouter.createCaller({
      user: userWith({
        onboardingCompletedAt: new Date(),
        interestDomains: ["programming", "db"],
        selfLevel: "mid",
      }),
    });
    return expect(caller.onboarding.getStatus()).resolves.toMatchObject({
      completed: true,
      interestDomains: ["programming", "db"],
      selfLevel: "mid",
    });
  });
});
