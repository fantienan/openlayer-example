import Bun from "bun";
import wmtsIndex from "./wmts/index.html";

const server = Bun.serve({
  routes: {
    "/wmts/*": wmtsIndex,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 WMTS: ${server.url}wmts/`);
