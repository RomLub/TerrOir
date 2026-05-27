// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { renderHook, act } from "@testing-library/react";
import { useTabFocusFromQuery } from "@/app/(producer)/ma-page/_lib/use-tab-focus";

// Stub ReadonlyURLSearchParams via URLSearchParams (interface identique pour
// `.get`). Le type côté hook est purement compile-time, runtime accepte.
function makeSearchParams(query: string) {
  return new URLSearchParams(query) as unknown as ReturnType<
    typeof useTabFocusFromQuery extends (sp: infer S, ...args: never) => void
      ? () => S
      : never
  >;
}

describe("useTabFocusFromQuery — activation onglet + scroll cible", () => {
  let scrollIntoView: ReturnType<typeof vi.fn>;

  beforeEach(() => {
    scrollIntoView = vi.fn();
    // Stub global de scrollIntoView (jsdom ne l'implémente pas par défaut).
    Element.prototype.scrollIntoView =
      scrollIntoView as unknown as Element["scrollIntoView"];
    // requestAnimationFrame stub synchrone : exécute le callback immédiatement
    // pour que les assertions du test ne dépendent pas du timing browser.
    vi.stubGlobal("requestAnimationFrame", (cb: FrameRequestCallback) => {
      cb(0);
      return 0;
    });
  });

  it("sans query params : ne switche pas l'onglet, pas de scroll", () => {
    const setTab = vi.fn();
    renderHook(() => useTabFocusFromQuery(makeSearchParams(""), setTab));
    expect(setTab).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("?tab=edit : switche vers edit, pas de scroll (focus absent)", () => {
    const setTab = vi.fn();
    renderHook(() => useTabFocusFromQuery(makeSearchParams("tab=edit"), setTab));
    expect(setTab).toHaveBeenCalledWith("edit");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });

  it("?tab=edit&focus=<id> : switche vers edit ET scrolle vers l'élément", () => {
    const setTab = vi.fn();
    const target = document.createElement("div");
    target.id = "ma-page-description";
    document.body.appendChild(target);

    act(() => {
      renderHook(() =>
        useTabFocusFromQuery(
          makeSearchParams("tab=edit&focus=ma-page-description"),
          setTab,
        ),
      );
    });

    expect(setTab).toHaveBeenCalledWith("edit");
    expect(scrollIntoView).toHaveBeenCalledTimes(1);
    expect(scrollIntoView).toHaveBeenCalledWith({
      behavior: "smooth",
      block: "center",
    });

    document.body.removeChild(target);
  });

  it("?focus=<id> sans tab=edit : ignoré (choix défensif — pas de switch, pas de scroll)", () => {
    const setTab = vi.fn();
    const target = document.createElement("div");
    target.id = "ma-page-description";
    document.body.appendChild(target);

    renderHook(() =>
      useTabFocusFromQuery(
        makeSearchParams("focus=ma-page-description"),
        setTab,
      ),
    );

    expect(setTab).not.toHaveBeenCalled();
    expect(scrollIntoView).not.toHaveBeenCalled();

    document.body.removeChild(target);
  });

  it("?tab=edit&focus=<id-inexistant> : switche vers edit, scrollIntoView pas appelé (élément absent)", () => {
    const setTab = vi.fn();
    renderHook(() =>
      useTabFocusFromQuery(
        makeSearchParams("tab=edit&focus=does-not-exist"),
        setTab,
      ),
    );
    expect(setTab).toHaveBeenCalledWith("edit");
    expect(scrollIntoView).not.toHaveBeenCalled();
  });
});
