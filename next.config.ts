import type {NextConfig} from 'next';

// Pulscraft-Hub-Front-Door: diese App lebt unter `/coach/*` (same origin,
// Azure Front Door pfadbasiert). NEXT_PUBLIC_BASE_PATH steuert basePath UND den
// `withBasePath`-Helfer (src/lib/base-path.ts) aus EINER Quelle. Default "/coach"
// auf diesem Branch; "" = Direkt-Modus (pulsecraft-coach.azurewebsites.net).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/coach';

const nextConfig: NextConfig = {
  // Azure App Service: ZIP-Deploy des standalone-Outputs (Playbook Gotcha 12)
  output: 'standalone',
  // Sprachmodus Live (N4-231), Live-Befund 28.10.: Gebündelt verbiegt Next die WebSocket-Bibliothek
  // („b.mask is not a function“ beim Verbinden zu Gemini Live). Beide Pakete bleiben echte
  // node_modules-Module — so, wie die Probe sie lief; der Standalone-Export kopiert sie mit.
  serverExternalPackages: ['ws', '@google/genai'],
  // basePath/assetPrefix nur setzen, wenn nicht leer (Next verbietet basePath="").
  ...(basePath ? { basePath, assetPrefix: basePath } : {}),
  // basePath an Client + Server durchreichen, damit `withBasePath` denselben
  // Wert sieht (NEXT_PUBLIC_ wird inline ersetzt).
  env: { NEXT_PUBLIC_BASE_PATH: basePath },
  images: {
    remotePatterns: [
      {
        protocol: 'https',
        hostname: 'placehold.co',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'images.unsplash.com',
        port: '',
        pathname: '/**',
      },
      {
        protocol: 'https',
        hostname: 'picsum.photos',
        port: '',
        pathname: '/**',
      },
    ],
  },
};

export default nextConfig;
