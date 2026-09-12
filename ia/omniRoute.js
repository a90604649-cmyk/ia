import "dotenv/config";

const OMNIROUTE_URL = String(
    process.env.OMNIROUTE_URL || "http://127.0.0.1:20128/v1/chat/completions"
).trim();
const OMNIROUTE_MODEL = String(process.env.OMNIROUTE_MODEL || "auto").trim() || "auto";
const DEFAULT_TIMEOUT_MS = Math.max(5000, Number(process.env.OMNIROUTE_TIMEOUT_MS || 300000));
const DEFAULT_MAX_TOKENS = Math.min(16384, Math.max(256, Number(process.env.OMNIROUTE_MAX_OUTPUT_TOKENS || 16384)));
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
        // Contexto complementario; el contexto principal ya viaja en el mensaje.
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

function obtenerErrorTexto(data) {
    if (!data) return "Error desconocido de OmniRoute.";
    if (typeof data === "string") return data;
    if (data.error?.message) return String(data.error.message);
    if (data.message) return String(data.message);
    return JSON.stringify(data);
}

function crearBody(messages, options) {
    const body = {
        model: options.model || OMNIROUTE_MODEL,
        messages: Array.isArray(messages) ? messages : [],
        temperature: Number.isFinite(Number(options.temperature)) ? Number(options.temperature) : 0.6,
        max_tokens: Math.min(16384, Math.max(256, Number(options.maxCompletionTokens || DEFAULT_MAX_TOKENS))),
        stream: false
    };

    if (options.json === true) {
        body.response_format = { type: "json_object" };
    }

    return body;
}

async function fetchJson(options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), timeoutMs);

    try {
        const response = await fetch(OMNIROUTE_URL, {
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
        throw new Error(`OmniRoute no devolvió contenido válido: ${obtenerErrorTexto(data)}`);
    }
    return text.trim();
}

function esReintentable(status, mensaje) {
    const text = String(mensaje || "").toLowerCase();
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(status)) ||
        text.includes("timeout") || text.includes("timed out") ||
        text.includes("temporarily") || text.includes("overloaded") ||
        text.includes("unavailable");
}

function esperar(ms) {
    return new Promise((resolve) => setTimeout(resolve, ms));
}

export async function preguntarOmniRoute(messages, options = {}) {
    const key = String(process.env.OMNIROUTE_API_KEY || "").trim();
    if (!key) {
        throw new Error("No se encontró OMNIROUTE_API_KEY en el archivo .env");
    }

    const preparedMessages = await enriquecerMensajesProgramador(messages);
    const attempts = Math.max(1, Math.min(3, Number(options.attempts || 2)));
    let lastError = null;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            const result = await fetchJson({
                method: "POST",
                headers: {
                    Authorization: `Bearer ${key}`,
                    "Content-Type": "application/json",
                    Accept: "application/json"
                },
                body: JSON.stringify(crearBody(preparedMessages, options))
            }, Number(options.timeoutMs || DEFAULT_TIMEOUT_MS));

            if (!result.response.ok) {
                const message = obtenerErrorTexto(result.data);
                lastError = new Error(`OmniRoute ${result.response.status}: ${message}`);

                if (esReintentable(result.response.status, message) && attempt < attempts) {
                    const wait = Math.min(15000, 1000 * (2 ** (attempt - 1)));
                    await esperar(wait);
                    continue;
                }

                throw lastError;
            }

            const text = extraerTexto(result.data);
            console.log(`✅ OmniRoute respondió con ${result.data?.model || OMNIROUTE_MODEL}.`);
            return text;
        } catch (error) {
            lastError = error instanceof Error ? error : new Error(String(error));
            const message = lastError.message.toLowerCase();
            const networkError = message.includes("fetch failed") || message.includes("abort") ||
                message.includes("socket") || message.includes("timeout");

            if ((networkError || esReintentable(0, message)) && attempt < attempts) {
                const wait = Math.min(15000, 1000 * (2 ** (attempt - 1)));
                await esperar(wait);
                continue;
            }

            throw lastError;
        }
    }

    throw lastError || new Error("Todas las solicitudes de OmniRoute fallaron.");
}

export const OMNIROUTE_MODEL_ID = OMNIROUTE_MODEL;
export const OMNIROUTE_CONFIG = {
    model: OMNIROUTE_MODEL,
    maxCompletionTokens: DEFAULT_MAX_TOKENS,
    url: OMNIROUTE_URL
};
