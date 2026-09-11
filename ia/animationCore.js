import fs from "fs/promises";
import path from "path";
import { preguntarGroq, parsearRespuestaJson } from "./groq.js";
import {
    ANIMATION_MODEL,
    MEMORY_FILE_PARTS,
    R6_PARTS,
    R6_JOINTS,
    R6_RIG_NAME,
    R6_RIG_TYPE,
    R6_RIG_PATH,
    ANIMATION_SYSTEM
} from "./animationConfig.js";

const MEMORY_FILE = path.join(process.cwd(), ...MEMORY_FILE_PARTS);

async function cargarMemoria() {
    try {
        await fs.mkdir(path.dirname(MEMORY_FILE), { recursive: true });

        try {
            await fs.access(MEMORY_FILE);
        } catch {
            await fs.writeFile(
                MEMORY_FILE,
                JSON.stringify({ references: [] }, null, 4),
                "utf8"
            );
        }

        const contenido = await fs.readFile(MEMORY_FILE, "utf8");
        const memoria = JSON.parse(contenido);

        return memoria && Array.isArray(memoria.references)
            ? memoria
            : { references: [] };
    } catch (error) {
        console.error(
            "❌ No se pudo cargar la memoria de animaciones:",
            error instanceof Error ? error.message : String(error)
        );
        return { references: [] };
    }
}

function resumirReferencia(referencia) {
    const partes = [];

    partes.push("REFERENCIA DE APRENDIZAJE:");
    partes.push(`Nombre: ${String(referencia?.name || "Sin nombre")}`);
    partes.push(`Tipo de rig: R6`);
    partes.push(`Duración aproximada: ${Number(referencia?.duration || 0).toFixed(2)} segundos`);
    partes.push(`Cantidad de keyframes: ${Number(referencia?.keyframeCount || 0)}`);

    if (referencia?.note) {
        partes.push(`Observación: ${String(referencia.note)}`);
    }

    if (referencia?.parts && typeof referencia.parts === "object") {
        partes.push("Características por parte:");
        for (const parte of Object.keys(referencia.parts)) {
            const datos = referencia.parts[parte] || {};
            partes.push(
                `- ${parte}: rotX=${Number(datos.rotacionX || 0).toFixed(1)}°, ` +
                `rotY=${Number(datos.rotacionY || 0).toFixed(1)}°, ` +
                `rotZ=${Number(datos.rotacionZ || 0).toFixed(1)}°, ` +
                `desplazamiento=(${Number(datos.desplazamientoX || 0).toFixed(2)}, ` +
                `${Number(datos.desplazamientoY || 0).toFixed(2)}, ` +
                `${Number(datos.desplazamientoZ || 0).toFixed(2)})`
            );
        }
    }

    return partes.join("\n");
}

async function crearContextoMemoria() {
    const memoria = await cargarMemoria();
    if (!memoria.references.length) return "";

    return [
        "MEMORIA DE ANIMACIÓN:",
        "Las siguientes animaciones son únicamente REFERENCIAS DE ESTILO.",
        "No copies sus keyframes ni sus poses literalmente.",
        "Extrae solamente patrones generales de movimiento, coordinación y calidad.",
        "",
        ...memoria.references.slice(-8).map(resumirReferencia)
    ].join("\n\n");
}

function obtenerTextoHistorial(mensaje) {
    if (!mensaje) return "";
    if (typeof mensaje.text === "string") return mensaje.text;
    if (Array.isArray(mensaje.parts)) {
        return mensaje.parts.map((parte) => parte?.text || "").join(" ");
    }
    return "";
}

function crearContextoConversacion(historial) {
    if (!Array.isArray(historial)) return "";

    return historial
        .slice(-8)
        .map((mensaje) => {
            const rol = mensaje?.role === "user" ? "Usuario" : "Asistente";
            return `${rol}: ${obtenerTextoHistorial(mensaje)}`;
        })
        .join("\n");
}

async function crearPrompt(mensajeUsuario, historial, r6Calibration) {
    const memoria = await crearContextoMemoria();
    const conversacion = crearContextoConversacion(historial);
    const calibracion = r6Calibration
        ? [
            "CALIBRACIÓN R6 REAL RECIBIDA:",
            `Rig: ${r6Calibration.rigName || R6_RIG_NAME}`,
            `Joints calibrados: ${Object.keys(r6Calibration.joints || {}).length}`,
            `Frente: ${JSON.stringify(r6Calibration.forwardWorld || null)}`,
            `Derecha: ${JSON.stringify(r6Calibration.rightWorld || null)}`,
            `Arriba: ${JSON.stringify(r6Calibration.upWorld || null)}`
        ].join("\n")
        : "";

    return [
        ANIMATION_SYSTEM,
        `MODELO: ${ANIMATION_MODEL}`,
        `RIG OBJETIVO: ${R6_RIG_PATH}`,
        `RIG NAME: ${R6_RIG_NAME}`,
        `RIG TYPE: ${R6_RIG_TYPE}`,
        `PARTES R6 PERMITIDAS: ${R6_PARTS.join(", ")}`,
        `JOINTS R6: ${R6_JOINTS.join(", ")}`,
        memoria,
        conversacion ? `CONTEXTO RECIENTE:\n${conversacion}` : "",
        calibracion,
        `PETICIÓN DEL USUARIO:\n${mensajeUsuario}`,
        "",
        "PROCESO OBLIGATORIO:",
        "1. Comprende la acción completa.",
        "2. Divide el movimiento en fases naturales cuando corresponda.",
        "3. Diseña coordinación corporal entre torso, brazos, piernas y cabeza.",
        "4. Crea keyframes NUEVOS y coherentes.",
        "5. Revisa continuidad, dirección y proporciones.",
        "6. Comprueba que solo uses partes del R6.",
        "7. Respeta exactamente la duración solicitada si el usuario la proporciona.",
        "",
        "DEVUELVE ÚNICAMENTE JSON VÁLIDO con esta forma:",
        "{\"reply\":\"resumen breve\",\"animations\":[{\"name\":\"...\",\"path\":\"Workspace/dummy\",\"rigName\":\"dummy\",\"rigType\":\"R6\",\"looped\":false,\"priority\":\"Action\",\"duration\":1.0,\"phases\":[{\"name\":\"...\",\"start\":0,\"end\":0.5}],\"keyframes\":[{\"time\":0,\"poses\":[{\"part\":\"Torso\",\"x\":0,\"y\":0,\"z\":0,\"rx\":0,\"ry\":0,\"rz\":0}]}]}]}",
        "Cada pose debe incluir part, x, y, z, rx, ry y rz."
    ].filter(Boolean).join("\n\n");
}

function limitarNumero(valor, minimo, maximo) {
    return Math.min(maximo, Math.max(minimo, Number(valor) || 0));
}

function validarPose(pose) {
    if (!pose || !R6_PARTS.includes(pose.part)) return false;

    return [pose.x, pose.y, pose.z, pose.rx, pose.ry, pose.rz]
        .every((valor) => typeof valor === "number" && Number.isFinite(valor));
}

function validarAnimacion(animacion) {
    if (!animacion || typeof animacion.name !== "string" || !animacion.name.trim()) return false;
    if (animacion.path !== R6_RIG_PATH) return false;
    if (animacion.rigName !== R6_RIG_NAME) return false;
    if (animacion.rigType !== R6_RIG_TYPE) return false;
    if (!Array.isArray(animacion.keyframes) || animacion.keyframes.length < 2) return false;

    const duration = Number(animacion.duration);
    if (!Number.isFinite(duration) || duration <= 0) return false;

    let previousTime = -1;
    for (const keyframe of animacion.keyframes) {
        if (!keyframe || typeof keyframe.time !== "number" || !Number.isFinite(keyframe.time)) return false;
        if (keyframe.time < previousTime || keyframe.time < 0 || keyframe.time > duration + 0.05) return false;
        if (!Array.isArray(keyframe.poses)) return false;
        if (!keyframe.poses.every(validarPose)) return false;
        previousTime = keyframe.time;
    }

    return true;
}

function normalizarPose(pose) {
    return {
        part: pose.part,
        x: limitarNumero(pose.x, -5, 5),
        y: limitarNumero(pose.y, -5, 5),
        z: limitarNumero(pose.z, -5, 5),
        rx: limitarNumero(pose.rx, -180, 180),
        ry: limitarNumero(pose.ry, -180, 180),
        rz: limitarNumero(pose.rz, -180, 180)
    };
}

function convertirResultado(resultado) {
    if (!resultado || !Array.isArray(resultado.animations)) return null;

    const actions = [];

    for (const animation of resultado.animations) {
        if (!validarAnimacion(animation)) {
            console.warn(`⚠️ Animación rechazada por validación: ${animation?.name || "sin nombre"}`);
            continue;
        }

        const keyframes = animation.keyframes
            .map((keyframe) => ({
                time: Number(keyframe.time),
                poses: keyframe.poses.map(normalizarPose)
            }))
            .sort((a, b) => a.time - b.time);

        if (keyframes.length < 2) continue;

        actions.push({
            type: "create_animation",
            name: animation.name,
            path: R6_RIG_PATH,
            rigName: R6_RIG_NAME,
            rigType: R6_RIG_TYPE,
            looped: Boolean(animation.looped),
            priority: animation.priority || "Action",
            duration: Number(animation.duration) || keyframes[keyframes.length - 1].time,
            phases: Array.isArray(animation.phases) ? animation.phases : [],
            keyframes
        });
    }

    return actions.length
        ? {
            reply: String(resultado.reply || "Animación R6 generada correctamente."),
            actions
        }
        : null;
}

export async function generarAnimacion(mensajeUsuario, historial, r6Calibration) {
    const prompt = await crearPrompt(mensajeUsuario, historial, r6Calibration);

    for (let intento = 1; intento <= 3; intento++) {
        try {
            console.log(`\n🎞️ Groq generando animación con ${ANIMATION_MODEL} (intento ${intento}/3)...`);

            const texto = await preguntarGroq(
                [
                    {
                        role: "system",
                        content: "Genera animaciones profesionales y coherentes para Roblox R6. Respeta estrictamente el formato JSON solicitado."
                    },
                    { role: "user", content: prompt }
                ],
                {
                    model: ANIMATION_MODEL,
                    json: true,
                    reasoningEffort: "default",
                    reasoningFormat: "hidden",
                    temperature: 0.6,
                    maxCompletionTokens: 16384,
                    attemptsPerKey: 2
                }
            );

            const resultado = parsearRespuestaJson(texto);
            const convertido = convertirResultado(resultado);

            if (!convertido) {
                throw new Error("Groq devolvió una animación que no pasó la validación R6.");
            }

            console.log(`✅ Animación válida generada por ${ANIMATION_MODEL}.`);
            console.log(`🎬 Acciones de animación: ${convertido.actions.length}`);
            return convertido;
        } catch (error) {
            const mensaje = error instanceof Error ? error.message : String(error);
            console.error(`❌ Error de animación con Groq: ${mensaje}`);

            if (intento < 3) {
                await new Promise((resolve) => setTimeout(resolve, intento * 1200));
            }
        }
    }

    console.error("❌ Groq no pudo generar una animación válida después de 3 intentos.");
    return null;
}
