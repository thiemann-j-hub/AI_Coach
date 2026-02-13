const fs = require('fs');

const cssContent = `@tailwind base;
@tailwind components;
@tailwind utilities;

@layer base {
  :root {
    /* PulseCraft AI Theme (Updated Colors) */
    --background: 216 65% 11%;              /* #0A192F (Deep Background) */
    --foreground: 214 32% 91%;              /* #E2E8F0 (Main Text) */

    --card: 218 58% 16%;                    /* #112240 (Surface Card) */
    --card-foreground: 214 32% 91%;         /* #E2E8F0 */

    --popover: 218 58% 16%;
    --popover-foreground: 214 32% 91%;

    --primary: 206 100% 50%;                /* #0091FF (Primary Blue) */
    --primary-foreground: 0 0% 100%;        /* White */

    --secondary: 218 47% 20%;               /* #1B2D4B (Surface Highlight) */
    --secondary-foreground: 214 32% 91%;

    --muted: 218 47% 20%;                   /* Surface Highlight */
    --muted-foreground: 225 23% 61%;        /* #8892B0 (Secondary/Muted Text) */

    --accent: 271 91% 65%;                  /* #A855F7 (Accent Purple) */
    --accent-foreground: 0 0% 100%;

    --destructive: 0 84.2% 60.2%;
    --destructive-foreground: 210 40% 98%;

    --border: 218 47% 20%;                  /* #1B2D4B (or slightly lighter) */
    --input: 218 58% 16%;                   /* Surface Card */
    --ring: 206 100% 50%;                   /* Primary */

    --radius: 1rem;                         /* 16px (rounded-2xl) */
  }

  .dark {
    --background: 216 65% 11%;
    --foreground: 214 32% 91%;
    --card: 218 58% 16%;
    --card-foreground: 214 32% 91%;
    --popover: 218 58% 16%;
    --popover-foreground: 214 32% 91%;
    --primary: 206 100% 50%;
    --primary-foreground: 0 0% 100%;
    --secondary: 218 47% 20%;
    --secondary-foreground: 214 32% 91%;
    --muted: 218 47% 20%;
    --muted-foreground: 225 23% 61%;
    --accent: 271 91% 65%;
    --accent-foreground: 0 0% 100%;
    --destructive: 0 62.8% 30.6%;
    --destructive-foreground: 210 40% 98%;
    --border: 218 47% 20%;
    --input: 218 58% 16%;
    --ring: 206 100% 50%;
  }
}

@layer base {
  * {
    @apply border-border;
  }
  body {
    @apply bg-background text-foreground;
  }
}

@layer utilities {
  .glass-panel {
    @apply bg-[#112240]/80 backdrop-blur-xl border border-white/5 rounded-2xl shadow-lg p-6;
  }
  
  .text-gradient {
    @apply bg-clip-text text-transparent bg-gradient-to-r from-primary to-accent;
  }

  .shadow-neon {
    box-shadow: 0 0 10px rgba(0, 145, 255, 0.4);
  }
  
  .shadow-primary-glow {
    box-shadow: 0 0 20px rgba(0, 145, 255, 0.4);
  }
}
`;

fs.writeFileSync('src/app/globals.css', cssContent);
console.log('globals.css updated with precise design tokens');
