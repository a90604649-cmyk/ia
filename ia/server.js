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
const EXTENDED_MARKER = "__ROBLOX_AI_EXTENDED_ACTION__";

let pendingActions = [];
let contextoScriptSeleccionado = null;
const historial = [];

const SCRIPT_CLASSES = new Set(["Script", "LocalScript", "ModuleScript"]);
const BASES = [
    "ServerScriptService", "ServerStorage", "ReplicatedStorage", "StarterGui",
    "StarterPlayer", "StarterPack", "Workspace", "SoundService", "Lighting",
    "ReplicatedFirst", "Teams", "TextChatService", "Chat"
];

const PROGRAMMER_SYSTEM = [
    "Eres un programador profesional de Roblox Studio y Luau.",
    "Trabajas sobre el proyecto REAL cuyo contexto aparece en la petición.",
    "Analiza primero el problema y la arquitectura; después implementa la solución.",
    "Conserva toda funcionalidad existente que el usuario no pidió cambiar.",
    "",
    "IDENTIFICACIÓN:",
    "- Nunca identifiques un objeto solo por su nombre.",
    "- Usa path + name + ClassName cuando estén disponibles.",
    "- El SOURCE REAL recibido tiene prioridad sobre cualquier suposición.",
    "- Para un Script/LocalScript/ModuleScript existente usa update_* y devuelve el SOURCE COMPLETO.",
    "- Usa create_* de scripts solo cuando el archivo no exista.",
    "- Antes de crear un RemoteEvent o RemoteFunction revisa REMOTES/OBJETOS EXISTENTES.",
    "",
    "ACCIONES DE SCRIPT:",
    "create_script, create_local_script, create_module_script",
    "update_script, update_local_script, update_module_script",
    "delete_script, delete_local_script, delete_module_script",
    "",
    "ACCIONES DE ESTRUCTURA:",
    "create_folder, delete_folder",
    "create_remote_event, create_remote_function",
    "delete_remote_event, delete_remote_function",
    "",
    "ACCIONES DE INSTANCIAS Y PROPIEDADES:",
    "Puedes usar estas acciones para modificar objetos reales del proyecto:",
    "create_instance, set_property, set_properties, rename_instance, move_instance, delete_instance",
    "",
    "create_instance:",
    "{ type:'create_instance', className:'Part', path:'Workspace', name:'Example', properties:{Anchored:true, Transparency:0.5} }",
    "set_property:",
    "{ type:'set_property', path:'Workspace/Folder', name:'Part', className:'Part', property:'Anchored', value:true }",
    "set_properties:",
    "{ type:'set_properties', path:'Workspace/Folder', name:'Part', className:'Part', properties:{Anchored:true, CanCollide:false} }",
    "rename_instance:",
    "{ type:'rename_instance', path:'Workspace/Folder', name:'Old', className:'Part', newName:'New' }",
    "move_instance:",
    "{ type:'move_instance', path:'Workspace/Folder', name:'Part', className:'Part', targetPath:'ReplicatedStorage/Objects' }",
    "delete_instance:",
    "{ type:'delete_instance', path:'Workspace/Folder', name:'Part', className:'Part' }",
    "",
    "VALORES TIPADOS:",
    "Para Vector3 usa {type:'Vector3',x:0,y:0,z:0}.",
    "Para Vector2 usa {type:'Vector2',x:0,y:0}.",
    "Para Color3 usa {type:'Color3',r:1,g:1,b:1}.",
    "Para CFrame usa {type:'CFrame',x:0,y:0,z:0,rx:0,ry:0,rz:0} con rotación en grados.",
    "Para UDim2 usa {type:'UDim2',xScale:0,xOffset:0,yScale:0,yOffset:0}.",
    "Para Enum usa {type:'Enum',enum:'Material',value:'Neon'}.",
    "",
    "REGLAS DE SEGURIDAD:",
    "- Nunca cambies Parent directamente con set_property; usa move_instance.",
    "- Nunca cambies ClassName ni Source con set_property.",
    "- No elimines ni modifiques el plugin del bridge.",
    "- Usa solo acciones necesarias para la petición.",
    "- No inventes rutas ni objetos cuando el contexto permita identificarlos.",
    "",
    "SALIDA:",
    "Devuelve UN SOLO objeto JSON válido sin markdown ni texto fuera del JSON.",
    "Debe tener exactamente: reply y actions.",
    "reply explica brevemente qué encontraste y qué vas a cambiar.",
    "actions contiene únicamente acciones aplicables por el bridge.",
    "Si no hace falta cambiar nada, actions debe ser [].",
    "No afirmes que ejecutaste o probaste algo que no se ejecutó."
].join("\n");

const CHAT_SYSTEM = [
    "Eres un asistente experto en Roblox Studio, Luau y desarrollo de juegos.",
    "Responde de forma clara y directa.",
    "Las preguntas normales pueden ser razonadas con profundidad.",
    "Cuando el usuario pida cambiar realmente el proyecto, la petición debe resolverse como una tarea de programación con acciones para Roblox Studio.",
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

function esTareaProgramacion(texto) {
    const t = String(texto || "").toLowerCase();
    const contexto = [
        "roblox", "studio", "luau", "lua", "script", "localscript", "modulescript",
        "sistema", "remoteevent", "remotefunction", "remote event", "remote function",
        "workspace", "replicatedstorage", "serverstorage", "starterplayer", "startergui",
        "r6", "tool", "part", "model", "frame", "gui", "objeto", "instancia", "property",
        "propiedad", "enabled", "transparency", "anchored", "cancollide", "position", "size",
        "color", "material", "carpeta", "folder"
    ];
    const accion = [
        "corrige", "corregir", "arregla", "arreglar", "soluciona", "solucionar", "repara", "reparar",
        "modifica", "modificar", "actualiza", "actualizar", "crea", "crear", "agrega", "agregar",
        "añade", "añadir", "implementa", "implementar", "elimina", "eliminar", "borra", "borrar",
        "cambia", "cambiar", "haz", "hacer", "programa", "programar", "mueve", "mover", "traslada",
        "trasladar", "renombra", "renombrar", "ordena", "ordenar", "habilita", "habilitar", "deshabilita",
        "deshabilitar", "activa", "activar", "desactiva", "desactivar", "pon", "poner", "ajusta", "ajustar"
    ];
    const bug = ["error", "bug", "no funciona", "no sirve", "falla", "fallando", "problema"];

    return (contexto.some((x) => t.includes(x)) && accion.some((x) => t.includes(x)))
        || (contexto.some((x) => t.includes(x)) && bug.some((x) => t.includes(x)));
}

async function obtenerContextoProyecto(mensaje) {
    try {
        const response = await fetch(
            `http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-context?query=${encodeURIComponent(String(mensaje || ""))}`,
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
        `Objetos importantes detectados: ${proyecto.totalObjects ?? objetos.length}`,
        "",
        "MANIFEST DE SCRIPTS:",
        manifestTexto || "(ninguno)",
        "",
        "OBJETOS Y REMOTES EXISTENTES:",
        objetosTexto || "(ninguno)",
        "",
        "SOURCE RELEVANTE:",
        sourceTexto || "(ninguno seleccionado)",
        "",
        "REGLAS:",
        "- El SOURCE es real.",
        "- Usa path + name + ClassName para identificar objetos.",
        "- No inventes objetos cuando el contexto tenga la información necesaria.",
        "- Mantén intacta la funcionalidad no relacionada."
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

    let type = String(action.type || "").trim().toLowerCase();
    const operation = String(action.operation || "").trim().toLowerCase();
    const className = String(action.className || "").trim();

    if (!type && ["create", "update", "delete"].includes(operation) && SCRIPT_CLASSES.has(className)) {
        const suffix = className === "Script" ? "script" : className === "LocalScript" ? "local_script" : "module_script";
        type = `${operation}_${suffix}`;
    }

    const allowed = new Set([
        "create_script", "create_local_script", "create_module_script",
        "update_script", "update_local_script", "update_module_script",
        "delete_script", "delete_local_script", "delete_module_script",
        "create_remote_event", "create_remote_function",
        "delete_remote_event", "delete_remote_function",
        "create_folder", "delete_folder",
        "create_instance", "set_property", "set_properties",
        "rename_instance", "move_instance", "delete_instance"
    ]);

    if (!allowed.has(type)) return null;

    const path = String(action.path || "").trim();
    const name = String(action.name || "").trim();

    if (!path || !rutaValida(path) || !nombreValido(name)) return null;

    const structural = type === "create_folder"
        || type === "delete_folder"
        || type.startsWith("create_remote_")
        || type.startsWith("delete_remote_");

    if (structural) return { type, path, name };

    if (type === "create_instance") {
        if (!CLASES_CREABLES.has(className)) return null;
        return {
            type,
            className,
            path,
            name,
            properties: action.properties && typeof action.properties === "object" ? action.properties : {}
        };
    }

    if (type === "set_property") {
        const property = String(action.property || "").trim();
        if (!property || property === "Parent" || property === "ClassName" || property === "Source" || property === "Archivable") return null;
        return { type, className, path, name, property, value: action.value };
    }

    if (type === "set_properties") {
        if (!action.properties || typeof action.properties !== "object") return null;
        return { type, className, path, name, properties: action.properties };
    }

    if (type === "rename_instance") {
        const newName = String(action.newName || "").trim();
        if (!nombreValido(newName)) return null;
        return { type, className, path, name, newName };
    }

    if (type === "move_instance") {
        const targetPath = String(action.targetPath || "").trim();
        if (!rutaValida(targetPath)) return null;
        return { type, className, path, name, targetPath };
    }

    if (type === "delete_instance") {
        return { type, className, path, name };
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

const CLASES_CREABLES = new Set([
    "Folder", "Model", "Part", "MeshPart", "Tool", "RemoteEvent", "RemoteFunction",
    "BindableEvent", "BindableFunction", "Attachment", "Motor6D", "WeldConstraint",
    "ProximityPrompt", "ScreenGui", "Frame", "TextLabel", "TextButton", "TextBox",
    "ImageLabel", "ImageButton"
]);

function actionKey(action) {
    return JSON.stringify([
        action.type,
        action.path,
        action.name,
        action.property || "",
        action.newName || "",
        action.targetPath || ""
    ]);
}

function extraerResultado(texto) {
    const parsed = parsearRespuestaJson(texto);
    if (!parsed || typeof parsed !== "object" || !Array.isArray(parsed.actions)) return null;

    const actions = [];
    for (const raw of parsed.actions) {
        const action = normalizarAccion(raw);
        if (action) actions.push(action);
        else console.warn("⚠️ Acción Groq rechazada:", raw?.type || raw?.operation || "desconocida");
    }

    const unique = new Map();
    for (const action of actions) unique.set(actionKey(action), action);

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

        const updateByClass = { Script: "update_script", LocalScript: "update_local_script", ModuleScript: "update_module_script" };
        const createByClass = { Script: "create_script", LocalScript: "create_local_script", ModuleScript: "create_module_script" };

        const actions = resultado.actions.map((action) => {
            if (!SCRIPT_CLASSES.has(action.className) || !action.type.includes("script")) return action;

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

function empaquetarAccionesExtendidas(actions) {
    return actions.map((action) => {
        if (!["create_instance", "set_property", "set_properties", "rename_instance", "move_instance", "delete_instance"].includes(action.type)) {
            return action;
        }

        return {
            type: "update_script",
            className: "Script",
            path: action.path,
            name: action.name,
            code: `${EXTENDED_MARKER} ${JSON.stringify(action)}`
        };
    });
}

async function procesarProgramacion(mensajeUsuario) {
    const proyecto = await obtenerContextoProyecto(mensajeUsuario);
    const contexto = construirContextoProyecto(proyecto);
    const reciente = crearContextoReciente(8);
    const seleccionado = construirContextoSeleccionado();

    const contenido = [
        "PETICIÓN ORIGINAL:", mensajeUsuario,
        "", "CONTEXTO DE CONVERSACIÓN:", reciente || "(sin conversación previa)",
        "", contexto, seleccionado,
        "", "RAZONA Y DESPUÉS IMPLEMENTA LOS CAMBIOS. DEVUELVE SOLO EL JSON REQUERIDO."
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
                console.warn("⚠️ Groq devolvió un JSON incompatible con el formato esperado.");
                if (intento === 2) return null;
                continue;
            }

            resultado = await ajustarAccionesPorManifest(resultado);
            resultado = { ...resultado, actions: empaquetarAccionesExtendidas(resultado.actions) };
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
            "reasoning", "create/update/delete scripts", "RemoteEvent", "RemoteFunction",
            "folders", "instances", "properties", "rename", "move", "delete"
        ],
        pendingActions: pendingActions.length
    });
});

app.get("/health", (_req, res) => {
    const keys = String(process.env.GROQ_API_KEYS || "").split(",").map((key) => key.trim()).filter(Boolean);
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

    if (esTareaProgramacion(texto)) await procesarProgramacion(texto);
    else await responderChat(texto);
}

rl.close();
process.exit(0);
