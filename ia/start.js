import { spawn } from "node:child_process";
import { createServer } from "node:http";
import { existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import path from "node:path";

const procesos = new Map();
let robloxAiProcess = null;
let requestWindowProcess = null;
let cerrando = false;

const INPUT_PORT = Number(process.env.BRIDGE_INPUT_PORT || 3030);
const DIR = path.dirname(fileURLToPath(import.meta.url));
const REQUEST_WINDOW = path.join(DIR, "request-window.ps1");

const CONFIG = [
    ["ProjectContext", "projectContextServer.js"],
    ["RobloxAI", "server.js"]
];

function iniciar(nombre, archivo, reintento = 0) {
    if (cerrando) return;

    console.log(`[${nombre}] iniciando ${archivo}...`);

    const esRobloxAI = nombre === "RobloxAI";
    const proceso = spawn(process.execPath, [archivo], {
        stdio: esRobloxAI ? ["pipe", "inherit", "inherit"] : "inherit",
        env: process.env,
        cwd: process.cwd()
    });

    if (esRobloxAI) robloxAiProcess = proceso;
    procesos.set(nombre, proceso);

    proceso.on("error", (error) => {
        if (cerrando) return;
        console.error(`[${nombre}] error al iniciar:`, error instanceof Error ? error.message : String(error));
    });

    proceso.on("exit", (code, signal) => {
        if (cerrando) return;

        console.error(
            `[${nombre}] terminó con code=${code ?? "null"} signal=${signal || "none"}`
        );

        if (esRobloxAI && robloxAiProcess === proceso) robloxAiProcess = null;
        procesos.delete(nombre);

        const espera = Math.min(5000, 1000 + reintento * 1000);
        console.log(`[${nombre}] reiniciando en ${espera} ms...`);

        setTimeout(() => {
            iniciar(nombre, archivo, reintento + 1);
        }, espera).unref();
    });
}

function enviarPeticionAlBridge(mensaje) {
    const texto = String(mensaje || "").trim();

    if (!texto) {
        return { ok: false, status: 400, error: "La petición está vacía." };
    }

    if (!robloxAiProcess || robloxAiProcess.killed || !robloxAiProcess.stdin?.writable) {
        return { ok: false, status: 503, error: "El servidor Roblox AI todavía no está disponible." };
    }

    try {
        robloxAiProcess.stdin.write(`${texto}\n`);
        console.log(`📝 Petición recibida desde la ventana: ${texto}`);
        return { ok: true, status: 200 };
    } catch (error) {
        return {
            ok: false,
            status: 500,
            error: error instanceof Error ? error.message : String(error)
        };
    }
}

function iniciarServidorEntrada() {
    const server = createServer(async (req, res) => {
        res.setHeader("Access-Control-Allow-Origin", "*");
        res.setHeader("Access-Control-Allow-Headers", "Content-Type");
        res.setHeader("Access-Control-Allow-Methods", "GET,POST,OPTIONS");

        if (req.method === "OPTIONS") {
            res.writeHead(204);
            res.end();
            return;
        }

        if (req.method === "GET" && req.url === "/health") {
            const body = JSON.stringify({
                ok: true,
                bridgeInput: true,
                robloxAiRunning: Boolean(robloxAiProcess && !robloxAiProcess.killed)
            });
            res.writeHead(200, { "Content-Type": "application/json; charset=utf-8" });
            res.end(body);
            return;
        }

        if (req.method === "POST" && req.url === "/ask") {
            let raw = "";

            req.setEncoding("utf8");
            for await (const chunk of req) {
                raw += chunk;
                if (raw.length > 1024 * 256) {
                    res.writeHead(413, { "Content-Type": "application/json; charset=utf-8" });
                    res.end(JSON.stringify({ ok: false, error: "Petición demasiado grande." }));
                    return;
                }
            }

            try {
                const payload = JSON.parse(raw || "{}");
                const result = enviarPeticionAlBridge(payload.message);
                res.writeHead(result.status, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify(result));
            } catch (error) {
                res.writeHead(400, { "Content-Type": "application/json; charset=utf-8" });
                res.end(JSON.stringify({
                    ok: false,
                    error: error instanceof Error ? error.message : String(error)
                }));
            }
            return;
        }

        res.writeHead(404, { "Content-Type": "application/json; charset=utf-8" });
        res.end(JSON.stringify({ ok: false, error: "Ruta no encontrada." }));
    });

    server.on("error", (error) => {
        console.error(`[BridgeInput] error en puerto ${INPUT_PORT}:`, error instanceof Error ? error.message : String(error));
    });

    server.listen(INPUT_PORT, "127.0.0.1", () => {
        console.log(`[BridgeInput] ventana de peticiones: http://127.0.0.1:${INPUT_PORT}`);
    });

    return server;
}

function iniciarVentanaDePeticiones() {
    if (process.platform !== "win32") {
        console.log("[BridgeInput] La ventana gráfica está implementada para Windows.");
        return;
    }

    if (!existsSync(REQUEST_WINDOW)) {
        console.warn("[BridgeInput] No se encontró request-window.ps1.");
        return;
    }

    requestWindowProcess = spawn(
        "powershell.exe",
        ["-NoProfile", "-ExecutionPolicy", "Bypass", "-File", REQUEST_WINDOW, String(INPUT_PORT)],
        {
            cwd: DIR,
            stdio: "inherit",
            windowsHide: false,
            env: process.env
        }
    );

    requestWindowProcess.on("error", (error) => {
        console.error("[BridgeInput] No se pudo abrir la ventana:", error instanceof Error ? error.message : String(error));
    });

    requestWindowProcess.on("exit", () => {
        requestWindowProcess = null;
    });
}

function cerrar() {
    if (cerrando) return;
    cerrando = true;

    console.log("Cerrando Roblox AI Bridge...");

    if (requestWindowProcess && !requestWindowProcess.killed) {
        requestWindowProcess.kill();
    }

    for (const [nombre, proceso] of procesos) {
        if (!proceso.killed) {
            console.log(`[${nombre}] deteniendo...`);
            proceso.kill("SIGTERM");
        }
    }

    procesos.clear();

    setTimeout(() => {
        process.exit(0);
    }, 250).unref();
}

process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);

const inputServer = iniciarServidorEntrada();

for (const [nombre, archivo] of CONFIG) {
    iniciar(nombre, archivo);
}

setTimeout(iniciarVentanaDePeticiones, 900);

process.stdin.resume();

console.log("=================================");
console.log("🚀 ROBLOX AI BRIDGE");
console.log("=================================");
console.log("OmniRoute (auto) — proveedor único");
console.log("Project Context: puerto 3001");
console.log("Roblox AI: puerto 3000");
console.log(`Ventana de peticiones: puerto ${INPUT_PORT}`);
console.log("La consola queda para logs y errores.");
console.log("=================================\n");

process.on("exit", () => {
    inputServer.close();
});
