import type { ReactNode } from "react";

const TERROIR_GREEN = "#2D6A4F";
const TERROIR_BG = "#F7F4EF";
const TERROIR_TERRACOTTA = "#A0522D";

export const emailTheme = {
  green: TERROIR_GREEN,
  bg: TERROIR_BG,
  terracotta: TERROIR_TERRACOTTA,
};

export function EmailLayout({
  // title est conservé dans la signature pour compat avec les templates,
  // mais n'est pas rendu : les clients email ignorent <title> et la balise
  // native <head> déclenche @next/next/no-head-element au build Next.
  title: _title,
  children,
}: {
  title: string;
  children: ReactNode;
}) {
  void _title;
  return (
    <html lang="fr">
      <body
        style={{
          margin: 0,
          padding: 0,
          backgroundColor: TERROIR_BG,
          color: "#1a1a1a",
          fontFamily:
            "-apple-system, BlinkMacSystemFont, 'Segoe UI', system-ui, sans-serif",
        }}
      >
        <table
          role="presentation"
          width="100%"
          cellPadding={0}
          cellSpacing={0}
          style={{ backgroundColor: TERROIR_BG }}
        >
          <tbody>
            <tr>
              <td align="center" style={{ padding: "32px 16px" }}>
                <table
                  role="presentation"
                  width="600"
                  cellPadding={0}
                  cellSpacing={0}
                  style={{
                    maxWidth: 600,
                    backgroundColor: "#ffffff",
                    borderRadius: 8,
                    overflow: "hidden",
                  }}
                >
                  <tbody>
                    <tr>
                      <td
                        style={{
                          backgroundColor: TERROIR_GREEN,
                          padding: "20px 24px",
                          color: "#fff",
                          fontSize: 20,
                          fontWeight: 700,
                        }}
                      >
                        TerrOir
                      </td>
                    </tr>
                    <tr>
                      <td style={{ padding: "24px", fontSize: 15, lineHeight: 1.55 }}>
                        {children}
                      </td>
                    </tr>
                    <tr>
                      <td
                        style={{
                          padding: "16px 24px",
                          fontSize: 12,
                          color: "#6b6b6b",
                          borderTop: "1px solid #eee",
                        }}
                      >
                        TerrOir — la marketplace des produits du terroir.
                        <br />
                        Cet email est automatique, merci de ne pas y répondre.
                      </td>
                    </tr>
                  </tbody>
                </table>
              </td>
            </tr>
          </tbody>
        </table>
      </body>
    </html>
  );
}
