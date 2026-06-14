import type { Config } from "tailwindcss";

/**
 * "Ember-ink" – mörkt tema, en varm accent, allt annat dämpat.
 * Tokens speglas även som CSS-variabler i app/globals.css.
 */
const config: Config = {
  content: ["./app/**/*.{ts,tsx}", "./components/**/*.{ts,tsx}", "./lib/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        bg: "#F6F7FB",
        surface: "#FFFFFF",
        surface2: "#EEF4FF",
        line: "#D9E1EC",
        text: "#172033",
        muted: "#536173",
        faint: "#8A96A8",
        ember: "#2563EB",
        gold: "#0F766E",
        green: "#16A34A",
      },
      borderRadius: {
        card: "14px",
      },
      fontFamily: {
        sans: [
          "system-ui",
          "-apple-system",
          "Segoe UI",
          "Roboto",
          "Helvetica Neue",
          "Arial",
          "sans-serif",
        ],
      },
      letterSpacing: {
        eyebrow: "0.16em",
      },
      maxWidth: {
        app: "30rem", // mobile-first kolumn (~480px)
      },
    },
  },
  plugins: [],
};

export default config;
