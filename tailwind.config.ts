import type {Config} from 'tailwindcss';

export default {
  darkMode: ['class'],
  content: [
    './src/pages/**/*.{js,ts,jsx,tsx,mdx}',
    './src/components/**/*.{js,ts,jsx,tsx,mdx}',
    './src/app/**/*.{js,ts,jsx,tsx,mdx}',
  ],
  theme: {
    container: {
      center: true,
      padding: "2rem",
      screens: {
        "2xl": "1400px",
      },
    },
    extend: {
      fontFamily: {
        body: ['var(--font-geist-sans)', 'Inter', 'sans-serif'],
        headline: ['var(--font-geist-sans)', 'Inter', 'sans-serif'],
        code: ['var(--font-geist-mono)', '"Source Code Pro"', 'monospace'],
        display: ["Inter", "sans-serif"],
        sans: ['var(--font-geist-sans)', 'Inter', 'sans-serif'],
        mono: ['var(--font-geist-mono)', 'monospace'],
      },
      borderRadius: {
        lg: "var(--radius)",
        md: "calc(var(--radius) - 2px)",
        sm: "calc(var(--radius) - 4px)",
        DEFAULT: "16px",
        'xl': '1.5rem',
      },
      boxShadow: {
        'glow': '0 0 20px rgba(0, 145, 255, 0.4)',
        'card-dark': '0 10px 30px -10px rgba(2, 12, 27, 0.7)',
        'card-light': '0 10px 30px -10px rgba(0, 0, 0, 0.1)',
        neon: "0 0 10px rgba(0, 145, 255, 0.4)",
      },
      colors: {
        // Reference Design Colors (PulseCraft)
        primary: {
          DEFAULT: "hsl(var(--primary))",
          foreground: "hsl(var(--primary-foreground))",
          hover: "#007ACC",
        },
        "primary-hover": "#007ACC",
        
        // PulseCraft Explicit Colors
        "background-light": "#F3F4F6",
        "background-dark": "#0A192F",
        "surface-light": "#FFFFFF",
        "surface-dark": "#112240",
        "border-light": "#E5E7EB",
        "border-dark": "#233554",
        "text-main-light": "#1F2937",
        "text-main-dark": "#E2E8F0",
        "text-muted-light": "#6B7280",
        "text-muted-dark": "#8892B0",

        "surface-highlight": "#112240",
        border: "hsl(var(--border))",
        input: "hsl(var(--input))",
        ring: "hsl(var(--ring))",
        background: "hsl(var(--background))",
        foreground: "hsl(var(--foreground))",
        secondary: {
          DEFAULT: "hsl(var(--secondary))",
          foreground: "hsl(var(--secondary-foreground))",
        },
        destructive: {
          DEFAULT: "hsl(var(--destructive))",
          foreground: "hsl(var(--destructive-foreground))",
        },
        muted: {
          DEFAULT: "hsl(var(--muted))",
          foreground: "hsl(var(--muted-foreground))",
        },
        accent: {
          DEFAULT: "hsl(var(--accent))",
          foreground: "hsl(var(--accent-foreground))",
        },
        popover: {
          DEFAULT: "hsl(var(--popover))",
          foreground: "hsl(var(--popover-foreground))",
        },
        card: {
          DEFAULT: "hsl(var(--card))",
          foreground: "hsl(var(--card-foreground))",
        },
        
        // Custom Aliases
        
        chart: {
          '1': 'hsl(var(--chart-1))',
          '2': 'hsl(var(--chart-2))',
          '3': 'hsl(var(--chart-3))',
          '4': 'hsl(var(--chart-4))',
          '5': 'hsl(var(--chart-5))',
        },
      },
      keyframes: {
        "accordion-down": {
          from: { height: "0" },
          to: { height: "var(--radix-accordion-content-height)" },
        },
        "accordion-up": {
          from: { height: "var(--radix-accordion-content-height)" },
          to: { height: "0" },
        },
      },
      animation: {
        "accordion-down": "accordion-down 0.2s ease-out",
        "accordion-up": "accordion-up 0.2s ease-out",
      },
    },
  },
  plugins: [require('tailwindcss-animate')],
} satisfies Config;
