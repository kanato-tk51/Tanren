import { describe, expect, it } from "vitest";

import { activeTabId, isNavHidden } from "./nav-routes";

describe("activeTabId", () => {
  it("/ → home", () => {
    expect(activeTabId("/")).toBe("home");
  });

  it("/drill / /drill/anything → drill", () => {
    expect(activeTabId("/drill")).toBe("drill");
    expect(activeTabId("/drill/123")).toBe("drill");
  });

  it("/insights / /insights/* → insights", () => {
    expect(activeTabId("/insights")).toBe("insights");
    expect(activeTabId("/insights/history")).toBe("insights");
    expect(activeTabId("/insights/search")).toBe("insights");
  });

  it("nav に存在しないパスは null", () => {
    expect(activeTabId("/login")).toBeNull();
    expect(activeTabId("/custom")).toBeNull();
    expect(activeTabId("/review")).toBeNull();
    // /home のような prefix collision を起こさない
    expect(activeTabId("/drillsomething")).toBeNull();
  });
});

describe("isNavHidden", () => {
  it("セッション中の没入画面では非表示", () => {
    expect(isNavHidden("/drill")).toBe(true);
    expect(isNavHidden("/drill/foo")).toBe(true);
    expect(isNavHidden("/custom")).toBe(true);
    expect(isNavHidden("/review")).toBe(true);
    expect(isNavHidden("/login")).toBe(true);
  });

  it("Home / Insights では表示", () => {
    expect(isNavHidden("/")).toBe(false);
    expect(isNavHidden("/insights")).toBe(false);
    expect(isNavHidden("/insights/history")).toBe(false);
  });

  it("prefix collision 安全 (/drill で始まる別ルート名を巻き込まない)", () => {
    // /drillarchive のような未来のルート名が誤って隠されないこと
    expect(isNavHidden("/drillarchive")).toBe(false);
    expect(isNavHidden("/customizer")).toBe(false);
  });
});
