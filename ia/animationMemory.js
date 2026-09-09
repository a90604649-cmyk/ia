import fs from "fs/promises";
import path from "path";

const MEMORY_DIR = path.join(process.cwd(), "animation_memory");
const MEMORY_FILE = path.join(MEMORY_DIR, "memory.json");

async function asegurarMemoria() {
    await fs.mkdir(MEMORY_DIR, { recursive: true });

    try {
        await fs.access(MEMORY_FILE);
    } catch {
        await fs.writeFile(
            MEMORY_FILE,
            JSON.stringify({
                references: []
            }, null, 4),
            "utf8"
        );
    }
}

async function cargarMemoria() {
    await asegurarMemoria();

    const contenido =
        await fs.readFile(
            MEMORY_FILE,
            "utf8"
        );

    return JSON.parse(contenido);
}

async function guardarMemoria(memoria) {
    await asegurarMemoria();

    await fs.writeFile(
        MEMORY_FILE,
        JSON.stringify(
            memoria,
            null,
            4
        ),
        "utf8"
    );
}

function calcularRango(valores) {
    if (!valores.length) {
        return 0;
    }

    return Math.max(...valores) -
        Math.min(...valores);
}

export async function guardarReferencia(animacion) {
    if (!animacion) {
        return null;
    }

    const memoria = await cargarMemoria();

    const partes = {};
    const tiempos = [];

    for (const keyframe of animacion.keyframes || []) {

        const tiempo =
            Number(keyframe.time) || 0;

        tiempos.push(tiempo);

        for (const pose of keyframe.poses || []) {

            if (!partes[pose.part]) {
                partes[pose.part] = {
                    rx: [],
                    ry: [],
                    rz: [],
                    x: [],
                    y: [],
                    z: []
                };
            }

            partes[pose.part].rx.push(
                Number(pose.rx) || 0
            );

            partes[pose.part].ry.push(
                Number(pose.ry) || 0
            );

            partes[pose.part].rz.push(
                Number(pose.rz) || 0
            );

            partes[pose.part].x.push(
                Number(pose.x) || 0
            );

            partes[pose.part].y.push(
                Number(pose.y) || 0
            );

            partes[pose.part].z.push(
                Number(pose.z) || 0
            );
        }
    }

    const caracteristicas = {};

    for (const nombreParte of Object.keys(partes)) {

        const datos =
            partes[nombreParte];

        caracteristicas[nombreParte] = {
            rotacionX: calcularRango(datos.rx),
            rotacionY: calcularRango(datos.ry),
            rotacionZ: calcularRango(datos.rz),

            desplazamientoX:
                calcularRango(datos.x),

            desplazamientoY:
                calcularRango(datos.y),

            desplazamientoZ:
                calcularRango(datos.z)
        };
    }

    const referencia = {
        id: Date.now().toString(),

        name:
            animacion.name ||
            "Animacion",

        rigType: "R6",

        duration:
            tiempos.length
                ? Math.max(...tiempos)
                : 0,

        keyframeCount:
            animacion.keyframes
                ? animacion.keyframes.length
                : 0,

        looped:
            Boolean(animacion.looped),

        priority:
            animacion.priority ||
            "Action",

        parts:
            caracteristicas,

        note:
            animacion.note ||
            "",

        createdAt:
            new Date().toISOString()
    };

    memoria.references.push(
        referencia
    );

    if (memoria.references.length > 30) {
        memoria.references =
            memoria.references.slice(-30);
    }

    await guardarMemoria(memoria);

    console.log(
        "🧠 Referencia de animación aprendida:",
        referencia.name
    );

    return referencia;
}

export async function obtenerReferencias(relevantes = []) {

    const memoria =
        await cargarMemoria();

    if (
        !memoria.references ||
        memoria.references.length === 0
    ) {
        return [];
    }

    if (
        !Array.isArray(relevantes) ||
        relevantes.length === 0
    ) {
        return memoria.references.slice(-8);
    }

    const texto =
        relevantes
            .join(" ")
            .toLowerCase();

    const resultados =
        memoria.references.filter(
            function(referencia) {

                const nombre =
                    referencia.name
                        .toLowerCase();

                const nota =
                    referencia.note
                        .toLowerCase();

                return (
                    texto.includes(nombre) ||
                    nombre.includes(texto) ||
                    nota.includes(texto)
                );
            }
        );

    return resultados.length > 0
        ? resultados.slice(-8)
        : memoria.references.slice(-8);
}

export async function crearContextoAprendido() {

    const referencias =
        await obtenerReferencias();

    if (!referencias.length) {
        return "";
    }

    let contexto =
        "REFERENCIAS DE ESTILO APRENDIDAS:\n\n";

    contexto +=
        "IMPORTANTE: estas referencias NO son animaciones para copiar.\n" +
        "NO reutilices sus keyframes.\n" +
        "NO copies sus poses.\n" +
        "NO combines animaciones existentes.\n" +
        "Úsalas únicamente para aprender características de movimiento.\n\n";

    for (const referencia of referencias) {

        contexto +=
            "Referencia: " +
            referencia.name +
            "\n";

        contexto +=
            "Duración: " +
            referencia.duration +
            "\n";

        contexto +=
            "Keyframes: " +
            referencia.keyframeCount +
            "\n";

        contexto +=
            "Loop: " +
            referencia.looped +
            "\n";

        if (referencia.note) {
            contexto +=
                "Nota del usuario: " +
                referencia.note +
                "\n";
        }

        contexto +=
            "Características de partes:\n";

        for (
            const parte of Object.keys(
                referencia.parts
            )
        ) {

            const datos =
                referencia.parts[parte];

            contexto +=
                "- " +
                parte +
                ": rotX=" +
                datos.rotacionX.toFixed(1) +
                "°, rotY=" +
                datos.rotacionY.toFixed(1) +
                "°, rotZ=" +
                datos.rotacionZ.toFixed(1) +
                "°\n";
        }

        contexto += "\n";
    }

    return contexto;
}