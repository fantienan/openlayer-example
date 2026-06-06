import Bun from "bun";
import index from "./wmts/index.html";

const server = Bun.serve({
  routes: {
    "/wmts/*": index,
  },

  development: process.env.NODE_ENV !== "production" && {
    hmr: true,
    console: true,
  },
});

console.log(`🚀 加载WMTS ${server.url}wmts/`);
