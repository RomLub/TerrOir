/** @type {import('tailwindcss').Config} */
module.exports = {
  content: [
    "./app/**/*.{js,ts,jsx,tsx,mdx}",
    "./components/**/*.{js,ts,jsx,tsx,mdx}",
  ],
  theme: {
    extend: {
      colors: {
        bg: "#F7F4EF",
        dark: "#1A1A1A",
        green: {
          50: "#F1FAF3",
          100: "#D8F3DC",
          200: "#B7E4C7",
          300: "#95D5B2",
          400: "#74C69D",
          500: "#52B788",
          600: "#40916C",
          700: "#2D6A4F",
          800: "#1B4332",
          900: "#081C15",
        },
        terra: {
          100: "#F5E6DC",
          300: "#D4A373",
          500: "#B8713E",
          700: "#A0522D",
          900: "#6B3620",
        },
        terroir: {
          green: "#2D6A4F",
          "green-100": "#D8F3DC",
          "green-700": "#2D6A4F",
          "green-light": "#D8F3DC",
          terra: "#A0522D",
          "terra-100": "#F5E6DC",
          "terra-700": "#A0522D",
          terracotta: "#A0522D",
          bg: "#F7F4EF",
          ink: "#1A1A1A",
          muted: "#6B7280",
          border: "#E6E1D6",
        },
      },
      boxShadow: {
        soft: "0 2px 12px rgba(27, 67, 50, 0.06)",
        card: "0 4px 16px rgba(27, 67, 50, 0.08)",
      },
      fontFamily: {
        sans: ["var(--font-inter)", "system-ui", "-apple-system", "Segoe UI", "sans-serif"],
        serif: ["var(--font-cormorant)", "Cormorant Garamond", "Georgia", "serif"],
      },
    },
  },
  plugins: [],
};
