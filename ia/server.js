import "dotenv/config";
import express from "express";
import readline from "readline/promises";
import {
    GROQ_CONFIG,
    GROQ_MODEL_ID,
    preguntarGroq,
    parsearRespuestaJson
} from "./groq.js";

const app = express();
app.use(express.json({ limit: "8mb" }));

const PORT = Number(process.env.PORT || 3000);
const PROJECT_CONTEXT_PORT = Number(process.env.PROJECT_CONTEXT_PORT || 3001);

let pendingActions = [];
let contextoScriptSeleccionado = null;
const historial = [];

const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);
const BASES = [
    "ServerScriptService", "ServerStorage", "ReplicatedStorage", "StarterGui",
    "StarterPlayer", "StarterPack", "Workspace", "SoundService", "Lighting",
    "ReplicatedFirst", "Teams", "TextChatService", "Chat"
];

const STANDARD_ACTIONS = new Set([
    "create_script", "create_local_script", "create_module_script",
    "update_script", "update_local_script", "update_module_script",
    "delete_script", "delete_local_script", "delete_module_script",
    "create_remote_event", "create_remote_function",
    "delete_remote_event", "delete_remote_function",
    "create_folder", "delete_folder"
]);

const EXTENDED_ACTIONS = new Set([
    "create_instance", "set_property", "set_properties",
    "rename_instance", "move_instance", "delete_instance"
]);

const PROGRAMMER_SYSTEM = [
    "Eres el programador principal de Roblox Studio y Luau.",
    "Trabajas sobre el PROYECTO REAL. El contexto de Roblox que recibes contiene scripts, rutas, clases y objetos reales.",
    "Analiza la arquitectura y el SOURCE REAL antes de decidir cualquier cambio.",
    "Nunca inventes código existente, rutas, nombres u objetos cuando el contexto permita identificarlos.",
    "Usa path + name + ClassName para identificar un objeto existente.",
    "Conserva toda funcionalidad que no esté relacionada con la petición.",
    "",
    "SCRIPTS:",
    "Para Script/LocalScript/ModuleScript existentes usa update_* y devuelve el SOURCE COMPLETO.",
    "Usa create_* solo cuando el archivo no exista.",
    "",
    "REMOTES Y ESTRUCTURA:",
    "Puedes usar create_remote_event, create_remote_function, delete_remote_event, delete_remote_function, create_folder y delete_folder.",
    "",
    "INSTANCIAS Y PROPIEDADES:",
    "Puedes usar create_instance, set_property, set_properties, rename_instance, move_instance y delete_instance.",
    "Enabled, Anchored, CanCollide, Transparency, Position, Size, Color, Material, CFrame, FOV y otras propiedades públicas pueden cambiarse mediante acciones de propiedades cuando sean válidas.",
    "NUNCA escribas una propiedad de Roblox dentro del SOURCE para simular el cambio. Por ejemplo, no escribas `script.Enabled = false` para deshabilitar un LocalScript: devuelve set_property con property='Enabled' y value=false.",
    "NUNCA uses Source para cambiar una propiedad de una instancia.",
    "Para mover usa move_instance. No uses set_property con Parent.",
    "",
    "VALORES TIPADOS:",
    "Vector3: {type:'Vector3',x:0,y:0,z:0}",
    "Vector2: {type:'Vector2',x:0,y:0}",
    "Color3: {type:'Color3',r:1,g:1,b:1}",
    "CFrame: {type:'CFrame',x:0,y:0,z:0,rx:0,ry:0,rz:0} con grados",
    "UDim2: {type:'UDim2',xScale:0,xOffset:0,yScale:0,yOffset:0}",
    "Enum: {type:'Enum',enum:'Material',value:'Neon'}",
    "",
    "SALIDA:",
    "Devuelve UN SOLO objeto JSON válido con exactamente reply y actions.",
    "Sin markdown ni texto fuera del JSON.",
    "actions debe contener solamente acciones ejecutables por el bridge.",
    "Si el usuario pidió solamente analizar/revisar/inspeccionar, actions debe ser [] y reply debe contener el análisis, sin código genérico.",
    "No afirmes que probaste algo que no probaste."
].join("\n");

const CHAT_SYSTEM = [
    "Eres un asistente experto en Roblox Studio, Luau y desarrollo de juegos.",
    "Responde de forma clara, útil y directa.",
    "Puedes razonar sobre preguntas generales.",
    "Cuando una petición implique analizar o modificar el proyecto real, usa el flujo de programador con el contexto real del proyecto.",
    "No inventes resultados de ejecución."
].join("\n");

function agregarHistorial(role, text) {
    if (!text) return;
    historial.push({ role, text: String(text) });
    if (historial.length > 24) historial.splice(0, historial.length - 24);
}

function crearContextoReciente(limite = 8) {
    return historial
        .slice(-limite)
        .map((m) => `${m.role === "user" ? "Usuario" : "Asistente"}: ${m.text}`)
        .join("\n");
}

function esTareaProyecto(texto) {
    const t = String(texto || "").toLowerCase();
    const contexto = [
        "roblox", "studio", "luau", "lua", "script", "localscript", "modulescript",
        "sistema", "remoteevent", "remotefunction", "remote event", "remote function",
        "workspace", "replicatedstorage", "serverstorage", "starterplayer", "startergui",
        "r6", "tool", "part", "model", "frame", "gui", "objeto", "instancia", "property",
        "propiedad", "enabled", "transparency", "anchored", "cancollide", "position", "size",
        "color", "material", "carpeta", "folder", "camara", "camera", "jugador", "player",
        "character", "personaje", "humanoid", "movimiento", "movement", "primera persona", "first person",
        "apuntar", "apuntado", "aim", "mouse", "fov", "arma", "weapon", "juego", "jugabilidad", "gameplay"
    ];

    const accion = [
        "corrige", "corregir", "arregla", "arreglar", "soluciona", "solucionar", "repara", "reparar",
        "modifica", "modificar", "actualiza", "actualizar", "crea", "crear", "agrega", "agregar",
        "añade", "añadir", "implementa", "implementar", "elimina", "eliminar", "borra", "borrar",
        "cambia", "cambiar", "haz", "hacer", "programa", "programar", "mueve", "mover", "traslada",
        "renombra", "renombrar", "ordena", "ordenar", "habilita", "habilitar", "deshabilita", "deshabilitar",
        "activa", "activar", "desactiva", "desactivar", "pon", "poner", "ajusta", "ajustar"
    ];

    const analisis = [
        "analiza", "analizar", "revisa", "revisar", "inspecciona", "inspeccionar", "estudia", "estudiar",
        "investiga", "investigar", "verifica", "verificar", "examínalo", "examinar"
    ];

    const bug = ["error", "bug", "no funciona", "no sirve", "falla", "fallando", "problema"];
    const tieneContexto = contexto.some((x) => t.includes(x));

    return tieneContexto && (
        accion.some((x) => t.includes(x)) ||
        analisis.some((x) => t.includes(x)) ||
        bug.some((x) => t.includes(x))
    );
}

function esSoloAnalisis(texto) {
    const t = String(texto || "").toLowerCase();
    const pedirAnalisis = [
        "analiza", "analizar", "revisa", "revisar", "inspecciona", "inspeccionar",
        "estudia", "estudiar", "verifica", "verificar", "primero analiza", "primero revisa",
        "solo analiza", "solo analizar", "sin modificar", "no modifiques", "no cambies"
    ];
    const pedirCambios = [
        "modifica", "modificar", "corrige", "corregir", "arregla", "arreglar", "implementa", "implementar",
        "crea", "crear", "elimina", "eliminar", "borra", "borrar", "mueve", "mover", "cambia", "cambiar",
        "habilita", "deshabilita", "activa", "desactiva", "haz los cambios", "aplica"
    ];

    return pedirAnalisis.some((x) => t.includes(x)) && !pedirCambios.some((x) => t.includes(x));
}

async function obtenerContextoProyecto(mensaje) {
    try {
        const response = await fetch(
            `http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-context?query=${encodeURIComponent(String(mensaje || ""))}`,
            {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(20000)
            }
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
    const objects = Array.isArray(proyecto.objects) ? proyecto.objects : [];
    const selected = Array.isArray(proyecto.selected) ? proyecto.selected : [];

    const manifestTexto = manifest
        .map((s) => `- ${s.className}: ${s.path}/${s.name} (${s.size} chars)`)
        .join("\n");

    const objectsTexto = objects
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
        `Objetos detectados: ${proyecto.totalObjects ?? objects.length}`,
        "",
        "MANIFEST DE SCRIPTS:",
        manifestTexto || "(ninguno)",
        "",
        "OBJETOS EXISTENTES:",
        objectsTexto || "(ninguno)",
        "",
        "SOURCE RELEVANTE:",
        sourceTexto || "(ninguno seleccionado)",
        "",
        "RECUERDA:",
        "El proyecto anterior al cambio es la fuente de verdad.",
        "Para propiedades usa set_property/set_properties, no código dentro del Script.",
        "Para mover objetos usa move_instance."
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

function rutaValida(path) {
    return BASES.some((base) => path === base || path.startsWith(`${base}/`));
}

function nombreValido(name) {
    return Boolean(name)
        && !name.includes("/")
        && !name.includes("\\")
        && name !== "."
        && name !== "..";
}

function normalizarAccion(action) {
    if (!action || typeof action !== "object") return null;

    let type = String(action.type || action.operation || "").trim().toLowerCase();
    const className = String(action.className || "").trim();

    if (["create", "update", "delete"].includes(type) && SCRIPT_CLASSES.has(className)) {
        const suffix = className === "Script" ? "script" : className === "LocalScript" ? "local_script" : "module_script";
        type = `${type}_${suffix}`;
    }

    if (!STANDARD_ACTIONS.has(type) && !EXTENDED_ACTIONS.has(type)) return null;

    const path = String(action.path || "").trim();
    const name = String(action.name || "").trim();

    if (!path || !rutaValida(path) || !nombreValido(name)) return null;

    if (EXTENDED_ACTIONS.has(type)) {
        if (type === "create_instance") {
            if (!className) return null;
            const properties = action.properties && typeof action.properties === "object" ? action.properties : {};
            return { type, className, path, name, properties };
        }

        if (type === "set_property") {
            const property = String(action.property || "").trim();
            if (!property || ["Parent", "ClassName", "Source", "Archivable"].includes(property)) return null;
            return { type, className, path, name, property, value: action.value };
        }

        if (type === "set_properties") {
            if (!action.properties || typeof action.properties !== "object") return null;
            return { type, className, path, name, properties: action.properties };
        }

        if (type === "rename_instance") {
            const newName = String(action.newName || "").trim();
            return nombreValido(newName) ? { type, className, path, name, newName } : null;
        }

        if (type === "move_instance") {
            const targetPath = String(action.targetPath || "").trim();
            return rutaValida(targetPath) ? { type, className, path, name, targetPath } : null;
        }

        if (type === "delete_instance") {
            return { type, className, path, name };
        }
    }

    const classByType = {
        create_script: "Script", create_local_script: "LocalScript", create_module_script: "ModuleScript",
        update_script: "Script", update_local_script: "LocalScript", update_module_script: "ModuleScript",
        delete_script: "Script", delete_local_script: "LocalScript", delete_module_script: "ModuleScript"
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
    if (!parsed || typeof parsed !== "object") return null;

    const actions = [];
    for (const raw of Array.isArray(parsed.actions) ? parsed.actions : []) {
        const action = normalizarAccion(raw);
        if (action) actions.push(action);
        else console.warn("⚠️ Acción Groq rechazada:", raw?.type || raw?.operation || "desconocida");
    }

    const unique = new Map();
    for (const action of actions) {
        unique.set(`${action.type}|${action.path}/${action.name}|${action.property || ""}`, action);
    }

    return {
        reply: String(parsed.reply || "").trim(),
        actions: [...unique.values()]
    };
}

async function procesarProgramacion(mensajeUsuario, soloAnalisis = false) {
    const proyecto = await obtenerContextoProyecto(mensajeUsuario);
    const contexto = construirContextoProyecto(proyecto);
    const seleccionado = construirContextoSeleccionado();
    const reciente = crearContextoReciente(6);

    const modo = soloAnalisis
        ? [
            "MODO: SOLO ANÁLISIS.",
            "No implementes cambios.",
            "No devuelvas código genérico.",
            "No pidas al usuario que pegue scripts que ya estén presentes en el contexto.",
            "Analiza los scripts relevantes que recibiste, explica cómo funciona actualmente el sistema, qué archivos están relacionados, qué problemas o conflictos ves y qué cambios recomendarías después.",
            "actions DEBE ser []."
        ].join("\n")
        : [
            "MODO: IMPLEMENTACIÓN.",
            "Aplica la petición al proyecto real usando las acciones disponibles.",
            "No reemplaces una modificación de propiedad por código dentro del Source."
        ].join("\n");

    const contenido = [
        modo,
        "",
        "PETICIÓN DEL USUARIO:",
        mensajeUsuario,
        "",
        "HISTORIAL RECIENTE:",
        reciente || "(sin historial)",
        "",
        contexto,
        seleccionado,
        "",
        "Analiza el contexto recibido antes de responder."
    ].filter(Boolean).join("\n");

    try {
        console.log(`🤖 Groq ${soloAnalisis ? "analizando" : "programando"} con ${GROQ_MODEL_ID}...`);

        const texto = await preguntarGroq(
            [
                { role: "system", content: PROGRAMMER_SYSTEM },
                { role: "user", content: contenido }
            ],
            {
                json: true,
                reasoningEffort: soloAnalisis ? "low" : (process.env.GROQ_REASONING_EFFORT || "default"),
                reasoningFormat: "hidden",
                temperature: 0.3,
                maxCompletionTokens: soloAnalisis ? 700 : Math.min(900, Number(process.env.GROQ_MAX_OUTPUT_TOKENS || 900)),
                timeoutMs: Number(process.env.GROQ_TIMEOUT_MS || 300000),
                attemptsPerKey: 1
            }
        );

        const resultado = extraerResultado(texto);
        if (!resultado) {
            console.warn("⚠️ Groq no devolvió el JSON esperado.");
            return null;
        }

        if (soloAnalisis) {
            resultado.actions = [];
        }

        pendingActions = resultado.actions;
        agregarHistorial("user", mensajeUsuario);
        agregarHistorial("assistant", resultado.reply);

        console.log(`✅ Groq terminó: ${pendingActions.length} acción(es).`);
        console.log(resultado.reply);
        return resultado;
    } catch (error) {
        console.error("❌ Error de Groq:", error instanceof Error ? error.message : String(error));
        return null;
    }
}

async function responderChat(mensajeUsuario) {
    try {
        const texto = await preguntarGroq(
            [
                { role: "system", content: CHAT_SYSTEM },
                ...historial.slice(-8).map((m) => ({ role: m.role, content: m.text })),
                { role: "user", content: mensajeUsuario }
            ],
            {
                reasoningEffort: process.env.GROQ_REASONING_EFFORT || "default",
                reasoningFormat: "hidden",
                temperature: 0.5,
                maxCompletionTokens: Math.min(700, Number(process.env.GROQ_CHAT_MAX_OUTPUT_TOKENS || 700)),
                attemptsPerKey: 1
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
            "reasoning",
            "scripts",
            "RemoteEvent",
            "RemoteFunction",
            "folders",
            "instances",
            "properties",
            "move",
            "rename"
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

    if (!SCRIPT_CLASSES.has(body.className)
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
    console.log("Acciones: scripts + RemoteEvent + RemoteFunction + carpetas + instancias + propiedades");
    console.log("=================================\n");
});

const rl = readline.createInterface({ input: process.stdin, output: process.stdout });
console.log("Escribe una petición para Groq. Escribe 'salir' para cerrar.\n");

while (true) {
    const mensaje = await rl.question("Tú: ");
    const texto = mensaje.trim();

    if (!texto) continue;
    if (texto.toLowerCase() === "salir") break;

    if (esTareaProyecto(texto)) {
        await procesarProgramacion(texto, esSoloAnalisis(texto));
    } else {
        await responderChat(texto);
    }
}

rl.close();
process.exit(0);
