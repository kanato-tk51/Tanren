import { describe, expect, it, vi } from "vitest";

import {
  buildExtractMisconceptionPrompt,
  extractAndPersistMisconception,
} from "./extract-misconception";

// upsertMisconception は DB を呼ぶので、テスト側で extract-misconception.ts の
// `upsertMisconception` を vi.spyOn で差し替えて DB 呼び出しをスキップする。
vi.mock("@/db/client", () => ({ getDb: vi.fn() }));

const baseInput = {
  userId: "u-1",
  concept: { id: "network.tls.key_exchange", name: "TLS 鍵交換" },
  question: {
    prompt: "TLS 1.3 の鍵交換方式は?",
    answer: "楕円曲線 Diffie-Hellman (ECDHE) ベース。TLS 1.3 は RSA 鍵交換を廃止した。",
  },
  userAnswer: "RSA",
  reasonGiven: "古い TLS でも RSA を使うから、TLS 1.3 も同じだと思った。",
};

describe("buildExtractMisconceptionPrompt", () => {
  it("Output requirements が user 冒頭、可変セクションが末尾 (prompt caching 規約)", () => {
    const out = buildExtractMisconceptionPrompt(baseInput);
    expect(out.user.indexOf("## Output requirements")).toBeLessThan(
      out.user.indexOf("## Question"),
    );
  });

  it("snapshot (代表入力)", () => {
    const out = buildExtractMisconceptionPrompt(baseInput);
    expect({ system: out.system, user: out.user }).toMatchSnapshot();
  });

  it("変数置換: userAnswer / reasonGiven / conceptId を含む", () => {
    const out = buildExtractMisconceptionPrompt(baseInput);
    expect(out.user).toContain("RSA");
    expect(out.user).toContain("古い TLS でも RSA");
    expect(out.user).toContain("network.tls.key_exchange");
  });
});

describe("extractAndPersistMisconception", () => {
  it("reasonGiven が空なら抽出スキップ (コスト節約)", async () => {
    const caller = vi.fn();
    const res = await extractAndPersistMisconception({ ...baseInput, reasonGiven: "" }, caller);
    expect(res.saved).toBe(false);
    expect(res.extracted).toBeNull();
    expect(caller).not.toHaveBeenCalled();
  });

  it("reasonGiven が whitespace のみでもスキップ", async () => {
    const caller = vi.fn();
    const res = await extractAndPersistMisconception(
      { ...baseInput, reasonGiven: "   \n\t " },
      caller,
    );
    expect(res.saved).toBe(false);
    expect(caller).not.toHaveBeenCalled();
  });

  it("confidence < 0.5 は保存しない (迎合抑止)", async () => {
    const caller = vi.fn().mockResolvedValue({
      description: "弱い根拠の推測",
      confidence: 0.3,
    });
    const res = await extractAndPersistMisconception(baseInput, caller);
    expect(res.saved).toBe(false);
    expect(res.extracted?.confidence).toBe(0.3);
  });

  it("description が空なら保存しない", async () => {
    const caller = vi.fn().mockResolvedValue({ description: "", confidence: 0 });
    const res = await extractAndPersistMisconception(baseInput, caller);
    expect(res.saved).toBe(false);
  });
});
