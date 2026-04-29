import { afterEach, describe, expect, it, vi } from "vitest";
import { createAuthBroadcaster } from "@/lib/auth/cross-tab-auth-sync";

// Vitest tourne en environnement node ≥ 18 où BroadcastChannel est un global
// natif (cf. node --experimental-flags devenu stable depuis Node 18). Deux
// instances partageant le même channelName s'échangent les messages comme
// cross-tab dans le navigateur, donc on teste le vrai comportement sans
// jsdom ni mock complexe.
//
// Pour le cas "fallback no-op" on stub BroadcastChannel à undefined via
// vi.stubGlobal, qui simule un environnement non-supporté (vieux Safari,
// SSR Node sans polyfill).

const CHANNEL = "test-auth-sync";

afterEach(() => {
  vi.unstubAllGlobals();
});

describe("createAuthBroadcaster", () => {
  it("broadcast() poste un message { type: 'auth-changed' } reçu par les abonnés cross-instance", async () => {
    const sender = createAuthBroadcaster(CHANNEL);
    const receiver = createAuthBroadcaster(CHANNEL);

    const handler = vi.fn();
    receiver.subscribe(handler);

    sender.broadcast();

    await waitForCalls(handler, 1);
    expect(handler).toHaveBeenCalledTimes(1);

    sender.close();
    receiver.close();
  });

  it("subscribe() ignore les messages dont le type n'est pas 'auth-changed'", async () => {
    const receiver = createAuthBroadcaster(CHANNEL);
    const rawSender = new BroadcastChannel(CHANNEL);

    const handler = vi.fn();
    receiver.subscribe(handler);

    rawSender.postMessage({ type: "other-event" });
    rawSender.postMessage({ unrelated: true });
    rawSender.postMessage({ type: "auth-changed" });

    await waitForCalls(handler, 1);
    expect(handler).toHaveBeenCalledTimes(1);

    rawSender.close();
    receiver.close();
  });

  it("close() empêche les broadcasts ultérieurs d'être reçus par les abonnés", async () => {
    const sender = createAuthBroadcaster(CHANNEL);
    const receiver = createAuthBroadcaster(CHANNEL);

    const handler = vi.fn();
    receiver.subscribe(handler);

    sender.close();
    sender.broadcast();
    await flushMicrotasks();
    expect(handler).not.toHaveBeenCalled();

    receiver.close();
  });

  it("subscribe() retourne un unsubscribe qui détache le listener", async () => {
    const sender = createAuthBroadcaster(CHANNEL);
    const receiver = createAuthBroadcaster(CHANNEL);

    const handler = vi.fn();
    const unsubscribe = receiver.subscribe(handler);
    unsubscribe();

    sender.broadcast();
    await flushMicrotasks();
    expect(handler).not.toHaveBeenCalled();

    sender.close();
    receiver.close();
  });

  it("fallback no-op silencieux quand BroadcastChannel est indisponible", () => {
    vi.stubGlobal("BroadcastChannel", undefined);

    const broadcaster = createAuthBroadcaster(CHANNEL);
    const handler = vi.fn();

    expect(() => broadcaster.broadcast()).not.toThrow();
    const unsubscribe = broadcaster.subscribe(handler);
    expect(() => unsubscribe()).not.toThrow();
    expect(() => broadcaster.close()).not.toThrow();
    expect(handler).not.toHaveBeenCalled();
  });
});

// BroadcastChannel délivre les messages de façon asynchrone (microtask +
// boucle d'event). On poll jusqu'à observer le compte attendu plutôt
// qu'attendre un timeout fixe — robuste aux variations de scheduling.
async function waitForCalls(
  handler: { mock: { calls: unknown[][] } },
  expected: number,
  timeoutMs = 200,
): Promise<void> {
  const start = Date.now();
  while (handler.mock.calls.length < expected) {
    if (Date.now() - start > timeoutMs) {
      throw new Error(
        `handler not called ${expected} time(s) within ${timeoutMs}ms (calls=${handler.mock.calls.length})`,
      );
    }
    await new Promise((r) => setTimeout(r, 5));
  }
}

async function flushMicrotasks(): Promise<void> {
  await new Promise((r) => setTimeout(r, 30));
}
