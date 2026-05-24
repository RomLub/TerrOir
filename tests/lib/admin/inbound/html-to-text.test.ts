import { describe, it, expect } from "vitest";
import { htmlToPlainText } from "@/lib/admin/inbound/html-to-text";

describe("htmlToPlainText", () => {
  it("null/vide → chaîne vide", () => {
    expect(htmlToPlainText(null)).toBe("");
    expect(htmlToPlainText("")).toBe("");
  });

  it("strip les balises + garde le texte", () => {
    expect(htmlToPlainText("<p>Bonjour <b>Marie</b></p>")).toBe("Bonjour Marie");
  });

  it("<br> et </p> → sauts de ligne", () => {
    const r = htmlToPlainText("<p>Ligne 1</p><p>Ligne 2<br>Ligne 3</p>");
    expect(r).toBe("Ligne 1\nLigne 2\nLigne 3");
  });

  it("ignore <style>/<script>", () => {
    const r = htmlToPlainText("<style>.x{color:red}</style><p>Texte</p><script>alert(1)</script>");
    expect(r).toBe("Texte");
    expect(r).not.toContain("alert");
    expect(r).not.toContain("color");
  });

  it("décode les entités structurelles + numériques", () => {
    expect(htmlToPlainText("Caf&#233; &amp; the&#769;... &lt;ok&gt;")).toContain("Café");
    expect(htmlToPlainText("a &lt;b&gt; c &amp; d")).toBe("a <b> c & d");
  });

  it("normalise les lignes vides multiples", () => {
    expect(htmlToPlainText("<p>A</p><p></p><p></p><p>B</p>")).toBe("A\n\nB");
  });
});
