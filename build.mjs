import { build, context } from "esbuild";
const options = {
  entryPoints: ["src/main.jsx"],
  bundle: true,
  outfile: "public/app.js",
  write: !process.argv.includes("--check"),
  format: "iife",
  target: ["es2020"],
  jsx: "automatic",
  minify: !process.argv.includes("--watch"),
  define: {
    "process.env.NODE_ENV": JSON.stringify(
      process.argv.includes("--watch") ? "development" : "production",
    ),
  },
  logLevel: "info",
};
if (process.argv.includes("--watch")) {
  const ctx = await context(options);
  await ctx.watch();
  console.log(
    "React: cambios compilados automáticamente. Recarga http://127.0.0.1:8765/",
  );
} else await build(options);
