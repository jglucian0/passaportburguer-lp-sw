import type { Config } from "tailwindcss";
import animate from "tailwindcss-animate";

const config: Config = {
  darkMode: "class",
  content: ["./src/**/*.{ts,tsx}"],
  theme: {
    extend: {
      colors: {
        /* Fundo principal fixo da marca */
        background: "#03257a",
        navbar: "#021a5c",
        surface: "#042068",
        "surface-2": "#0a3294",
        border: "#1b44a8",
        foreground: "#ffffff",
        muted: "#cbd5e1",
        navy: "#03257a",
        ink: "#0b162c",
        "ink-soft": "#475569",
        paper: "#faf3e8",
        "paper-aged": "#f3e8d6",
        gold: "#f5a623",
        "gold-dark": "#e09112",
        bronze: "#cd8a29",
        brand: "rgb(var(--brand-rgb) / <alpha-value>)",
      },
      fontFamily: {
        sans: ["var(--font-sans)", "system-ui", "sans-serif"],
        poppins: ["var(--font-poppins)", "var(--font-sans)", "system-ui", "sans-serif"],
        display: ["var(--font-display)", "var(--font-sans)", "system-ui", "sans-serif"],
      },
      keyframes: {
        "card-wrap-in": {
          "0%": { opacity: "0" },
          "40%": { opacity: "0" },
          "100%": { opacity: "1" },
        },
        "stamp-in": {
          "0%": { opacity: "0", transform: "scale(2.2) rotate(-24deg)" },
          "55%": { opacity: "1", transform: "scale(0.9) rotate(-4deg)" },
          "100%": { opacity: "1", transform: "scale(1) rotate(-6deg)" },
        },
        float: {
          "0%, 100%": { transform: "translateY(0)" },
          "50%": { transform: "translateY(-10px)" },
        },
      },
      animation: {
        "card-wrap-in": "card-wrap-in 0.5s ease-out both",
        "stamp-in": "stamp-in 0.55s cubic-bezier(0.2, 0.8, 0.2, 1) both",
        float: "float 6s ease-in-out infinite",
      },
    },
  },
  plugins: [animate],
};

export default config;
