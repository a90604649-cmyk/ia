import "dotenv/config";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
const GROQ_REASONING_EFFORT = process.env.GROQ_REASONING_EFFORT || "default";
const GROQ_REASONING_FORMAT = process.env.GROQ_REASONING_FORMAT || "hidden";
const DEFAULT_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 300000);
const DEFAULT_MAX_TOKENS = Math.min(16384, Math.max(1024, Number(process.env.GROQ_MAX_OUTPUT_TOKENS || 16384)));
const DEFAULT_RETRY_DELAY_MS = Math.max(1000, Number(process.env.GROQ_RETRY_DELAY_MS || 5000));
const PROJECT_CONTEXT_PORT = Number(process.env.PROJECT_CONTEXT_PORT || 3001);
const EXTENDED_MARKER = "__ROBLOX_AI_EXTENDED_ACTION__";

const EXTENDED_ACTIONS = new Set([
    "create_instance",
    "delete_instance",
    "set_property",
    "set_properties",
    "rename_instance",
    "move_instance"
]);

const EXTENDED_PROGRAMMER_RULES = [
    "EXTENSIÓN DEL BRIDGE: además de las acciones actuales de scripts, carpetas y remotes, puedes modificar instancias y propiedades de Roblox Studio.",
    "Acciones extendidas permitidas:",
    "- create_instance: {type, path, name, className, properties?}",
    "- delete_instance: {type, path, name, className?}",
    "- set_property: {type, path, name, className?, property, value}",
    "- set_properties: {type, path, name, className?, properties:{...}}",
    "- rename_instance: {type, path, name, className?, newName}",
    "- move_instance: {type, path, name, className?, targetPath}",
    "Para objetos existentes identifica siempre path + name + ClassName.",
    "Para crear scripts sigue usando create_script/create_local_script/create_module_script. Para RemoteEvent/RemoteFunction sigue usando sus acciones específicas.",
    "Para propiedades usa números, booleanos y strings normales o valores tipados: {type:\"Vector3\",x,y,z}, {type:\"Color3\",r,g,b}, {type:\"CFrame\",x,y,z,rx,ry,rz}, {type:\"UDim2\",xScale,xOffset,yScale,yOffset}, {type:\"Enum\",enum:\"Material\",value:\"ForceField\"}.",
    "Enabled, Anchored, CanCollide, Transparency, Position, Size, Color, Material y otras propiedades públicas de Roblox pueden modificarse cuando sean válidas para ese objeto.",
    "Conserva la arquitectura actual y cambia solo lo necesario. Para organizar un sistema puedes combinar create_instance, move_instance, rename_instance y set_property."
].join("\n");

let globalCooldownUntil = 0;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function obtenerClavesGroq() {
    const varias = String(process.env.GROQ_API_KEYS || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
    const individual = String(process.env.GROQ_API_KEY || "").trim();

    if (individual && !varias.includes(individual)) {
        varias.unshift(individual);
    }

    return [...new Set(varias)];
}

function obtenerErrorTexto(data) {
    if (!data) return "Error desconocido de Groq.";
    if (typeof data === "string") return data;
    if (data.error?.message) return String(data.error.message);
    if (data.message) return String(data.message);
    return JSON.stringify(data);
}

function esReintentable(status, mensaje) {
    const texto = String(mensaje || "").toLowerCase();
    return (
        status === 408 || status === 409 || status === 425 || status === 429 ||
        status === 500 || status === 502 || status === 503 || status === 504 ||
        texto.includes("rate limit") || texto.includes("too many requests") ||
        texto.includes("temporarily") || texto.includes("overloaded") ||
        texto.includes("unavailable") || texto.includes("timeout") ||
        texto.includes("timed out")
    );
}

function obtenerRetryAfterMs(response) {
    const retryAfter = response?.headers?.get?.("retry-after");
    if (!retryAfter) return DEFAULT_RETRY_DELAY_MS;

    const segundos = Number(retryAfter);
    if (Number.isFinite(segundos)) return Math.max(1000, Math.ceil(segundos * 1000));

    const fecha = Date.parse(retryAfter);
    if (Number.isFinite(fecha)) return Math.max(1000, fecha - Date.now());

    return DEFAULT_RETRY_DELAY_MS;
}

async function esperarCooldownGlobal() {
    const restante = globalCooldownUntil - Date.now();
    if (restante > 0) {
        console.warn(`⏳ Groq en cooldown. Esperando ${Math.ceil(restante / 1000)}s...`);
        await sleep(restante);
    }
}

async function fetchJson(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });
        const text = await response.text();
        let data = null;

        try {
            data = text ? JSON.parse(text) : null;
        } catch {
            data = text;
        }

        return { response, data };
    } finally {
        clearTimeout(timer);
    }
}

function extraerTexto(data) {
    const text = data?.choices?.[0]?.message?.content ?? "";
    if (typeof text !== "string" || !text.trim()) {
        throw new Error(`Groq no devolvió contenido válido: ${obtenerErrorTexto(data)}`);
    }
    return text.trim();
}

function limpiarMarkdownJson(texto) {
    return String(texto || "")
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}

function empaquetarAccionExtendida(action) {
    const payload = {
        ...action,
        type: String(action.type || "").trim().toLowerCase(),
        __extended: true
    };

    return {
        type: "update_script",
        className: "Script",
        name: String(action.name || "__RobloxAIBridgeExtendedAction__"),
        path: String(action.path || "ReplicatedStorage"),
        code: `${EXTENDED_MARKER}\n${JSON.stringify(payload)}`
    };
}

function adaptarAccionesExtendidas(objeto) {
    if (!objeto || typeof objeto !== "object" || !Array.isArray(objeto.actions)) {
        return objeto;
    }

    objeto.actions = objeto.actions.map((action) => {
        if (!action || typeof action !== "object") return action;
        const type = String(action.type || "").trim().toLowerCase();
        if (EXTENDED_ACTIONS.has(type)) return empaquetarAccionExtendida(action);
        return action;
    });

    return objeto;
}

async function enriquecerMensajesProgramador(messages) {
    if (!Array.isArray(messages)) return messages;

    const esProgramador = messages.some((message) =>
        message?.role === "system" &&
        String(message.content || "").includes("Eres el programador principal de Roblox Studio")
    );

    if (!esProgramador) return messages;

    const enriquecidos = messages.map((message) => ({ ...message }));
    const systemIndex = enriquecidos.findIndex((message) =>
        message?.role === "system" &&
        String(message.content || "").includes("Eres el programador principal de Roblox Studio")
    );

    if (systemIndex >= 0) {
        enriquecidos[systemIndex].content = [
            String(enriquecidos[systemIndex].content || ""),
            EXTENDED_PROGRAMMER_RULES
        ].join("\n\n");
    }

    const ultimoUsuarioIndex = [...enriquecidos].map((message, index) => ({ message, index }))
        .reverse()
        .find((item) => item.message?.role === "user")?.index;

    if (ultimoUsuarioIndex == null) return enriquecidos;

    const query = String(enriquecidos[ultimoUsuarioIndex].content || "").slice(-12000);

    try {
        const response = await fetch(
            `http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-context?query=${encodeURIComponent(query)}`,
            {
                headers: { Accept: "application/json" },
                signal: AbortSignal.timeout(8000)
            }
        );

        if (!response.ok) return enriquecidos;
        const context = await response.json();
        const objects = Array.isArray(context?.objects) ? context.objects : [];
        if (objects.length === 0) return enriquecidos;

        const objectLines = objects
            .slice(0, 500)
            .map((object) => `- ${object.className}: ${object.path}/${object.name}`)
            .join("\n");

        enriquecidos[ultimoUsuarioIndex].content = [
            enriquecidos[ultimoUsuarioIndex].content,
            "",
            "CATÁLOGO REAL DE OBJETOS DE ROBLOX STUDIO:",
            objectLines,
            "Usa estas rutas y clases como referencia. No inventes objetos existentes."
        ].join("\n");
    } catch {
        // El catálogo de objetos es complementario; el flujo principal continúa.
    }

    return enriquecidos;
}

export function parsearRespuestaJson(texto) {
    const limpio = limpiarMarkdownJson(texto);
    let objeto = null;

    try {
        objeto = JSON.parse(limpio);
    } catch {
        const inicio = limpio.indexOf("{");
        const fin = limpio.lastIndexOf("}");
        if (inicio === -1 || fin <= inicio) return null;

        try {
            objeto = JSON.parse(limpio.slice(inicio, fin + 1));
        } catch {
            return null;
        }
    }

    return adaptarAccionesExtendidas(objeto);
}

export async function preguntarGroq(messages, options = {}) {
    const keys = obtenerClavesGroq();
    if (keys.length === 0) {
        throw new Error("No se encontró GROQ_API_KEY ni GROQ_API_KEYS en el archivo .env");
    }

    const maxCompletionTokens = Math.min(
        16384,
        Math.max(1024, Number(options.maxCompletionTokens || DEFAULT_MAX_TOKENS))
    );

    const preparedMessages = await enriquecerMensajesProgramador(messages);

    const body = {
        model: options.model || GROQ_MODEL,
        messages: Array.isArray(preparedMessages) ? preparedMessages : [],
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.6,
        max_completion_tokens: maxCompletionTokens,
        stream: false
    };

    if (options.json === true) {
        body.response_format = { type: "json_object" };
        body.reasoning_format = "hidden";
        body.reasoning_effort = options.reasoningEffort || GROQ_REASONING_EFFORT;
    } else {
        body.reasoning_effort = options.reasoningEffort || GROQ_REASONING_EFFORT;
        body.reasoning_format = options.reasoningFormat || GROQ_REASONING_FORMAT;
    }

    let lastError = null;
    const attemptsPerKey = Math.max(1, Number(options.attemptsPerKey || 2));

    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
        const key = keys[keyIndex];

        for (let attempt = 1; attempt <= attemptsPerKey; attempt++) {
            try {
                await esperarCooldownGlobal();

                const result = await fetchJson(
                    GROQ_URL,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${key}`,
                            "Content-Type": "application/json",
                            Accept: "application/json"
                        },
                        body: JSON.stringify(body)
                    },
                    Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
                );

                if (!result.response.ok) {
                    const message = obtenerErrorTexto(result.data);
                    lastError = new Error(`Groq ${result.response.status}: ${message}`);

                    if (result.response.status === 429) {
                        const espera = obtenerRetryAfterMs(result.response);
                        globalCooldownUntil = Date.now() + espera;

                        console.warn(`⚠️ Groq rate limit (429). Reintento permitido en ~${Math.ceil(espera / 1000)}s.`);

                        if (attempt < attemptsPerKey) {
                            await sleep(espera);
                            continue;
                        }

                        if (keyIndex < keys.length - 1) {
                            console.warn(`⚠️ Probando la siguiente clave de Groq (${keyIndex + 2}/${keys.length}) después del cooldown.`);
                            break;
                        }

                        throw lastError;
                    }

                    if (esReintentable(result.response.status, message)) {
                        const espera = Math.max(
                            DEFAULT_RETRY_DELAY_MS,
                            Math.min(30000, 1000 * Math.pow(2, attempt - 1))
                        );

                        if (attempt < attemptsPerKey) {
                            console.warn(`⚠️ Groq temporalmente no disponible (${result.response.status}). Reintentando en ${Math.ceil(espera / 1000)}s...`);
                            await sleep(espera);
                            continue;
                        }

                        if (keyIndex < keys.length - 1) break;
                    }

                    throw lastError;
                }

                const text = extraerTexto(result.data);
                console.log(`✅ Groq respondió con ${body.model}.`);
                return text;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const message = lastError.message.toLowerCase();
                const networkError =
                    message.includes("fetch failed") ||
                    message.includes("aborted") ||
                    message.includes("aborterror") ||
                    message.includes("socket") ||
                    message.includes("timeout");

                if ((networkError || esReintentable(0, message)) && attempt < attemptsPerKey) {
                    const espera = Math.max(
                        DEFAULT_RETRY_DELAY_MS,
                        Math.min(30000, 1000 * Math.pow(2, attempt - 1))
                    );
                    await sleep(espera);
                    continue;
                }

                if ((networkError || esReintentable(0, message)) && keyIndex < keys.length - 1) break;
                throw lastError;
            }
        }
    }

    throw lastError || new Error("Todas las claves de Groq fallaron.");
}

export const GROQ_MODEL_ID = GROQ_MODEL;
export const GROQ_CONFIG = {
    model: GROQ_MODEL,
    reasoningEffort: GROQ_REASONING_EFFORT,
    reasoningFormat: GROQ_REASONING_FORMAT,
    maxCompletionTokens: DEFAULT_MAX_TOKENS
};