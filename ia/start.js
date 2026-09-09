import { spawn } from "node:child_process";

const procesos = [];
let cerrando = false;

function iniciar(nombre, archivo) {
    const proceso = spawn(process.execPath, [archivo], {
        stdio: "inherit",
        env: process.env
    });

    procesos.push({
        nombre,
        proceso
    });

    proceso.on("exit", (code, signal) => {
        if (cerrando) {
            return;
        }

        console.error(
            `[${nombre}] terminó con code=${code} signal=${signal || "none"}`
        );

        for (const item of procesos) {
            if (item.proceso !== proceso && !item.proceso.killed) {
                item.proceso.kill("SIGTERM");
            }
        }

        process.exit(code ?? 1);
    });
}

function cerrar() {
    if (cerrando) {
        return;
    }

    cerrando = true;

    for (const { proceso } of procesos) {
        if (!proceso.killed) {
            proceso.kill("SIGTERM");
        }
    }
}

process.on("SIGINT", cerrar);
process.on("SIGTERM", cerrar);

iniciar("ProjectContext", "projectContextServer.js");
iniciar("RobloxAI", "server.js");
