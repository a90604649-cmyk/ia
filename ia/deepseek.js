import "dotenv/config";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL =
    process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-pro-0813";

function sleep(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

function obtenerErrorTexto(data) {
    if (!data) {
        return "Error desconocido de OpenRouter.";
    }

    if (typeof data === "string") {
        return data;
    }

    if (data.error?.message) {
        return String(data.error.message);
    }

    if (data.detail) {
        return String(data.detail);
    }

    if (data.message) {
        return String(data.message);
    }

    return JSON.stringify(data);
}

function esReintentable(status, mensaje) {
    const texto = String(mensaje || "").toLowerCase();

    return (
        status === 408 ||
        status === 425 ||
        status === 429 ||
        status === 500 ||
        status === 502 ||
        status === 503 ||
        status === 504 ||
        texto.includes("temporarily") ||
        texto.includes("unavailable") ||
        texto.includes("high demand") ||
        texto.includes("rate limit") ||
        texto.includes("overloaded")
    );
}

async function fetchJson(url, options, timeoutMs) {
    const controller = new AbortController();
    const timer = setTimeout(function() {
        controller.abort();
    }, timeoutMs);

    try {
        const response = await fetch(url, {
            ...options,
            signal: controller.signal
        });

        const texto = await response.text();
        let data = null;

        try {
            data = texto ? JSON.parse(texto) : null;
        } catch {
            data = texto;
        }

        return {
            response,
            data
        };
    } finally {
        clearTimeout(timer);
    }
}

export async function preguntarDeepSeek(mensajes, opciones = {}) {
    const apiKey = process.env.OPENROUTER_API_KEY;

    if (!apiKey) {
        throw new Error(
            "No se encontró OPENROUTER_API_KEY en el archivo .env"
        );
    }

    const maxReintentos = Number(opciones.maxReintentos || 3);
    const maxTokens = Math.min(
        16384,
        Math.max(256, Number(opciones.maxTokens || 16384))
    );

    const body = {
        model: opciones.model || OPENROUTER_MODEL,
        messages: mensajes,
        temperature: Number.isFinite(Number(opciones.temperature))
            ? Number(opciones.temperature)
            : 0.2,
        max_tokens: maxTokens,
        stream: false
    };

    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-Title": "Roblox AI Bridge"
    };

    if (process.env.OPENROUTER_SITE_URL) {
        headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
    }

    for (let intento = 1; intento <= maxReintentos; intento++) {
        try {
            const resultado = await fetchJson(
                OPENROUTER_URL,
                {
                    method: "POST",
                    headers,
                    body: JSON.stringify(body)
                },
                300000
            );

            if (!resultado.response.ok) {
                const mensaje = obtenerErrorTexto(resultado.data);

                if (
                    intento < maxReintentos &&
                    esReintentable(resultado.response.status, mensaje)
                ) {
                    const espera = intento * 2500;

                    console.warn(
                        `⚠️ OpenRouter ${resultado.response.status}. Reintentando en ${espera / 1000}s...`
                    );

                    await sleep(espera);
                    continue;
                }

                throw new Error(
                    `OpenRouter ${resultado.response.status}: ${mensaje}`
                );
            }

            return extraerTexto(resultado.data);
        } catch (error) {
            const mensaje =
                error instanceof Error
                    ? error.message
                    : String(error);

            const abortado =
                mensaje.toLowerCase().includes("aborted") ||
                mensaje.toLowerCase().includes("aborterror");

            if (
                intento < maxReintentos &&
                (abortado || mensaje.includes("fetch failed"))
            ) {
                const espera = intento * 2500;

                console.warn(
                    `⚠️ Error temporal de OpenRouter. Reintentando en ${espera / 1000}s...`
                );

                await sleep(espera);
                continue;
            }

            throw error;
        }
    }

    throw new Error("OpenRouter agotó todos los reintentos.");
}

function extraerTexto(data) {
    const texto =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        data?.output_text ??
        "";

    if (typeof texto !== "string" || !texto.trim()) {
        throw new Error(
            `OpenRouter no devolvió contenido válido: ${obtenerErrorTexto(data)}`
        );
    }

    return texto.trim();
}

export const DEEPSEEK_MODEL = OPENROUTER_MODEL;
export { OPENROUTER_MODEL };