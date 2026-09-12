import { spawn } from "node:child_process";

const procesos = new Map();
let cerrando = false;

const CONFIG = [
    ["ProjectContext", "projectContextServer.js"],
    ["RobloxAI", "server.js"]
];

function iniciar(nombre, archivo, reintento = 0) {
    if (cerrando) return;

    console.log(`[${nombre}] iniciando ${archivo}...`);

    const proceso = spawn(process.execPath, ["--require", "./provider-router.cjs", archivo], {
        stdio: "inherit",
        env: process.env,
        cwd: process.cwd()
    });

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

        procesos.delete(nombre);

        // Reinicio automático para evitar que un cierre inesperado deje el bridge inutilizable.
        const espera = Math.min(5000, 1000 + reintento * 1000);
        console.log(`[${nombre}] reiniciando en ${espera} ms...`);

        setTimeout(() => {
            iniciar(nombre, archivo, reintento + 1);
        }, espera).unref();
    });
}

function cerrar() {
    if (cerrando) return;
    cerrando = true;

    console.log("Cerrando Roblox AI Bridge...");

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

for (const [nombre, archivo] of CONFIG) {
    iniciar(nombre, archivo);
}

// Mantiene vivo el proceso supervisor aunque un hijo termine inmediatamente.
process.stdin.resume();

console.log("=================================");
console.log("🚀 ROBLOX AI BRIDGE");
console.log("=================================");
console.log("OmniRoute (auto) + Groq directo de respaldo");
console.log("Project Context: puerto 3001");
console.log("Roblox AI: puerto 3000");
console.log("=================================\n");
