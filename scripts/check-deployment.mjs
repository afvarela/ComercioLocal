const [baseUrl, expectedVersion = "3.3.0"] = process.argv.slice(2);

if (!baseUrl) {
  console.error("Falta la URL publica para verificar.");
  process.exit(2);
}

async function get(path, type = "text") {
  const separator = path.includes("?") ? "&" : "?";
  const response = await fetch(`${baseUrl.replace(/\/$/, "")}${path}${separator}check=${Date.now()}`, {
    signal: AbortSignal.timeout(20000),
    headers: { "Cache-Control": "no-cache" },
  });
  if (!response.ok) throw new Error(`${path} respondio HTTP ${response.status}`);
  return type === "json" ? response.json() : response.text();
}

let lastError;
for (let attempt = 1; attempt <= 12; attempt += 1) {
  try {
    const [status, html, bundle, serviceWorker, manifest] = await Promise.all([
      get("/api/status", "json"),
      get("/"),
      get("/app.js"),
      get("/sw.js"),
      get("/manifest.webmanifest", "json"),
    ]);
    if (status.cloud !== true || status.version !== expectedVersion || typeof status.setup !== "boolean")
      throw new Error(`Estado inesperado: ${JSON.stringify(status)}`);
    if (!html.includes("/app.js")) throw new Error("La pagina principal no carga app.js");
    if (!bundle.includes("PIN de acceso") || !bundle.includes("[0-9]{4}"))
      throw new Error("El archivo publicado no contiene el PIN numerico de cuatro digitos");
    if (/\bproduction\s*===/.test(bundle))
      throw new Error("React fue compilado con una variable production invalida");
    if (/cache\.put\([^;]+response\.clone\(\)/.test(serviceWorker))
      throw new Error("El Service Worker clona la respuesta demasiado tarde");
    if (manifest.display !== "standalone" || !serviceWorker.includes('request.mode === "navigate"'))
      throw new Error("La version publicada no tiene el arranque PWA offline completo");
    if (/m.nimo 10 caracteres/i.test(bundle))
      throw new Error("El archivo publicado todavia contiene el texto de la clave anterior");
    console.log(`Aplicacion publica verificada: ${baseUrl}`);
    console.log(`Worker ${status.version}; configuracion inicial pendiente: ${status.setup ? "si" : "no"}`);
    process.exit(0);
  } catch (error) {
    lastError = error;
    if (attempt < 12) {
      console.log(`Esperando propagacion de Cloudflare (${attempt}/12): ${error.message}`);
      await new Promise((resolve) => setTimeout(resolve, 5000));
    }
  }
}

console.error(`La aplicacion publicada no paso la verificacion: ${lastError?.message || lastError}`);
process.exit(1);



