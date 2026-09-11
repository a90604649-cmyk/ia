import "dotenv/config";
import express from "express";
import readline from "readline/promises";
import { GROQ_CONFIG, GROQ_MODEL_ID, preguntarGroq, parsearRespuestaJson } from "./groq.js";

const app = express();
app.use(express.json({ limit: "8mb" }));

const PORT = Number(process.env.PORT || 3000);
const PROJECT_CONTEXT_PORT = Number(process.env.PROJECT_CONTEXT_PORT || 3001);

let pendingActions = [];
let contextoScriptSeleccionado = null;
const historial = [];

const PROGRAMMER_SYSTEM = [
    "Eres un programador profesional de Roblox Studio y Luau.",
    "Trabajas sobre el proyecto REAL cuyo contexto aparece en la petición.",
    "Analiza primero el problema y la arquitectura; después implementa la solución.",
    "Debes conservar la funcionalidad existente que el usuario no pidió cambiar.",
    "",
    "IDENTIFICACIÓN:",
    "- Nunca identifiques un objeto solo por su nombre.",
    "- Usa path + name + ClassName.",
    "- El SOURCE REAL recibido tiene prioridad sobre cualquier suposición.",
    "- Si path + name existe en el manifest y es Script/LocalScript/ModuleScript, usa update_*.",
    "- Nunca uses create_* para reemplazar un archivo existente.",
    "- Usa create_* solamente cuando el archivo no exista.",
    "- No cambies el tipo Script/LocalScript/ModuleScript sin necesidad técnica.",
    "",
    "CAMBIOS:",
    "- Devuelve el SOURCE COMPLETO de cada archivo creado o actualizado.",
    "- Cambia solo los archivos necesarios.",
    "- Si un sistema necesita varios archivos, devuelve todos los archivos afectados.",
    "- Puedes crear RemoteEvent y RemoteFunction cuando sean necesarios.",
    "- Antes de crear un remoto, revisa la lista de objetos existentes.",
    "- Las rutas siempre usan / y path representa el CONTENEDOR PADRE.",
    "",
    "ACCIONES PERMITIDAS:",
    "create_script, create_local_script, create_module_script,",
    "update_script, update_local_script, update_module_script,",
    "delete_script, delete_local_script, delete_module_script,",
    "create_remote_event, create_remote_function,",
    "delete_remote_event, delete_remote_function,",
    "create_folder, delete_folder.",
    "",
    "PARA SCRIPTS:",
    "{ type, className, path, name, code }",
    "className debe ser Script, LocalScript o ModuleScript.",
    "",
    "PARA REMOTOS:",
    "{ type, path, name }",
    "create_remote_event crea RemoteEvent.",
    "create_remote_function crea RemoteFunction.",
    "delete_remote_event elimina un RemoteEvent.",
    "delete_remote_function elimina un RemoteFunction.",
    "",
    "PARA CARPETAS:",
    "{ type, path, name }",
    "",
    "SALIDA:",
    "Devuelve UN SOLO objeto JSON válido sin markdown ni texto fuera del JSON.",
    "Debe tener exactamente: reply y actions.",
    "reply debe explicar brevemente qué encontraste y qué cambiaste.",
    "actions debe contener solo acciones aplicables por el plugin.",
    "Si no hace falta cambiar nada, actions debe ser [].",
    "No inventes resultados de ejecución ni digas que probaste algo que no probaste."
].join("\n");

const CHAT_SYSTEM = [
    "Eres un asistente experto en Roblox Studio y Luau.",
    "Responde de forma clara, directa y útil.",
    "Cuando el usuario pida una modificación real del proyecto, la petición debe pasar por el programador y generar acciones para Roblox Studio.",
    "No inventes resultados de ejecución."
].join("\n");

function agregarHistorial(role, text) {
    if (!text) return;
    historial.push({ role, text: String(text) });
    if (historial.length > 24) {
        historial.splice(0, historial.length - 24);
    }
}

function crearContextoReciente(limite = 8) {
    return historial
        .slice(-limite)
        .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.text}`)
        .join("\n");
}

function esTareaProgramacion(texto) {
    const t = String(texto || "").toLowerCase();
    const contexto = [
        "roblox", "studio", "luau", "lua", "script", "localscript", "modulescript",
        "sistema", "remoteevent", "remotefunction", "sprint", "stamina", "tool",
        "gui", "workspace", "replicatedstorage", "serverstorage", "starterplayer", "r6"
    ];
    const accion = [
        "corrige", "corregir", "arregla", "arreglar", "modifica", "modificar", "actualiza",
        "actualizar", "crea", "crear", "agrega", "agregar", "añade", "añadir", "implementa",
        "implementar", "elimina", "eliminar", "borra", "borrar", "haz", "hacer", "programa",
        "programar", "resuelve", "resolver", "soluciona", "solucionar", "cambia", "cambiar"
    ];
    const bug = ["error", "bug", "no funciona", "no sirve", "falla", "fallando"];

    return (
        contexto.some((x) => t.includes(x)) && accion.some((x) => t.includes(x))
    ) || (
        contexto.some((x) => t.includes(x)) && bug.some((x) => t.includes(x))
    );
}

async function obtenerContextoProyecto(mensaje) {
    const query = String(mensaje || "").trim();
    if (!query) return null;

    try {
        const response = await fetch(
            `http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-context?query=${encodeURIComponent(query)}`,
            { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(20000) }
        );

        if (!response.ok) return null;
        const data = await response.json();
        return data?.ok ? data : null;
    } catch (error) {
        console.warn("⚠️ Project Context no disponible:", error instanceof Error ? error.message : String(error));
        return null;
    }
}

function construirContextoProyecto(proyecto) {
    if (!proyecto) return "";

    const manifest = Array.isArray(proyecto.manifest) ? proyecto.manifest : [];
    const objetos = Array.isArray(proyecto.objects) ? proyecto.objects : [];
    const selected = Array.isArray(proyecto.selected) ? proyecto.selected : [];

    const manifestTexto = manifest
        .map((s) => `- ${s.className}: ${s.path}/${s.name} (${s.size} chars)`)
        .join("\n");

    const objetosTexto = objetos
        .map((o) => `- ${o.className}: ${o.path}/${o.name}`)
        .join("\n");

    const sourceTexto = selected
        .map((s, i) => [
            `### SOURCE RELEVANTE ${i + 1}`,
            `TIPO: ${s.className}`,
            `RUTA: ${s.path}`,
            `NOMBRE: ${s.name}`,
            `SEÑALES: ${Array.isArray(s.signals) ? s.signals.join(", ") : ""}`,
            "----- INICIO SOURCE -----",
            s.source || "",
            "----- FIN SOURCE -----"
        ].join("\n"))
        .join("\n\n");

    return [
        "CONTEXTO REAL DE ROBLOX STUDIO:",
        `Scripts detectados: ${proyecto.totalScripts ?? manifest.length}`,
        "",
        "MANIFEST DE SCRIPTS:",
        manifestTexto || "(ninguno)",
        "",
        "REMOTES EXISTENTES:",
        objetosTexto || "(ninguno)",
        "",
        "SOURCE RELEVANTE:",
        sourceTexto || "(ninguno seleccionado)",
        "",
        "REGLAS:",
        "- El SOURCE es real y debe analizarse antes de modificar.",
        "- Usa path + name + ClassName para cada script.",
        "- No uses create_* para un archivo existente.",
        "- Mantén intacta la funcionalidad no relacionada con la petición.",
        "- No inventes objetos que no aparezcan en el contexto cuando su existencia sea relevante."
    ].join("\n");
}

function construirContextoSeleccionado() {
    if (!contextoScriptSeleccionado) return "";

    return [
        "SCRIPT SELECCIONADO:",
        `TIPO: ${contextoScriptSeleccionado.className}`,
        `RUTA: ${contextoScriptSeleccionado.path}`,
        `NOMBRE: ${contextoScriptSeleccionado.name}`,
        "----- SOURCE -----",
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
        else if (className === "LocalScript") type = `${operation}_local_script`;
        else if (className === "ModuleScript") type = `${operation}_module_script`;
    }

    const allowed = new Set([
        "create_script", "create_local_script", "create_module_script",
        "update_script", "update_local_script", "update_module_script",
        "delete_script", "delete_local_script", "delete_module_script",
        "create_remote_event", "create_remote_function",
        "delete_remote_event", "delete_remote_function",
        "create_folder", "delete_folder"
    ]);

    if (!allowed.has(type)) return null;

    const path = String(action.path || "").trim();
    const name = String(action.name || "").trim();
    const bases = [
        "ServerScriptService", "ServerStorage", "ReplicatedStorage", "StarterGui",
        "StarterPlayer", "StarterPack", "Workspace", "SoundService", "Lighting",
        "ReplicatedFirst", "Teams", "TextChatService", "Chat"
    ];

    if (!path || !name || path.includes("..") || name.includes("/") || name.includes("\\")) {
        return null;
    }

    if (!bases.some((base) => path === base || path.startsWith(`${base}/`))) {
        return null;
    }

    if (type === "create_folder" || type === "delete_folder" || type.startsWith("create_remote_") || type.startsWith("delete_remote_")) {
        return { type, path, name };
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
    if (!requiredClass || (className && className !== requiredClass)) return null;

    const result = { type, className: requiredClass, path, name };

    if (!type.startsWith("delete_")) {
        const code = String(action.code || "");
        if (!code.trim()) return null;
        result.code = code;
    }

    return result;
}

function extraerResultado(texto) {
    const parsed = parsearRespuestaJson(texto);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.actions)) {
        return null;
    }

    const actions = [];
    for (const raw of parsed.actions) {
        const action = normalizarAccion(raw);
        if (action) actions.push(action);
        else console.warn("⚠️ Acción Groq rechazada:", raw?.type || raw?.operation || "desconocida");
    }

    const unique = new Map();
    for (const action of actions) {
        unique.set(`${action.type}|${action.path}/${action.name}`, action);
    }

    return {
        reply: String(parsed.reply || "Cambios analizados y preparados.").trim(),
        actions: [...unique.values()]
    };
}

async function ajustarAccionesPorManifest(resultado) {
    if (!resultado?.actions?.length) return resultado;

    try {
        const response = await fetch(`http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-summary`, {
            headers: { Accept: "application/json" },
            signal: AbortSignal.timeout(10000)
        });
        if (!response.ok) return resultado;

        const data = await response.json();
        const manifest = Array.isArray(data.manifest) ? data.manifest : [];
        const existentes = new Map(manifest.map((s) => [`${s.path}/${s.name}`, s]));

        const updateByClass = {
            Script: "update_script",
            LocalScript: "update_local_script",
            ModuleScript: "update_module_script"
        };
        const createByClass = {
            Script: "create_script",
            LocalScript: "create_local_script",
            ModuleScript: "create_module_script"
        };

        const actions = resultado.actions.map((action) => {
            if (!action.type.includes("script")) return action;

            const existente = existentes.get(`${action.path}/${action.name}`);
            if (!existente) {
                if (action.type.startsWith("update_") && createByClass[action.className]) {
                    return { ...action, type: createByClass[action.className] };
                }
                return action;
            }

            if (action.className === existente.className && action.type.startsWith("create_")) {
                return { ...action, type: updateByClass[existente.className] };
            }

            if (action.type.startsWith("update_") && action.className !== existente.className) {
                return { ...action, type: updateByClass[existente.className], className: existente.className };
            }

            return action;
        });

        return { ...resultado, actions };
    } catch {
        return resultado;
    }
}

async function procesarProgramacion(mensajeUsuario) {
    const proyecto = await obtenerContextoProyecto(mensajeUsuario);
    const contexto = construirContextoProyecto(proyecto);
    const reciente = crearContextoReciente(8);
    const seleccionado = construirContextoSeleccionado();

    const contenido = [
        "PETICIÓN ORIGINAL:",
        mensajeUsuario,
        "",
        "CONTEXTO DE CONVERSACIÓN:",
        reciente || "(sin conversación previa)",
        "",
        contexto,
        seleccionado,
        "",
        "RAZONA Y DESPUÉS IMPLEMENTA LOS CAMBIOS. DEVUELVE SOLO EL JSON REQUERIDO."
    ].filter(Boolean).join("\n");

    for (let intento = 1; intento <= 2; intento++) {
        try {
            console.log(`🤖 Groq programando... intento ${intento}/2`);
            const texto = await preguntarGroq(
                [
                    { role: "system", content: PROGRAMMER_SYSTEM },
                    { role: "user", content: contenido }
                ],
                {
                    json: true,
                    reasoningEffort: process.env.GROQ_REASONING_EFFORT || "default",
                    reasoningFormat: "hidden",
                    temperature: 0.6,
                    maxCompletionTokens: Number(process.env.GROQ_MAX_OUTPUT_TOKENS || 16384),
                    timeoutMs: Number(process.env.GROQ_TIMEOUT_MS || 300000),
                    attemptsPerKey: 2
                }
            );

            let resultado = extraerResultado(texto);
            if (!resultado) {
                console.warn("⚠️ Groq devolvió un JSON que no coincide con el formato esperado.");
                if (intento === 2) return null;
                continue;
            }

            resultado = await ajustarAccionesPorManifest(resultado);
            pendingActions = resultado.actions;

            agregarHistorial("user", mensajeUsuario);
            agregarHistorial("assistant", resultado.reply);

            console.log(`✅ Groq terminó: ${pendingActions.length} acción(es).`);
            console.log(resultado.reply);
            return resultado;
        } catch (error) {
            console.error("❌ Error de Groq:", error instanceof Error ? error.message : String(error));
            if (intento === 2) return null;
            await new Promise((resolve) => setTimeout(resolve, 1200));
        }
    }

    return null;
}

async function responderChat(mensajeUsuario) {
    try {
        const texto = await preguntarGroq(
            [
                { role: "system", content: CHAT_SYSTEM },
                ...historial.slice(-12).map((m) => ({ role: m.role, content: m.text })),
                { role: "user", content: mensajeUsuario }
            ],
            {
                json: false,
                reasoningEffort: process.env.GROQ_REASONING_EFFORT || "default",
                reasoningFormat: "hidden",
                temperature: 0.6,
                maxCompletionTokens: 4096
            }
        );

        agregarHistorial("user", mensajeUsuario);
        agregarHistorial("assistant", texto);
        console.log(`\n${texto}`);
        return texto;
    } catch (error) {
        console.error("❌ Error de Groq:", error instanceof Error ? error.message : String(error));
        return null;
    }
}

app.get("/", (_req, res) => {
    res.json({
        ok: true,
        service: "Roblox AI Bridge",
        provider: "Groq",
        model: GROQ_MODEL_ID,
        capabilities: [
            "reasoning", "create/update/delete scripts", "RemoteEvent", "RemoteFunction", "folders"
        ],
        pendingActions: pendingActions.length
    });
});

app.get("/health", (_req, res) => {
    const keys = String(process.env.GROQ_API_KEYS || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
    const individual = String(process.env.GROQ_API_KEY || "").trim();
    if (individual && !keys.includes(individual)) keys.unshift(individual);

    res.json({
        ok: true,
        groqConfigured: keys.length > 0,
        groqKeys: keys.length,
        provider: "Groq",
        model: GROQ_MODEL_ID,
        reasoningEffort: GROQ_CONFIG.reasoningEffort,
        pendingActions: pendingActions.length
    });
});

app.get("/next", (_req, res) => {
    const actions = pendingActions;
    pendingActions = [];
    res.json({ actions });
});

app.post("/selected-script", (req, res) => {
    const body = req.body;
    if (!body || body.selected !== true) {
        contextoScriptSeleccionado = null;
        return res.json({ ok: true });
    }

    if (!["Script", "LocalScript", "ModuleScript"].includes(body.className)
        || typeof body.name !== "string"
        || typeof body.path !== "string"
        || typeof body.source !== "string") {
        return res.status(400).json({ ok: false, error: "Script seleccionado inválido." });
    }

    contextoScriptSeleccionado = {
        className: body.className,
        name: body.name.trim(),
        path: body.path.trim(),
        source: body.source
    };

    return res.json({ ok: true });
});

app.listen(PORT, () => {
    console.log("=================================");
    console.log("🤖 ROBLOX AI BRIDGE — GROQ");
    console.log("=================================");
    console.log(`Servidor: http://127.0.0.1:${PORT}`);
    console.log(`Modelo: ${GROQ_MODEL_ID}`);
    console.log("Reasoning: activado con salida oculta");
    console.log("Acciones: scripts + RemoteEvent + RemoteFunction + carpetas");
    console.log("=================================\n");
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("Escribe una petición para Groq. Escribe 'salir' para cerrar.\n");

while (true) {
    const mensaje = await rl.question("Tú: ");
    const texto = mensaje.trim();
    if (!texto) continue;
    if (texto.toLowerCase() === "salir") break;

    if (esTareaProgramacion(texto)) {
        await procesarProgramacion(texto);
    } else {
        await responderChat(texto);
    }
}

rl.close();
process.exit(0);
