// Vitest で `import "server-only"` を no-op にするためのスタブ。
// 本物の server-only は import するだけで throw する poison pill なので、
// test 環境では空 module に差し替える (vitest.config.ts の alias 参照)。
export {};
