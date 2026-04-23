import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Standalone output empacota só o necessário pro runtime — corta ~80% da
  // imagem Docker vs copiar .next + node_modules inteiros. Crítico pra
  // deploy self-hosted em Hetzner/Portainer.
  // https://nextjs.org/docs/app/api-reference/config/next-config-js/output
  output: "standalone",

  // Logs de requisições server-side úteis pra Portainer (docker logs)
  logging: {
    fetches: {
      fullUrl: false,
    },
  },
};

export default nextConfig;
