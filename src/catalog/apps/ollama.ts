import type { AppDefinition } from "../types.js";

export const app: AppDefinition = {
  name: "ollama",
  description: "Ollama - run LLMs locally (API on port 11434)",
  upstreamPort: 11434,
  dirs: (ctx) => [`${ctx.paths.appdata}/ollama`],
  compose: (ctx) => ({
    image: "ollama/ollama:latest",
    container_name: "ollama",
    restart: "unless-stopped",
    networks: ["homestack"],
    volumes: [`${ctx.paths.appdata}/ollama:/root/.ollama`],
    environment: { TZ: ctx.timezone, OLLAMA_HOST: "0.0.0.0:11434" },
  }),
  note:
    "Pull a model: docker exec ollama ollama pull llama3.2. " +
    "API at https://ollama.local — models live under appdata/ollama (can be large).",
};
