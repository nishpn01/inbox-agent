import react from '@vitejs/plugin-react';
import { defineConfig, loadEnv, type Plugin } from 'vite';

// In dev, serve api/agent.ts the way Vercel does in production, so `npm run dev` is enough.
function api(): Plugin {
  return {
    name: 'local-api',
    configureServer(server) {
      server.middlewares.use('/api/agent', async (req, res) => {
        const chunks: Buffer[] = [];
        for await (const c of req) chunks.push(c as Buffer);
        const { POST } = await server.ssrLoadModule('/api/agent.ts');
        const r: Response = await POST(new Request('http://local/api/agent', { method: 'POST', body: Buffer.concat(chunks) }));
        res.statusCode = r.status;
        res.setHeader('Content-Type', 'application/json');
        res.end(await r.text());
      });
    },
  };
}

export default defineConfig(({ mode }) => {
  Object.assign(process.env, loadEnv(mode, process.cwd(), ''));
  return { plugins: [react(), api()] };
});
