// Vitest stand-in for the `server-only` package, which throws when imported
// outside a React Server Components build. Server modules (lib/proxy.ts) are
// tested directly in Node, where that guard has nothing to protect.
export {};
