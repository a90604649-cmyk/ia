import "dotenv/config";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
const GROQ_REASONING_EFFORT = process.env.GROQ_REASONING_EFFORT || "default";
const GROQ_REASONING_FORMAT = process.env.GROQ_REASONING_FORMAT || "hidden";
const DEFAULT_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 300000);
const DEFAULT_MAX_TOKENS = Math.min(16384, Math.max(256, Number(process.env.GROQ_MAX_OUTPUT_TOKENS || 16384)));
const DEFAULT_RETRY_DELAY_MS = Math.max(1000, Number(process.env.GROQ_RETRY_DELAY_MS || 5000));
const PROJECT_CONTEXT_PORT = Number(process.env.PROJECT_CONTEXT_PORT || 3001);
const EXTENDED_MARKER = "__ROBLOX_AI_EXTENDED_ACTION__";

const EXTENDED_ACTIONS = new Set([
    "create_instance", "delete_instance", "set_property", "set_properties",
    "rename_instance", "move_instance"
]);

const PROPERTY_NAMES = new Set([
    "Enabled", "Anchored", "CanCollide", "CanTouch", "CanQuery", "Transparency",
    "Reflectance", "CastShadow", "Massless", "Locked", "Size", "Position",
    "Orientation", "CFrame", "Color", "Material", "Shape", "Name", "Visible",
    "Active", "BackgroundTransparency", "BorderSizePixel", "TextTransparency",
    "TextSize", "ImageTransparency", "Value", "WalkSpeed", "JumpPower", "AutoRotate",
    "RequiresHandle", "CanBeDropped"
]);

const EXTENDED_PROGRAMMER_RULES = [
    "Puedes modificar instancias de Roblox Studio además de scripts, carpetas y remotes.",
    "Acciones: create_instance, delete_instance, set_property, set_properties, rename_instance, move_instance.",
    "Para propiedades usa siempre set_property/set_properties; nunca escribas script.Enabled = false ni equivalentes dentro del Source.",
    "Para mover usa move_instance; no uses Parent como propiedad.",
    "Identifica objetos existentes con path + name + ClassName.",
    "Conserva la arquitectura actual y modifica solo lo necesario."
].join("\n");

let globalCooldownUntil = 0;

function sleep(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

function obtenerClavesGroq() {
    const keys = String(process.env.GROQ_API_KEYS || "")
        .split(",")
        .map((key) => key.trim())
        .filter(Boolean);
    const single = String(process.env.GROQ_API_KEY || "").trim();
    if (single && !keys.includes(single)) keys.unshift(single);
    return [...new Set(keys)];
}

function obtenerErrorTexto(data) {
    if (!data) return "Error desconocido de Groq.";
    if (typeof data === "string") return data;
    if (data.error?.message) return String(data.error.message);
    if (data.message) return String(data.message);
    return JSON.stringify(data);
}

function esRateLimitOReintentable(status, mensaje) {
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

function obtenerRetryAfterMs(response, mensaje = "") {
    const header = response?.headers?.get?.("retry-after");
    if (header) {
        const seconds = Number(header);
        if (Number.isFinite(seconds)) return Math.max(1000, Math.ceil(seconds * 1000));
        const date = Date.parse(header);
        if (Number.isFinite(date)) return Math.max(1000, date - Date.now());
    }

    const match = String(mensaje).match(/in\s+(\d+(?:\.\d+)?)s/i);
    if (match) return Math.max(1000, Math.ceil(Number(match[1]) * 1000));
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
        const response = await fetch(url, { ...options, signal: controller.signal });
        const text = await response.text();
        let data;
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

function parsearLiteralSimple(texto) {
    const value = String(texto || "").trim();
    if (value === "true") return true;
    if (value === "false") return false;
    if (/^-?\d+(\.\d+)?$/.test(value)) return Number(value);
    if ((value.startsWith("\"") && value.endsWith("\"")) || (value.startsWith("'") && value.endsWith("'"))) {
        return value.slice(1, -1);
    }
    return null;
}

function convertirAsignacionPropiedadEnAccion(action) {
    if (!action || typeof action !== "object" || !String(action.type || "").startsWith("update_")) {
        return action;
    }

    const code = typeof action.code === "string" ? action.code : "";
    if (!code.trim()) return action;

    const lines = code
        .split(/\r?\n/)
        .map((line) => line.trim())
        .filter((line) => line && !line.startsWith("--") && !line.startsWith("--["));

    if (lines.length === 0) return action;

    const properties = {};
    for (const line of lines) {
        const match = line.match(/^(?:[A-Za-z_][A-Za-z0-9_]*)(?:\.[A-Za-z_][A-Za-z0-9_]*)?\.([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+)$/);
        if (!match) return action;

        const property = match[1];
        const literal = parsearLiteralSimple(match[2]);
        if (!PROPERTY_NAMES.has(property) || literal === null) return action;
        properties[property] = literal;
    }

    const entries = Object.entries(properties);
    if (entries.length === 0) return action;

    if (entries.length === 1) {
        const [property, value] = entries[0];
        return {
            type: "set_property",
            path: action.path,
            name: action.name,
            className: action.className,
            property,
            value
        };
    }

    return {
        type: "set_properties",
        path: action.path,
        name: action.name,
        className: action.className,
        properties
    };
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
    if (!objeto || typeof objeto !== "object" || !Array.isArray(objeto.actions)) return objeto;

    objeto.actions = objeto.actions.map((action) => {
        const normalizada = convertirAsignacionPropiedadEnAccion(action);
        if (!normalizada || typeof normalizada !== "object") return action;
        const type = String(normalizada.type || "").trim().toLowerCase();
        return EXTENDED_ACTIONS.has(type) ? empaquetarAccionExtendida(normalizada) : normalizada;
    });

    return objeto;
}

async function enriquecerMensajesProgramador(messages) {
    if (!Array.isArray(messages)) return messages;

    const isProgrammer = messages.some((message) =>
        message?.role === "system" &&
        /Eres el programador (principal|profesional) de Roblox Studio y Luau/i.test(String(message.content || ""))
    );

    if (!isProgrammer) return messages;

    const enriched = messages.map((message) => ({ ...message }));
    const systemIndex = enriched.findIndex((message) =>
        message?.role === "system" &&
        /Eres el programador (principal|profesional) de Roblox Studio y Luau/i.test(String(message.content || ""))
    );

    if (systemIndex >= 0) {
        enriched[systemIndex].content = [String(enriched[systemIndex].content || ""), EXTENDED_PROGRAMMER_RULES].join("\n\n");
    }

    const userIndex = [...enriched]
        .map((message, index) => ({ message, index }))
        .reverse()
        .find((item) => item.message?.role === "user")?.index;

    if (userIndex == null) return enriched;

    const query = String(enriched[userIndex].content || "").slice(-12000);

    try {
        const response = await fetch(
            `http://127.0.0.1:${PROJECT_CONTEXT_PORT}/project-context?query=${encodeURIComponent(query)}`,
            { headers: { Accept: "application/json" }, signal: AbortSignal.timeout(8000) }
        );
        if (!response.ok) return enriched;

        const context = await response.json();
        const objects = Array.isArray(context?.objects) ? context.objects : [];
        if (objects.length === 0) return enriched;

        const lines = objects
            .slice(0, 120)
            .map((object) => `- ${object.className}: ${object.path}/${object.name}`)
            .join("\n");

        enriched[userIndex].content = [
            enriched[userIndex].content,
            "",
            "CATÁLOGO REAL DE OBJETOS DE ROBLOX STUDIO:",
            lines,
            "Usa únicamente estas rutas y clases como referencia."
        ].join("\n");
    } catch {
        // Complementario; el contexto principal ya viaja en el mensaje.
    }

    return enriched;
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

function crearBody(messages, options, forzarTexto = false) {
    const body = {
        model: options.model || GROQ_MODEL,
        messages: Array.isArray(messages) ? messages : [],
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.6,
        max_completion_tokens: Math.min(16384, Math.max(256, Number(options.maxCompletionTokens || DEFAULT_MAX_TOKENS))),
        stream: false
    };

    if (options.json === true && !forzarTexto) {
        body.response_format = { type: "json_object" };
        body.reasoning_format = "hidden";
        body.reasoning_effort = options.reasoningEffort || GROQ_REASONING_EFFORT;
    } else {
        body.reasoning_effort = options.reasoningEffort || GROQ_REASONING_EFFORT;
        body.reasoning_format = options.reasoningFormat || GROQ_REASONING_FORMAT;
    }

    return body;
}

function esFalloJson400(status, mensaje) {
    if (status !== 400) return false;
    const text = String(mensaje || "").toLowerCase();
    return text.includes("failed to generate json") ||
        text.includes("failed to validate json") ||
        text.includes("adjust your prompt") ||
        text.includes("generated json");
}

export async function preguntarGroq(messages, options = {}) {
    const keys = obtenerClavesGroq();
    if (keys.length === 0) throw new Error("No se encontró GROQ_API_KEY ni GROQ_API_KEYS en el archivo .env");

    const preparedMessages = await enriquecerMensajesProgramador(messages);
    const attemptsPerKey = Math.max(1, Number(options.attemptsPerKey || 1));
    let lastError = null;

    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
        const key = keys[keyIndex];

        for (let attempt = 1; attempt <= attemptsPerKey; attempt++) {
            try {
                await esperarCooldownGlobal();
                let result = await fetchJson(
                    GROQ_URL,
                    {
                        method: "POST",
                        headers: {
                            Authorization: `Bearer ${key}`,
                            "Content-Type": "application/json",
                            Accept: "application/json"
                        },
                        body: JSON.stringify(crearBody(preparedMessages, options, false))
                    },
                    Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
                );

                if (!result.response.ok) {
                    const message = obtenerErrorTexto(result.data);

                    if (esFalloJson400(result.response.status, message) && options.json === true) {
                        console.warn("⚠️ Groq rechazó JSON Object Mode. Reintentando en modo texto y parseando localmente...");

                        const fallbackMessages = [
                            ...preparedMessages,
                            {
                                role: "system",
                                content: "IMPORTANTE: responde únicamente con un objeto JSON válido con exactamente las claves reply y actions. No uses markdown ni texto fuera del JSON. Mantén las acciones lo más compactas posible."
                            }
                        ];

                        result = await fetchJson(
                            GROQ_URL,
                            {
                                method: "POST",
                                headers: {
                                    Authorization: `Bearer ${key}`,
                                    "Content-Type": "application/json",
                                    Accept: "application/json"
                                },
                                body: JSON.stringify(crearBody(fallbackMessages, { ...options, json: false }, true))
                            },
                            Number(options.timeoutMs || DEFAULT_TIMEOUT_MS)
                        );

                        if (result.response.ok) {
                            const text = extraerTexto(result.data);
                            console.log(`✅ Groq respondió con ${options.model || GROQ_MODEL} usando fallback de texto.`);
                            return text;
                        }
                    }

                    const finalMessage = obtenerErrorTexto(result.data);
                    lastError = new Error(`Groq ${result.response.status}: ${finalMessage}`);

                    if (result.response.status === 429) {
                        const wait = obtenerRetryAfterMs(result.response, finalMessage);
                        globalCooldownUntil = Date.now() + wait;
                        console.warn(`⚠️ Groq rate limit (429). Reintento permitido en ~${Math.ceil(wait / 1000)}s.`);
                        if (attempt < attemptsPerKey) {
                            await sleep(wait);
                            continue;
                        }
                        if (keyIndex < keys.length - 1) break;
                    }

                    if (esRateLimitOReintentable(result.response.status, finalMessage) && attempt < attemptsPerKey) {
                        const wait = Math.max(DEFAULT_RETRY_DELAY_MS, Math.min(30000, 1000 * (2 ** (attempt - 1))));
                        await sleep(wait);
                        continue;
                    }

                    throw lastError;
                }

                const text = extraerTexto(result.data);
                console.log(`✅ Groq respondió con ${options.model || GROQ_MODEL}.`);
                return text;
            } catch (error) {
                lastError = error instanceof Error ? error : new Error(String(error));
                const message = lastError.message.toLowerCase();
                const networkError = message.includes("fetch failed") || message.includes("abort") || message.includes("socket") || message.includes("timeout");

                if ((networkError || esRateLimitOReintentable(0, message)) && attempt < attemptsPerKey) {
                    const wait = Math.max(DEFAULT_RETRY_DELAY_MS, Math.min(30000, 1000 * (2 ** (attempt - 1))));
                    await sleep(wait);
                    continue;
                }

                if (keyIndex < keys.length - 1 && (networkError || esRateLimitOReintentable(0, message))) break;
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