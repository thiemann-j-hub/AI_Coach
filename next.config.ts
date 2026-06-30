import type {NextConfig} from 'next';

// Pulscraft-Hub-Front-Door: diese App lebt unter `/coach/*` (same origin,
// Azure Front Door pfadbasiert). NEXT_PUBLIC_BASE_PATH steuert basePath UND den
// `withBasePath`-Helfer (src/lib/base-path.ts) aus EINER Quelle. Default "/coach"
// auf diesem Branch; "" = Direkt-Modus (pulsecraft-coach.azurewebsites.net).
const basePath = process.env.NEXT_PUBLIC_BASE_PATH ?? '/coach';

const nextConfig: NextConfig = {
  // Azure App Service: ZIP-Deploy des standalone-Outputs (Playbook Gotcha 12)
  output: 'standalone',
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
