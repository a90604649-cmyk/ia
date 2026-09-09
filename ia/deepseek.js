import "dotenv/config";

const NVIDIA_URL = "https://integrate.api.nvidia.com/v1/chat/completions";
const NVIDIA_STATUS_URL = "https://integrate.api.nvidia.com/v1/status";
const DEEPSEEK_MODEL = "deepseek-ai/deepseek-v4-pro-0813";

function sleep(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

function obtenerErrorTexto(data) {
    if (!data) {
        return "Error desconocido de NVIDIA.";
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
        texto.includes("rate limit")
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

async function esperarResultado(requestId, apiKey) {
    const maxIntentos = 60;

    for (let intento = 1; intento <= maxIntentos; intento++) {
        await sleep(2000);

        const resultado = await fetchJson(
            `${NVIDIA_STATUS_URL}/${encodeURIComponent(requestId)}`,
            {
                method: "GET",
                headers: {
                    Authorization: `Bearer ${apiKey}`,
                    Accept: "application/json"
                }
            },
            30000
        );

        if (resultado.response.status === 200) {
            return resultado.data;
        }

        if (resultado.response.status === 202) {
            console.log(
                `⏳ DeepSeek todavía está procesando (${intento}/${maxIntentos})...`
            );
            continue;
        }

        const mensaje = obtenerErrorTexto(resultado.data);
        throw new Error(
            `NVIDIA status ${resultado.response.status}: ${mensaje}`
        );
    }

    throw new Error("NVIDIA tardó demasiado en devolver el resultado.");
}

export async function preguntarDeepSeek(mensajes, opciones = {}) {
    const apiKey = process.env.NVIDIA_API_KEY;

    if (!apiKey) {
        throw new Error("No se encontró NVIDIA_API_KEY en el archivo .env");
    }

    const maxReintentos = Number(opciones.maxReintentos || 3);
    const maxTokens = Math.min(
        16384,
        Math.max(256, Number(opciones.maxTokens || 16384))
    );

    const body = {
        model: DEEPSEEK_MODEL,
        messages: mensajes,
        temperature: Number.isFinite(Number(opciones.temperature))
            ? Number(opciones.temperature)
            : 0.2,
        top_p: 0.95,
        max_tokens: maxTokens,
        reasoning_effort: opciones.reasoningEffort || "high",
        stream: false
    };

    for (let intento = 1; intento <= maxReintentos; intento++) {
        try {
            const resultado = await fetchJson(
                NVIDIA_URL,
                {
                    method: "POST",
                    headers: {
                        Authorization: `Bearer ${apiKey}`,
                        "Content-Type": "application/json",
                        Accept: "application/json"
                    },
                    body: JSON.stringify(body)
                },
                300000
            );

            if (resultado.response.status === 202) {
                const requestId = resultado.data?.requestId;

                if (!requestId) {
                    throw new Error(
                        "NVIDIA devolvió 202 pero no envió requestId."
                    );
                }

                return extraerTexto(
                    await esperarResultado(requestId, apiKey)
                );
            }

            if (!resultado.response.ok) {
                const mensaje = obtenerErrorTexto(resultado.data);

                if (
                    intento < maxReintentos &&
                    esReintentable(resultado.response.status, mensaje)
                ) {
                    const espera = intento * 2500;

                    console.warn(
                        `⚠️ DeepSeek/NVIDIA ${resultado.response.status}. Reintentando en ${espera / 1000}s...`
                    );

                    await sleep(espera);
                    continue;
                }

                throw new Error(
                    `NVIDIA ${resultado.response.status}: ${mensaje}`
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
                (abortado ||
                    mensaje.includes("fetch failed") ||
                    mensaje.includes("NVIDIA 408") ||
                    mensaje.includes("NVIDIA 425") ||
                    mensaje.includes("NVIDIA 429") ||
                    mensaje.includes("NVIDIA 500") ||
                    mensaje.includes("NVIDIA 502") ||
                    mensaje.includes("NVIDIA 503") ||
                    mensaje.includes("NVIDIA 504"))
            ) {
                const espera = intento * 2500;

                console.warn(
                    `⚠️ Error temporal de DeepSeek. Reintentando en ${espera / 1000}s...`
                );

                await sleep(espera);
                continue;
            }

            throw error;
        }
    }

    throw new Error("DeepSeek agotó todos los reintentos.");
}

function extraerTexto(data) {
    const texto =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        data?.output_text ??
        "";

    if (typeof texto !== "string" || !texto.trim()) {
        throw new Error(
            `DeepSeek no devolvió contenido válido: ${obtenerErrorTexto(data)}`
        );
    }

    return texto.trim();
}

export { DEEPSEEK_MODEL };