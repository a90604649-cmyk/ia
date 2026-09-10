import "dotenv/config";
import express from "express";
import readline from "readline/promises";
import { GoogleGenAI } from "@google/genai";
import { procesarAnimacion } from "./animation.js";
import { preguntarDeepSeek, DEEPSEEK_MODEL } from "./deepseek.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 3000);
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.6-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("❌ No se encontró GEMINI_API_KEY en el archivo .env");
    process.exit(1);
}

const ai = new GoogleGenAI({ apiKey: GEMINI_API_KEY });

let pendingActions = [];
let r6Calibration = null;
let contextoScriptSeleccionado = null;
const historial = [];

const CHAT_SYSTEM =
    "Eres un asistente experto en Roblox Studio y Luau.\n\n" +
    "Puedes conversar normalmente con el usuario.\n\n" +
    "Cuando la petición requiera programación de Roblox, DeepSeek V4 Pro será el programador que implementará los cambios.\n";

const ROUTER_SYSTEM =
    "Eres el analista técnico de una IA que programa Roblox Studio y Luau.\n\n" +
    "Tu función es convertir la petición del usuario en un brief técnico preciso para DeepSeek V4 Pro.\n" +
    "No escribas el código final.\n" +
    "Determina qué sistema debe cambiarse, qué objetos intervienen y qué archivos son relevantes.\n" +
    "Usa el contexto real del proyecto cuando esté disponible.\n";

const PROGRAMMER_SYSTEM =
    "Eres el programador principal de Roblox Studio y Luau.\n\n" +
    "Debes crear, modificar, actualizar y eliminar archivos Script, LocalScript y ModuleScript del proyecto real.\n\n" +
    "Puedes crear carpetas y eliminarlas cuando sea necesario.\n\n" +
    "REGLA CRITICA DE IDENTIFICACION:\n" +
    "- Nunca identifiques un objeto solo por su nombre.\n" +
    "- Para archivos existentes, el SOURCE REAL del Project Context y su ClassName tienen prioridad absoluta.\n" +
    "- Una misma palabra puede ser una carpeta, un Script, un LocalScript o un ModuleScript en niveles diferentes.\n" +
    "- La ruta de una acción apunta al CONTENEDOR PADRE y name apunta al OBJETO objetivo.\n" +
    "- Ejemplo: si existe StarterPlayer/StarterPlayerScripts/SprintController como LocalScript, una actualización de ese archivo debe usar path=StarterPlayer/StarterPlayerScripts y name=SprintController.\n" +
    "- Si existe un hijo StarterPlayer/StarterPlayerScripts/SprintController/SprintController como Script, su actualización debe usar path=StarterPlayer/StarterPlayerScripts/SprintController y name=SprintController.\n" +
    "- Nunca cambies Script por LocalScript ni LocalScript por Script.\n\n" +
    "CUANDO MODIFIQUES UN SISTEMA EXISTENTE:\n" +
    "- Conserva toda la funcionalidad que el usuario no pidió cambiar.\n" +
    "- Devuelve el SOURCE COMPLETO del archivo actualizado.\n" +
    "- Usa exactamente el mismo tipo, ruta y nombre del archivo existente.\n" +
    "- Si hacen falta varios archivos, devuelve todos los archivos necesarios.\n\n" +
    "OPERACIONES DISPONIBLES:\n" +
    "create_script\n" +
    "create_local_script\n" +
    "create_module_script\n" +
    "update_script\n" +
    "update_local_script\n" +
    "update_module_script\n" +
    "delete_script\n" +
    "delete_local_script\n" +
    "delete_module_script\n" +
    "create_folder\n" +
    "delete_folder\n\n" +
    "Para create/update, path es el contenedor padre, name es el objeto y code contiene el SOURCE COMPLETO.\n" +
    "Para delete, path es el contenedor padre y name es el objeto; no incluyas code.\n" +
    "Para carpetas, path es el contenedor padre y name es la carpeta.\n\n" +
    "FORMATO OBLIGATORIO:\n" +
    "Devuelve UN SOLO objeto JSON válido. No uses markdown ni texto fuera del JSON.\n\n" +
    "Ejemplo de actualización:\n" +
    "{\n" +
    "  \"reply\": \"Actualicé el sistema.\",\n" +
    "  \"actions\": [\n" +
    "    {\n" +
    "      \"type\": \"update_local_script\",\n" +
    "      \"path\": \"StarterPlayer/StarterPlayerScripts\",\n" +
    "      \"name\": \"SprintController\",\n" +
    "      \"className\": \"LocalScript\",\n" +
    "      \"code\": \"SOURCE COMPLETO\"\n" +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "Ejemplo de eliminación:\n" +
    "{\n" +
    "  \"reply\": \"Eliminé el archivo.\",\n" +
    "  \"actions\": [\n" +
    "    {\n" +
    "      \"type\": \"delete_script\",\n" +
    "      \"path\": \"ServerScriptService\",\n" +
    "      \"name\": \"Prueba\",\n" +
    "      \"className\": \"Script\"\n" +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "REGLAS ROBLOX:\n" +
    "- Usa Script para servidor, LocalScript para cliente y ModuleScript para módulos.\n" +
    "- Respeta RemoteEvent/RemoteFunction y la separación cliente-servidor.\n" +
    "- No inventes APIs ni objetos.\n" +
    "- No pongas claves de API en Luau.\n";

function agregarHistorial(role, text) {
    if (!text) return;

    historial.push({
        role,
        parts: [{ text: String(text) }]
    });

    if (historial.length > 30) {
        historial.splice(0, historial.length - 30);
    }
}

function obtenerTextoMensaje(mensaje) {
    return mensaje?.parts
        ?.map((parte) => parte?.text || "")
        .join(" ") || "";
}

function crearContextoReciente(limite = 8) {
    return historial
        .slice(-limite)
        .map((mensaje) => {
            const rol = mensaje.role === "user" ? "Usuario" : "Asistente";
            return `${rol}: ${obtenerTextoMensaje(mensaje)}`;
        })
        .join("\n");
}

function esTareaDeAnimacion(mensaje) {
    const patrones = [
        "animacion", "animación", "animaciones", "animar",
        "keyframe", "keyframes", "pose", "poses", "r6"
    ];

    const texto = String(mensaje || "").toLowerCase();
    return patrones.some((patron) => texto.includes(patron));
}

function esTareaDeCodigo(mensaje) {
    const patrones = [
        "codigo", "código", "script", "scripts", "luau", "lua",
        "roblox", "studio", "crea", "crear", "nuevo", "nueva",
        "haz", "hacer", "programa", "programar", "sistema",
        "funcion", "función", "corrige", "corregir", "modifica",
        "modificar", "actualiza", "actualizar", "elimina", "eliminar",
        "borra", "borrar", "delete", "update", "bug", "error",
        "localscript", "local script", "modulescript", "module script",
        "remoteevent", "remotefunction", "gui", "tool", "remote"
    ];

    const texto = String(mensaje || "").toLowerCase();
    return patrones.some((patron) => texto.includes(patron));
}

async function hablarConGemini(mensajeUsuario) {
    agregarHistorial("user", mensajeUsuario);

    for (let intento = 1; intento <= 2; intento++) {
        try {
            console.log(`\n⏳ Gemini respondiendo... intento ${intento}/2`);

            const response = await ai.models.generateContent({
                model: CHAT_MODEL,
                contents: historial,
                config: {
                    systemInstruction: CHAT_SYSTEM,
                    thinkingConfig: { thinkingLevel: "low" },
                    maxOutputTokens: 4096
                }
            });

            const texto = response.text?.trim();

            if (!texto) {
                throw new Error("Gemini no devolvió texto.");
            }

            agregarHistorial("model", texto);
            console.log(`\n${texto}`);
            return texto;
        } catch (error) {
            const mensaje = error instanceof Error ? error.message : String(error);
            console.error("\n❌ Error de Gemini:", mensaje);

            const temporal = /429|500|502|503|504|UNAVAILABLE|RESOURCE_EXHAUSTED/.test(mensaje);
            if (!temporal || intento === 2) {
                return null;
            }

            await new Promise((resolve) => setTimeout(resolve, intento * 2000));
        }
    }

    return null;
}

async function prepararTareaConGemini(mensajeUsuario) {
    const contexto = crearContextoReciente(10);

    const entrada =
        "CONTEXTO DE CONVERSACIÓN:\n" +
        contexto +
        "\n\nPETICIÓN EXACTA DEL USUARIO:\n" +
        mensajeUsuario;

    try {
        const response = await ai.models.generateContent({
            model: CHAT_MODEL,
            contents: [
                {
                    role: "user",
                    parts: [{ text: entrada }]
                }
            ],
            config: {
                systemInstruction: ROUTER_SYSTEM,
                thinkingConfig: { thinkingLevel: "medium" },
                maxOutputTokens: 4096
            }
        });

        const brief = response.text?.trim();
        if (!brief) {
            throw new Error("Gemini no generó el brief técnico.");
        }

        console.log("\n🧠 Gemini preparó la tarea.");
        return brief;
    } catch (error) {
        const mensaje = error instanceof Error ? error.message : String(error);
        console.warn("⚠️ Gemini no pudo preparar el brief:", mensaje);
        console.warn("↪️ DeepSeek recibirá directamente la petición del usuario.");
        return mensajeUsuario;
    }
}

function limpiarJson(texto) {
    return String(texto || "")
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}

function parsearJson(texto) {
    const limpio = limpiarJson(texto);

    try {
        return JSON.parse(limpio);
    } catch {
        const inicio = limpio.indexOf("{");
        const fin = limpio.lastIndexOf("}");

        if (inicio === -1 || fin <= inicio) {
            return null;
        }

        try {
            return JSON.parse(limpio.slice(inicio, fin + 1));
        } catch {
            return null;
        }
    }
}

const TIPOS_CRUD = new Set([
    "create_script",
    "create_local_script",
    "create_module_script",
    "update_script",
    "update_local_script",
    "update_module_script",
    "delete_script",
    "delete_local_script",
    "delete_module_script",
    "create_folder",
    "delete_folder"
]);

const CLASE_POR_TIPO = {
    create_script: "Script",
    create_local_script: "LocalScript",
    create_module_script: "ModuleScript",
    update_script: "Script",
    update_local_script: "LocalScript",
    update_module_script: "ModuleScript",
    delete_script: "Script",
    delete_local_script: "LocalScript",
    delete_module_script: "ModuleScript"
};

function normalizarTipoGenerico(action) {
    const operation = String(action.operation || "").trim().toLowerCase();
    const className = String(action.className || "").trim();

    if (!operation || !["create", "update", "delete"].includes(operation)) {
        return action.type;
    }

    if (className === "Script") return `${operation}_script`;
    if (className === "LocalScript") return `${operation}_local_script`;
    if (className === "ModuleScript") return `${operation}_module_script`;

    return action.type;
}

function normalizarAccion(action) {
    if (!action || typeof action !== "object") {
        return null;
    }

    const type = normalizarTipoGenerico(action);

    if (!TIPOS_CRUD.has(type)) {
        return null;
    }

    const name = String(action.name || "").trim();
    const path = String(action.path || "").trim();

    const rutasPermitidas = [
        "ServerScriptService",
        "ServerStorage",
        "ReplicatedStorage",
        "StarterGui",
        "StarterPlayer",
        "StarterPlayer/StarterPlayerScripts",
        "StarterPlayer/StarterCharacterScripts",
        "StarterPack",
        "Workspace",
        "SoundService",
        "Lighting",
        "ReplicatedFirst",
        "Teams",
        "TextChatService",
        "Chat"
    ];

    const rutaValida = rutasPermitidas.some((base) =>
        path === base || path.startsWith(`${base}/`)
    );

    if (!name || !rutaValida || path.includes("..")) {
        return null;
    }

    if (name.includes("/") || name.includes("\\")) {
        return null;
    }

    if (type === "create_folder" || type === "delete_folder") {
        return {
            type,
            name,
            path
        };
    }

    const className = CLASE_POR_TIPO[type];
    const suppliedClass = String(action.className || "").trim();

    if (suppliedClass && suppliedClass !== className) {
        return null;
    }

    const result = {
        type,
        className,
        name,
        path
    };

    if (!type.startsWith("delete_")) {
        const code = String(action.code || "");

        if (!code.trim()) {
            return null;
        }

        result.code = code;
    }

    return result;
}

function extraerResultado(texto) {
    const objeto = parsearJson(texto);

    if (!objeto || !Array.isArray(objeto.actions)) {
        return null;
    }

    const actions = [];

    for (const action of objeto.actions) {
        const normalizada = normalizarAccion(action);

        if (normalizada) {
            actions.push(normalizada);
        } else {
            console.warn(
                "⚠️ Acción rechazada durante validación:",
                action?.type || action?.operation || "desconocida",
                action?.path || "",
                action?.name || ""
            );
        }
    }

    const unicas = new Map();

    for (const action of actions) {
        const key = `${action.type}|${action.path}/${action.name}`;
        unicas.set(key, action);
    }

    return {
        reply: String(objeto.reply || "Sistema procesado por DeepSeek.").trim(),
        actions: Array.from(unicas.values())
    };
}

async function programarConDeepSeek(mensajeUsuario) {
    const brief = await prepararTareaConGemini(mensajeUsuario);
    const contexto = crearContextoReciente(8);

    let contextoScript = "";

    if (contextoScriptSeleccionado) {
        contextoScript =
            "\n\nSCRIPT SELECCIONADO EN ROBLOX STUDIO:\n" +
            `TIPO: ${contextoScriptSeleccionado.className}\n` +
            `RUTA: ${contextoScriptSeleccionado.path}\n` +
            `NOMBRE: ${contextoScriptSeleccionado.name}\n` +
            "SOURCE REAL:\n" +
            "----- INICIO SOURCE -----\n" +
            contextoScriptSeleccionado.source +
            "\n----- FIN SOURCE -----\n";
    }

    let instruccion =
        "PETICIÓN ORIGINAL DEL USUARIO:\n" +
        mensajeUsuario +
        "\n\n" +
        "BRIEF PREPARADO POR GEMINI:\n" +
        brief +
        "\n\n" +
        "CONTEXTO RECIENTE:\n" +
        contexto +
        contextoScript +
        "\n\n" +
        "IMPLEMENTA AHORA LA SOLUCIÓN.\n" +
        "Antes de decidir qué archivo tocar, identifica en el SOURCE REAL cuál objeto contiene la lógica solicitada.\n" +
        "Si existen objetos con el mismo nombre en niveles distintos, usa ruta + nombre + ClassName para distinguirlos.\n" +
        "No conviertas un Script en LocalScript ni viceversa.\n" +
        "Devuelve únicamente el JSON indicado por el sistema.\n";

    for (let intento = 1; intento <= 2; intento++) {
        try {
            console.log(`\n🤖 DeepSeek programando... intento ${intento}/2`);

            const texto = await preguntarDeepSeek([
                {
                    role: "system",
                    content: PROGRAMMER_SYSTEM
                },
                {
                    role: "user",
                    content: instruccion
                }
            ], {
                reasoningEffort: "none",
                maxTokens: 8000,
                temperature: 0.2,
                maxReintentos: 2
            });

            const resultado = extraerResultado(texto);

            if (!resultado) {
                console.warn("⚠️ DeepSeek no devolvió un resultado interpretable.");

                instruccion =
                    "La respuesta anterior no pudo ser interpretada.\n" +
                    "Devuelve ÚNICAMENTE un objeto JSON válido con reply y actions.\n" +
                    "Cada acción debe usar exactamente uno de estos tipos: " +
                    Array.from(TIPOS_CRUD).join(", ") + ".\n" +
                    "En update/create usa el ClassName real del contexto y el SOURCE COMPLETO.\n" +
                    "En delete no incluyas code.\n\n" +
                    "PETICIÓN ORIGINAL:\n" +
                    mensajeUsuario +
                    "\n\nBRIEF:\n" +
                    brief +
                    contextoScript;

                continue;
            }

            pendingActions = resultado.actions;

            agregarHistorial(
                "user",
                mensajeUsuario
            );

            agregarHistorial(
                "model",
                resultado.reply || "Sistema programado con DeepSeek."
            );

            console.log("\n✅ DeepSeek terminó.");
            console.log(
                `📦 ${pendingActions.length} cambios preparados para Roblox Studio.`
            );

            return resultado;
        } catch (error) {
            const mensaje = error instanceof Error ? error.message : String(error);

            console.error("\n❌ Error de DeepSeek:");
            console.error(mensaje);

            if (mensaje.includes("OpenRouter 402")) {
                console.error("💳 Crédito insuficiente para esta petición.");
                return null;
            }

            if (intento === 2) {
                return null;
            }

            await new Promise((resolve) => setTimeout(resolve, intento * 2000));
        }
    }

    return null;
}

async function preguntar(mensajeUsuario) {
    const texto = String(mensajeUsuario || "").trim();
    if (!texto) return;

    if (esTareaDeAnimacion(texto)) {
        try {
            console.log("\n🎞️ Enviando tarea a animation.js...");

            const resultado = await procesarAnimacion(
                texto,
                ai,
                historial,
                r6Calibration
            );

            if (!resultado) {
                console.error("❌ animation.js no devolvió ningún resultado.");
                return;
            }

            if (resultado.reply) {
                console.log(`\n${resultado.reply}`);
            }

            if (Array.isArray(resultado.actions) && resultado.actions.length > 0) {
                pendingActions = resultado.actions;
                console.log(
                    `\n[ACCIONES DE ANIMACIÓN PARA ROBLOX]\nAcciones preparadas: ${pendingActions.length}`
                );
            }

            agregarHistorial("user", texto);
            agregarHistorial("model", resultado.reply || "Animación generada correctamente.");
        } catch (error) {
            const mensaje = error instanceof Error ? error.message : String(error);
            console.error("❌ Error en animation.js:", mensaje);
        }

        return;
    }

    if (esTareaDeCodigo(texto)) {
        await programarConDeepSeek(texto);
        return;
    }

    await hablarConGemini(texto);
}

app.get("/", function(_req, res) {
    res.json({
        ok: true,
        service: "Roblox AI Bridge",
        chatModel: CHAT_MODEL,
        programmerModel: DEEPSEEK_MODEL,
        animationSystem: "Gemini animation pipeline",
        pendingActions: pendingActions.length
    });
});

app.get("/health", function(_req, res) {
    const apiKeys = String(process.env.OPENROUTER_API_KEYS || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);

    res.json({
        ok: true,
        geminiConfigured: Boolean(GEMINI_API_KEY),
        openrouterConfigured: apiKeys.length > 0,
        openrouterKeys: apiKeys.length,
        chatModel: CHAT_MODEL,
        programmerModel: DEEPSEEK_MODEL,
        r6Calibrated: Boolean(r6Calibration),
        pendingActions: pendingActions.length
    });
});

app.post("/r6-calibration", function(req, res) {
    try {
        const body = req.body;

        if (!body || typeof body !== "object") {
            return res.status(400).json({ ok: false, error: "Calibración inválida." });
        }

        if (body.rig !== "R6") {
            return res.status(400).json({ ok: false, error: "La calibración no corresponde a R6." });
        }

        if (!body.rigName || !body.joints || typeof body.joints !== "object") {
            return res.status(400).json({ ok: false, error: "Datos de calibración incompletos." });
        }

        r6Calibration = body;

        console.log("\n🧭 CALIBRACIÓN R6 RECIBIDA");
        console.log("🎯 Rig:", r6Calibration.rigName);
        console.log("🦴 Joints:", Object.keys(r6Calibration.joints).length);
        console.log("➡️ Frente:", JSON.stringify(r6Calibration.forwardWorld));
        console.log("↔️ Derecha:", JSON.stringify(r6Calibration.rightWorld));
        console.log("⬆️ Arriba:", JSON.stringify(r6Calibration.upWorld));

        return res.json({
            ok: true,
            message: "Calibración R6 recibida correctamente."
        });
    } catch (error) {
        console.error("❌ Error procesando calibración R6:", error);
        return res.status(500).json({
            ok: false,
            error: "Error interno procesando la calibración."
        });
    }
});

app.get("/r6-calibration", function(_req, res) {
    if (!r6Calibration) {
        return res.json({ calibrated: false, calibration: null });
    }

    return res.json({
        calibrated: true,
        calibration: r6Calibration
    });
});

app.post("/selected-script", function(req, res) {
    try {
        const body = req.body;

        if (!body || body.selected !== true) {
            contextoScriptSeleccionado = null;
            return res.json({
                ok: true,
                message: "Contexto de script limpiado."
            });
        }

        const tiposPermitidos = new Set([
            "Script",
            "LocalScript",
            "ModuleScript"
        ]);

        if (
            !tiposPermitidos.has(body.className) ||
            typeof body.name !== "string" ||
            typeof body.path !== "string" ||
            typeof body.source !== "string"
        ) {
            return res.status(400).json({
                ok: false,
                error: "Datos del script seleccionado inválidos."
            });
        }

        contextoScriptSeleccionado = {
            className: body.className,
            name: body.name.trim(),
            path: body.path.trim(),
            source: body.source
        };

        console.log(
            "📄 Script seleccionado:",
            `${contextoScriptSeleccionado.path}/${contextoScriptSeleccionado.name}`
        );

        console.log(
            "📦 Source recibido:",
            `${contextoScriptSeleccionado.source.length} caracteres`
        );

        return res.json({
            ok: true,
            message: "Script seleccionado recibido correctamente."
        });
    } catch (error) {
        console.error("❌ Error recibiendo script seleccionado:", error);
        return res.status(500).json({
            ok: false,
            error: "Error interno recibiendo el script."
        });
    }
});

app.get("/next", function(_req, res) {
    const actions = pendingActions;
    pendingActions = [];
    return res.json({ actions });
});

app.listen(PORT, function() {
    console.log("=================================");
    console.log("🤖 GEMINI + DEEPSEEK ROBLOX BRIDGE");
    console.log("=================================");
    console.log(`Servidor: http://127.0.0.1:${PORT}`);
    console.log(`Chat: ${CHAT_MODEL}`);
    console.log(`Programador: ${DEEPSEEK_MODEL}`);
    console.log("Animaciones: pipeline Gemini existente");
    console.log("CRUD de scripts: crear / actualizar / eliminar");
    console.log("Calibración: R6 automática");
    console.log("=================================\n");
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("Escribe algo para hablar con el asistente.");
console.log("Las tareas de programación pasan por Gemini → OpenRouter → DeepSeek.");
console.log("DeepSeek puede crear, actualizar y eliminar Script, LocalScript y ModuleScript.");
console.log("Escribe 'salir' para cerrar.\n");

while (true) {
    const mensaje = await rl.question("Tú: ");

    if (!mensaje.trim()) {
        continue;
    }

    if (mensaje.toLowerCase().trim() === "salir") {
        console.log("Cerrando...");
        break;
    }

    await preguntar(mensaje);
}

rl.close();
process.exit(0);
