import "dotenv/config";
import express from "express";
import readline from "readline/promises";
import { procesarAnimacion } from "./animation.js";
import { GROQ_MODEL_ID, preguntarGroq, parsearRespuestaJson } from "./groq.js";

const app = express();
app.use(express.json({ limit: "4mb" }));

const PORT = Number(process.env.PORT || 3000);
const PROJECT_CONTEXT_PORT = Number(process.env.PROJECT_CONTEXT_PORT || 3001);

let pendingActions = [];
let r6Calibration = null;
let contextoScriptSeleccionado = null;
const historial = [];

const CHAT_SYSTEM = [
    "Eres un asistente experto en Roblox Studio y Luau.",
    "Puedes conversar normalmente con el usuario.",
    "Cuando la conversación se convierta en una tarea de programación, el mismo modelo debe analizar el problema y preparar cambios reales para Roblox Studio.",
    "Sé claro y directo. No inventes funciones, objetos ni resultados de ejecución."
].join("\n\n");

const PROGRAMMER_SYSTEM = [
    "Eres el programador principal de Roblox Studio y Luau.",
    "Trabajas sobre el proyecto REAL cuyo contexto se adjunta en la petición.",
    "Tu trabajo es analizar primero la arquitectura, razonar sobre la causa y después producir los cambios necesarios.",
    "Puedes crear, modificar y eliminar Script, LocalScript, ModuleScript y carpetas.",
    "Tu respuesta final debe ser UN SOLO objeto JSON válido. No uses markdown ni texto fuera del JSON.",
    "",
    "IDENTIFICACIÓN DE ARCHIVOS:",
    "- Nunca identifiques un objeto solo por su nombre.",
    "- Usa siempre path + name + ClassName.",
    "- Para archivos existentes, el SOURCE REAL y el ClassName del Project Context tienen prioridad absoluta.",
    "- Si path + name ya existe en el manifest, la acción obligatoriamente debe ser update_* si el ClassName coincide.",
    "- Nunca uses create_* para reemplazar un archivo existente.",
    "- Si path + name no existe, entonces puedes usar create_*.",
    "- Nunca conviertas un Script en LocalScript, ni un LocalScript en Script, salvo que el usuario lo pida explícitamente y sea técnicamente necesario.",
    "",
    "CAMBIOS:",
    "- Conserva toda funcionalidad existente que el usuario no pidió cambiar.",
    "- Antes de modificar un archivo existente, comprende el SOURCE COMPLETO que se te entregó.",
    "- Para create/update, code debe contener el SOURCE COMPLETO final del archivo.",
    "- Para delete, no incluyas code.",
    "- Cambia solamente los archivos necesarios.",
    "- Cuando un cambio afecte a varios scripts, devuelve todos los archivos necesarios.",
    "- No describas cambios que no estén incluidos en actions.",
    "",
    "OPERACIONES PERMITIDAS:",
    "create_script, create_local_script, create_module_script,",
    "update_script, update_local_script, update_module_script,",
    "delete_script, delete_local_script, delete_module_script,",
    "create_folder, delete_folder.",
    "",
    "FORMATO DE ACTIONS:",
    "- path es el contenedor padre.",
    "- name es el objeto objetivo.",
    "- className debe ser Script, LocalScript o ModuleScript para acciones de scripts.",
    "- code solo se usa en create/update de scripts.",
    "",
    "ROBLOX:",
    "- Script = servidor; LocalScript = cliente; ModuleScript = módulo.",
    "- Respeta la separación cliente-servidor.",
    "- Respeta RemoteEvent, RemoteFunction y las dependencias existentes.",
    "- No pongas claves de API en Luau.",
    "",
    "RESULTADO:",
    "- reply debe explicar brevemente qué se diagnosticó y qué cambios se hicieron.",
    "- actions debe contener únicamente cambios que el plugin pueda aplicar.",
    "- Si no hace falta cambiar archivos, devuelve actions como []."
].join("\n");

function agregarHistorial(role, text) {
    if (!text) return;
    historial.push({ role, text: String(text) });
    if (historial.length > 30) {
        historial.splice(0, historial.length - 30);
    }
}

function crearContextoReciente(limite = 8) {
    return historial
        .slice(-limite)
        .map((mensaje) => {
            const rol = mensaje.role === "user" ? "Usuario" : "Asistente";
            return `${rol}: ${mensaje.text}`;
        })
        .join("\n");
}

function esTareaDeAnimacion(mensaje) {
    const texto = String(mensaje || "").toLowerCase();
    return [
        "animacion", "animación", "animaciones", "animar", "keyframe",
        "keyframes", "pose", "poses", "movimiento r6", "animación r6"
    ].some((patron) => texto.includes(patron));
}

function esTareaDeCodigo(mensaje) {
    const texto = String(mensaje || "").toLowerCase();
    const cambios = [
        "corrige", "corregir", "arregla", "arreglar", "modifica", "modificar",
        "actualiza", "actualizar", "cambia", "cambiar", "crea", "crear",
        "agrega", "agregar", "añade", "añadir", "implementa", "implementar",
        "elimina", "eliminar", "borra", "borrar", "haz", "hacer", "programa",
        "programar", "resolver", "resuelve", "soluciona", "solucionar"
    ];
    const contexto = [
        "roblox", "studio", "script", "localscript", "modulescript", "luau", "lua",
        "sistema", "remoteevent", "remotefunction", "gui", "tool", "sprint",
        "stamina", "vuelo", "volar", "input", "tecla", "evento", "r6"
    ];

    if (cambios.some((patron) => texto.includes(patron)) && contexto.some((patron) => texto.includes(patron))) {
        return true;
    }

    return contexto.some((patron) => texto.includes(patron)) &&
        ["error", "bug", "no funciona", "no sirve", "falla", "fallando"].some((patron) => texto.includes(patron));
}

async function obtenerContextoProyecto(mensajeUsuario) {
    const query = String(mensajeUsuario || "").trim();
    if (!query) return null;

    const url = `http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-context?query=${encodeURIComponent(query)}`;

    try {
        const response = await fetch(url, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(20000)
        });

        if (!response.ok) {
            console.warn(`⚠️ Project Context respondió HTTP ${response.status}.`);
            return null;
        }

        const data = await response.json();
        if (!data?.ok) return null;
        return data;
    } catch (error) {
        console.warn(
            "⚠️ Project Context no disponible:",
            error instanceof Error ? error.message : String(error)
        );
        return null;
    }
}

function construirContextoProyecto(proyecto) {
    if (!proyecto || !Array.isArray(proyecto.selected)) return "";

    const manifest = Array.isArray(proyecto.manifest) ? proyecto.manifest : [];
    const selected = proyecto.selected;

    if (manifest.length === 0 && selected.length === 0) return "";

    const manifestTexto = manifest
        .map((script) => `- ${script.className}: ${script.path}/${script.name} (${script.size} chars)`)
        .join("\n");

    const fuentes = selected
        .map((script, index) => [
            `### ARCHIVO RELEVANTE ${index + 1}`,
            `TIPO: ${script.className}`,
            `RUTA: ${script.path}`,
            `NOMBRE: ${script.name}`,
            `PUNTUACIÓN: ${script.score ?? 0}`,
            `SEÑALES: ${Array.isArray(script.signals) ? script.signals.join(", ") : ""}`,
            "SOURCE COMPLETO:",
            "----- INICIO SOURCE -----",
            script.source || "",
            "----- FIN SOURCE -----"
        ].join("\n"))
        .join("\n\n");

    return [
        "CONTEXTO REAL DEL PROYECTO ROBLOX:",
        `Total de scripts detectados: ${proyecto.totalScripts ?? manifest.length}`,
        "",
        "MANIFEST REAL:",
        manifestTexto || "(sin scripts)",
        "",
        "ARCHIVOS RELEVANTES CON SOURCE REAL:",
        fuentes || "(no se identificaron archivos relevantes)",
        "",
        "REGLAS DEL CONTEXTO:",
        "- Este SOURCE proviene del proyecto real abierto en Roblox Studio.",
        "- No inventes el contenido de archivos que no estén presentes.",
        "- Analiza primero las relaciones entre los archivos relevantes.",
        "- Usa ruta + nombre + ClassName para decidir cada action.",
        "- Modifica únicamente lo necesario.",
        "- Devuelve SOURCE COMPLETO para cada archivo creado o actualizado."
    ].join("\n");
}

function construirContextoScriptSeleccionado() {
    if (!contextoScriptSeleccionado) return "";

    return [
        "SCRIPT SELECCIONADO EN ROBLOX STUDIO:",
        `TIPO: ${contextoScriptSeleccionado.className}`,
        `RUTA: ${contextoScriptSeleccionado.path}`,
        `NOMBRE: ${contextoScriptSeleccionado.name}`,
        "SOURCE REAL:",
        "----- INICIO SOURCE -----",
        contextoScriptSeleccionado.source,
        "----- FIN SOURCE -----"
    ].join("\n");
}

function normalizarAccion(action) {
    if (!action || typeof action !== "object") return null;

    let type = String(action.type || "").trim().toLowerCase();
    const operation = String(action.operation || "").trim().toLowerCase();
    const className = String(action.className || "").trim();

    if (!type && ["create", "update", "delete"].includes(operation)) {
        if (className === "Script") type = `${operation}_script`;
        if (className === "LocalScript") type = `${operation}_local_script`;
        if (className === "ModuleScript") type = `${operation}_module_script`;
    }

    const permitidos = new Set([
        "create_script", "create_local_script", "create_module_script",
        "update_script", "update_local_script", "update_module_script",
        "delete_script", "delete_local_script", "delete_module_script",
        "create_folder", "delete_folder"
    ]);

    if (!permitidos.has(type)) return null;

    const path = String(action.path || "").trim();
    const name = String(action.name || "").trim();
    const bases = [
        "ServerScriptService", "ServerStorage", "ReplicatedStorage", "StarterGui",
        "StarterPlayer", "StarterPack", "Workspace", "SoundService", "Lighting",
        "ReplicatedFirst", "Teams", "TextChatService", "Chat"
    ];

    if (!name || !path || path.includes("..") || name.includes("/") || name.includes("\\")) return null;
    if (!bases.some((base) => path === base || path.startsWith(`${base}/`))) return null;

    if (type === "create_folder" || type === "delete_folder") {
        return { type, name, path };
    }

    const classByType = {
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

    const requiredClass = classByType[type];
    if (className && className !== requiredClass) return null;

    const result = {
        type,
        className: requiredClass,
        name,
        path
    };

    if (!type.startsWith("delete_")) {
        const code = String(action.code || "");
        if (!code.trim()) return null;
        result.code = code;
    }

    return result;
}

function extraerResultado(texto) {
    const objeto = parsearRespuestaJson(texto);
    if (!objeto || typeof objeto !== "object" || !Array.isArray(objeto.actions)) return null;

    const acciones = [];
    for (const action of objeto.actions) {
        const normalizada = normalizarAccion(action);
        if (normalizada) {
            acciones.push(normalizada);
        } else {
            console.warn("⚠️ Acción rechazada por validación:", action?.type || action?.operation || "desconocida");
        }
    }

    const unicas = new Map();
    for (const action of acciones) {
        unicas.set(`${action.type}|${action.path}/${action.name}`, action);
    }

    return {
        reply: String(objeto.reply || "Cambios analizados y preparados.").trim(),
        actions: [...unicas.values()]
    };
}

async function ajustarAccionesCRUDPorProyecto(resultado) {
    if (!resultado?.actions?.length) return resultado;

    try {
        const response = await fetch(`http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-summary`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) return resultado;

        const proyecto = await response.json();
        const manifest = Array.isArray(proyecto.manifest) ? proyecto.manifest : [];
        const existentes = new Map();

        for (const script of manifest) {
            if (script?.path && script?.name && script?.className) {
                existentes.set(`${script.path}/${script.name}`, script);
            }
        }

        const updatePorClase = {
            Script: "update_script",
            LocalScript: "update_local_script",
            ModuleScript: "update_module_script"
        };
        const createPorClase = {
            Script: "create_script",
            LocalScript: "create_local_script",
            ModuleScript: "create_module_script"
        };

        let corregidas = 0;

        const actions = resultado.actions.map((action) => {
            if (action.type.endsWith("_folder")) return action;

            const key = `${action.path}/${action.name}`;
            const existente = existentes.get(key);

            if (!existente) {
                const updateTypes = new Set(["update_script", "update_local_script", "update_module_script"]);
                if (updateTypes.has(action.type) && createPorClase[action.className]) {
                    corregidas += 1;
                    console.log(`🔧 CRUD: ${key} no existe; update → ${createPorClase[action.className]}.`);
                    return { ...action, type: createPorClase[action.className] };
                }
                return action;
            }

            const tipoUpdate = updatePorClase[existente.className];
            if (!tipoUpdate) return action;

            const esCreate = action.type.startsWith("create_");
            const esUpdate = action.type.startsWith("update_");

            if (esCreate && action.className === existente.className) {
                corregidas += 1;
                console.log(`🔧 CRUD: ${key} ya existe; create → ${tipoUpdate}.`);
                return { ...action, type: tipoUpdate, className: existente.className };
            }

            if (esUpdate && action.className !== existente.className) {
                corregidas += 1;
                console.log(`🔧 CRUD: ${key} usa ClassName ${existente.className}; corrigiendo tipo.`);
                return { ...action, type: tipoUpdate, className: existente.className };
            }

            return action;
        });

        if (corregidas) {
            console.log(`✅ CRUD: ${corregidas} acción(es) ajustada(s) contra el manifest real.`);
        }

        return { ...resultado, actions };
    } catch (error) {
        console.warn(
            "⚠️ No se pudo validar CRUD contra Project Context:",
            error instanceof Error ? error.message : String(error)
        );
        return resultado;
    }
}

async function hablarConGroq(mensajeUsuario) {
    agregarHistorial("user", mensajeUsuario);

    const messages = [
        { role: "system", content: CHAT_SYSTEM },
        ...historial.slice(-12).map((mensaje) => ({
            role: mensaje.role === "user" ? "user" : "assistant",
            content: mensaje.text
        }))
    ];

    try {
        const texto = await preguntarGroq(messages, {
            reasoningEffort: "none",
            reasoningFormat: "hidden",
            temperature: 0.7,
            maxCompletionTokens: 4096
        });

        agregarHistorial("model", texto);
        console.log(`\n${texto}`);
        return texto;
    } catch (error) {
        console.error(
            "❌ Error de Groq:",
            error instanceof Error ? error.message : String(error)
        );
        return null;
    }
}

async function programarConGroq(mensajeUsuario) {
    const proyecto = await obtenerContextoProyecto(mensajeUsuario);
    const contextoProyecto = construirContextoProyecto(proyecto);
    const contextoReciente = crearContextoReciente(8);
    const contextoSeleccionado = construirContextoScriptSeleccionado();

    const instruccion = [
        "PETICIÓN ORIGINAL DEL USUARIO:",
        mensajeUsuario,
        "",
        "CONTEXTO RECIENTE:",
        contextoReciente || "(sin conversación previa)",
        contextoSeleccionado,
        contextoProyecto,
        "",
        "PROCESO OBLIGATORIO:",
        "1. Comprende la petición exacta.",
        "2. Identifica el sistema y los archivos implicados usando el contexto real.",
        "3. Razona sobre la causa o arquitectura antes de escribir los cambios.",
        "4. Conserva la funcionalidad no solicitada.",
        "5. Genera los SOURCE completos de todos los archivos que realmente cambien.",
        "6. Devuelve únicamente el JSON con reply y actions."
    ].filter(Boolean).join("\n");

    try {
        console.log(`\n🤖 Groq programando con ${GROQ_MODEL_ID}...`);

        const texto = await preguntarGroq(
            [
                { role: "system", content: PROGRAMMER_SYSTEM },
                { role: "user", content: instruccion }
            ],
            {
                json: true,
                reasoningEffort: "default",
                reasoningFormat: "hidden",
                temperature: 0.6,
                maxCompletionTokens: 16384,
                attemptsPerKey: 3
            }
        );

        let resultado = extraerResultado(texto);

        if (!resultado) {
            console.warn("⚠️ Groq devolvió JSON, pero no con la estructura actions esperada.");
            return null;
        }

        resultado = await ajustarAccionesCRUDPorProyecto(resultado);
        pendingActions = resultado.actions;

        agregarHistorial("user", mensajeUsuario);
        agregarHistorial("model", resultado.reply);

        console.log("✅ Groq terminó el análisis de programación.");
        console.log(`📦 ${pendingActions.length} cambio(s) preparado(s) para Roblox Studio.`);
        console.log(`🧠 Modelo: ${GROQ_MODEL_ID} | Reasoning: default`);

        return resultado;
    } catch (error) {
        console.error(
            "❌ Error de programación con Groq:",
            error instanceof Error ? error.message : String(error)
        );
        return null;
    }
}

async function preguntar(mensajeUsuario) {
    const texto = String(mensajeUsuario || "").trim();
    if (!texto) return null;

    if (esTareaDeAnimacion(texto)) {
        try {
            console.log("\n🎞️ Enviando tarea de animación a Groq...");
            const resultado = await procesarAnimacion(texto, historial, r6Calibration);

            if (!resultado) {
                console.error("❌ Groq no generó una animación válida.");
                return null;
            }

            if (resultado.reply) console.log(`\n${resultado.reply}`);
            pendingActions = Array.isArray(resultado.actions) ? resultado.actions : [];
            console.log(`🎬 ${pendingActions.length} acción(es) de animación preparadas.`);

            agregarHistorial("user", texto);
            agregarHistorial("model", resultado.reply || "Animación generada correctamente.");
            return resultado;
        } catch (error) {
            console.error(
                "❌ Error en animation.js:",
                error instanceof Error ? error.message : String(error)
            );
            return null;
        }
    }

    if (esTareaDeCodigo(texto)) {
        console.log("🛠️ Router: tarea detectada como programación → Groq.");
        return await programarConGroq(texto);
    }

    return await hablarConGroq(texto);
}

app.get("/", function (_req, res) {
    res.json({
        ok: true,
        service: "Roblox AI Bridge",
        aiProvider: "Groq",
        model: GROQ_MODEL_ID,
        reasoning: "enabled for coding and animations",
        animationSystem: "Groq R6 animation pipeline",
        pendingActions: pendingActions.length
    });
});

app.get("/health", function (_req, res) {
    const keys = String(process.env.GROQ_API_KEYS || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
    if (process.env.GROQ_API_KEY && !keys.includes(process.env.GROQ_API_KEY.trim())) {
        keys.unshift(process.env.GROQ_API_KEY.trim());
    }

    res.json({
        ok: true,
        groqConfigured: keys.length > 0,
        groqKeys: keys.length,
        model: GROQ_MODEL_ID,
        reasoningEffort: process.env.GROQ_REASONING_EFFORT || "default",
        pendingActions: pendingActions.length,
        r6Calibrated: Boolean(r6Calibration)
    });
});

app.post("/r6-calibration", function (req, res) {
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
        return res.json({ ok: true, message: "Calibración R6 recibida correctamente." });
    } catch (error) {
        console.error("❌ Error procesando calibración R6:", error);
        return res.status(500).json({ ok: false, error: "Error interno procesando la calibración." });
    }
});

app.get("/r6-calibration", function (_req, res) {
    if (!r6Calibration) return res.json({ calibrated: false, calibration: null });
    return res.json({ calibrated: true, calibration: r6Calibration });
});

app.post("/selected-script", function (req, res) {
    try {
        const body = req.body;
        if (!body || body.selected !== true) {
            contextoScriptSeleccionado = null;
            return res.json({ ok: true, message: "Contexto de script limpiado." });
        }

        const tiposPermitidos = new Set(["Script", "LocalScript", "ModuleScript"]);
        if (
            !tiposPermitidos.has(body.className) ||
            typeof body.name !== "string" ||
            typeof body.path !== "string" ||
            typeof body.source !== "string"
        ) {
            return res.status(400).json({ ok: false, error: "Datos del script seleccionado inválidos." });
        }

        contextoScriptSeleccionado = {
            className: body.className,
            name: body.name.trim(),
            path: body.path.trim(),
            source: body.source
        };

        console.log("📄 Script seleccionado:", `${contextoScriptSeleccionado.path}/${contextoScriptSeleccionado.name}`);
        console.log("📦 Source recibido:", `${contextoScriptSeleccionado.source.length} caracteres`);
        return res.json({ ok: true, message: "Script seleccionado recibido correctamente." });
    } catch (error) {
        console.error("❌ Error recibiendo script seleccionado:", error);
        return res.status(500).json({ ok: false, error: "Error interno recibiendo el script." });
    }
});

app.get("/next", function (_req, res) {
    const actions = pendingActions;
    pendingActions = [];
    return res.json({ actions });
});

app.listen(PORT, function () {
    console.log("=================================");
    console.log("🤖 GROQ + QWEN 3.6 ROBLOX BRIDGE");
    console.log("=================================");
    console.log(`Servidor: http://127.0.0.1:${PORT}`);
    console.log(`Modelo: ${GROQ_MODEL_ID}`);
    console.log("Reasoning: activado para programación y animaciones");
    console.log("Programación: análisis + CRUD real de scripts");
    console.log("Animaciones: pipeline R6 con Groq");
    console.log("Contexto: Project Context + script seleccionado");
    console.log("=================================\n");
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });

console.log("Escribe algo para hablar con Groq.");
console.log("Las tareas de programación usan Groq + Qwen 3.6 con reasoning.");
console.log("Groq puede crear, actualizar y eliminar Script, LocalScript y ModuleScript.");
console.log("Escribe 'salir' para cerrar.\n");

while (true) {
    const mensaje = await rl.question("Tú: ");
    if (!mensaje.trim()) continue;
    if (mensaje.toLowerCase().trim() === "salir") {
        console.log("Cerrando...");
        break;
    }
    await preguntar(mensaje);
}

rl.close();
process.exit(0);
