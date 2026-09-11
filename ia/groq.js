import "dotenv/config";

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const GROQ_MODEL = process.env.GROQ_MODEL || "qwen/qwen3.6-27b";
const GROQ_REASONING_EFFORT = process.env.GROQ_REASONING_EFFORT || "default";
const GROQ_REASONING_FORMAT = process.env.GROQ_REASONING_FORMAT || "hidden";
const DEFAULT_TIMEOUT_MS = Number(process.env.GROQ_TIMEOUT_MS || 300000);
const DEFAULT_MAX_TOKENS = Math.min(16384, Math.max(1024, Number(process.env.GROQ_MAX_OUTPUT_TOKENS || 16384)));

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
        status === 408 ||
        status === 409 ||
        status === 425 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        texto.includes("rate limit") ||
        texto.includes("too many requests") ||
        texto.includes("temporarily") ||
        texto.includes("overloaded") ||
        texto.includes("unavailable") ||
        texto.includes("timeout") ||
        texto.includes("timed out")
    );
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

export function parsearRespuestaJson(texto) {
    const limpio = limpiarMarkdownJson(texto);

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

export async function preguntarGroq(messages, options = {}) {
    const keys = obtenerClavesGroq();

    if (keys.length === 0) {
        throw new Error("No se encontró GROQ_API_KEY ni GROQ_API_KEYS en el archivo .env");
    }

    const maxCompletionTokens = Math.min(
        16384,
        Math.max(1024, Number(options.maxCompletionTokens || DEFAULT_MAX_TOKENS))
    );

    const body = {
        model: options.model || GROQ_MODEL,
        messages: Array.isArray(messages) ? messages : [],
        temperature: Number.isFinite(Number(options.temperature))
            ? Number(options.temperature)
            : 0.6,
        max_completion_tokens: maxCompletionTokens,
        stream: false
    };

    if (options.json === true) {
        body.response_format = { type: "json_object" };
        body.reasoning_format = "hidden";
    } else {
        body.reasoning_effort = options.reasoningEffort || GROQ_REASONING_EFFORT;
        body.reasoning_format = options.reasoningFormat || GROQ_REASONING_FORMAT;
    }

    if (options.json === true) {
        body.reasoning_effort = options.reasoningEffort || GROQ_REASONING_EFFORT;
    }

    let lastError = null;
    const attemptsPerKey = Math.max(1, Number(options.attemptsPerKey || 2));

    for (let keyIndex = 0; keyIndex < keys.length; keyIndex++) {
        const key = keys[keyIndex];

        for (let attempt = 1; attempt <= attemptsPerKey; attempt++) {
            try {
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

                    if (esReintentable(result.response.status, message)) {
                        if (attempt < attemptsPerKey) {
                            console.warn(`⚠️ Groq temporalmente no disponible (${result.response.status}). Reintentando...`);
                            await sleep(attempt * 1200);
                            continue;
                        }

                        if (keyIndex < keys.length - 1) {
                            console.warn(`⚠️ Cambiando a la siguiente clave de Groq (${keyIndex + 2}/${keys.length}).`);
                            break;
                        }
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
                    await sleep(attempt * 1200);
                    continue;
                }

                if ((networkError || esReintentable(0, message)) && keyIndex < keys.length - 1) {
                    break;
                }

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
