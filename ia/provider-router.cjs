const realFetch = globalThis.fetch.bind(globalThis);

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_MODELS = String(
    process.env.OPENROUTER_MODELS ||
    "poolside/laguna-s-2.1:free,cohere/north-mini-code:free,nex-agi/nex-n2.5-pro:free"
)
    .split(",")
    .map((model) => model.trim())
    .filter(Boolean);

const OPENROUTER_MAX_TOKENS = Math.min(
    16384,
    Math.max(512, Number(process.env.OPENROUTER_MAX_OUTPUT_TOKENS || 8192))
);
const GROQ_SWITCH_THRESHOLD = Math.max(
    0,
    Number(process.env.OPENROUTER_SWITCH_REMAINING_TOKENS || 700)
);
const GROQ_INPUT_SOFT_LIMIT = Math.max(
    1000,
    Number(process.env.GROQ_INPUT_SOFT_LIMIT || 6200)
);
const HANDOFF_ENABLED = String(process.env.OPENROUTER_HANDOFF || "true").toLowerCase() !== "false";
const OPENROUTER_MAX_ATTEMPTS = Math.max(
    1,
    Math.min(
        OPENROUTER_MODELS.length || 1,
        Number(process.env.OPENROUTER_MAX_ATTEMPTS || OPENROUTER_MODELS.length || 1)
    )
);

let groqRemainingTokens = null;
let groqResetAt = null;
let openRouterBusy = false;
let openRouterStartIndex = 0;

function tieneClaveOpenRouter() {
    return Boolean(String(process.env.OPENROUTER_API_KEY || "").trim());
}

function esGroq(url) {
    return String(url || "").startsWith(GROQ_URL);
}

function esProgramacion(messages) {
    if (!Array.isArray(messages)) return false;
    return messages.some((message) =>
        message?.role === "system" &&
        /Eres el programador (principal|profesional) de Roblox Studio y Luau/i.test(String(message.content || ""))
    );
}

function leerJsonBody(options) {
    if (!options || typeof options.body !== "string") return null;
    try {
        return JSON.parse(options.body);
    } catch {
        return null;
    }
}

function estimarTokensEntrada(body) {
    const messages = Array.isArray(body?.messages) ? body.messages : [];
    const texto = messages
        .map((message) => `${message?.role || ""}\n${String(message?.content || "")}`)
        .join("\n");

    return Math.ceil(texto.length / 3.1) + 100;
}

function clonarResponse(text, response) {
    return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
}

function actualizarEstadoGroq(response) {
    const remaining = response.headers.get("x-ratelimit-remaining-tokens");
    const reset = response.headers.get("x-ratelimit-reset-tokens");

    if (remaining != null) {
        const value = Number(remaining);
        if (Number.isFinite(value)) groqRemainingTokens = value;
    }

    if (reset != null) groqResetAt = reset;
}

function groqEstaCercaDelLimite() {
    return (
        groqRemainingTokens != null &&
        groqRemainingTokens <= GROQ_SWITCH_THRESHOLD
    );
}

function crearHandoffMessages(messages, reason) {
    const handoff = [
        "HANDOFF AUTOMÁTICO ENTRE PROVEEDORES.",
        `El proveedor primario Groq/Qwen no puede continuar esta generación (${reason}).`,
        "Continúa la MISMA tarea del usuario con el contexto recibido.",
        "No inventes archivos, objetos, rutas ni SOURCE que no aparezcan en el contexto.",
        "Tu salida será ejecutada por un bridge de Roblox Studio.",
        "No expliques el proceso de handoff.",
        "Para programación responde únicamente con el JSON solicitado por el programador principal: reply y actions.",
        "Genera únicamente las acciones necesarias y conserva la arquitectura existente."
    ].join("\n");

    return [
        ...(Array.isArray(messages) ? messages : []),
        { role: "system", content: handoff }
    ];
}

function prepararBodyOpenRouter(originalBody, reason, model, maxTokens = OPENROUTER_MAX_TOKENS) {
    const body = {
        ...(originalBody || {}),
        model,
        messages: crearHandoffMessages(originalBody?.messages, reason),
        max_tokens: Math.max(512, Math.min(16384, Number(maxTokens) || OPENROUTER_MAX_TOKENS)),
        stream: false
    };

    delete body.max_completion_tokens;
    delete body.reasoning_format;
    delete body.reasoning_effort;

    return body;
}

function obtenerMaxTokensPermitidosDesde402(text) {
    const match = String(text || "").match(/can only afford\s+(\d+)\s+tokens/i);
    if (!match) return null;

    const value = Number(match[1]);
    if (!Number.isFinite(value)) return null;

    return Math.max(512, Math.min(16384, value - 100));
}

function esErrorReintentableOpenRouter(status) {
    return [408, 409, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

function obtenerModelosEnOrden() {
    if (!OPENROUTER_MODELS.length) return [];

    const start = openRouterStartIndex % OPENROUTER_MODELS.length;
    return Array.from(
        { length: Math.min(OPENROUTER_MAX_ATTEMPTS, OPENROUTER_MODELS.length) },
        (_, offset) => OPENROUTER_MODELS[(start + offset) % OPENROUTER_MODELS.length]
    );
}

async function solicitarOpenRouter(originalBody, reason) {
    if (!tieneClaveOpenRouter()) return null;
    if (openRouterBusy) return null;

    openRouterBusy = true;

    try {
        const modelos = obtenerModelosEnOrden();
        let ultimoError = null;

        for (const model of modelos) {
            let maxTokens = OPENROUTER_MAX_TOKENS;

            for (let intento = 1; intento <= 2; intento++) {
                const requestBody = prepararBodyOpenRouter(originalBody, reason, model, maxTokens);

                console.log(
                    `🔀 Handoff → OpenRouter/${model} (${reason}) · max_tokens=${requestBody.max_tokens}`
                );

                const headers = {
                    Authorization: `Bearer ${String(process.env.OPENROUTER_API_KEY).trim()}`,
                    "Content-Type": "application/json",
                    Accept: "application/json"
                };

                const referer = String(process.env.OPENROUTER_SITE_URL || "").trim();
                const title = String(process.env.OPENROUTER_APP_NAME || "Roblox AI Bridge").trim();
                if (referer) headers["HTTP-Referer"] = referer;
                if (title) headers["X-Title"] = title;

                try {
                    const response = await realFetch(OPENROUTER_URL, {
                        method: "POST",
                        headers,
                        body: JSON.stringify(requestBody)
                    });

                    const text = await response.text();

                    if (response.status === 402 && intento === 1) {
                        const affordable = obtenerMaxTokensPermitidosDesde402(text);
                        if (affordable != null && affordable < maxTokens) {
                            console.warn(
                                `⚠️ OpenRouter limita el saldo disponible para ${model}. Reduciendo max_tokens ${maxTokens} → ${affordable}.`
                            );
                            maxTokens = affordable;
                            continue;
                        }
                    }

                    if (!response.ok) {
                        ultimoError = `HTTP ${response.status}`;
                        console.warn(`⚠️ OpenRouter/${model} ${response.status}: ${text.slice(0, 800)}`);
                        break;
                    }

                    let data = null;
                    try {
                        data = JSON.parse(text);
                    } catch {
                        data = null;
                    }

                    const content = data?.choices?.[0]?.message?.content;
                    if (typeof content !== "string" || !content.trim()) {
                        ultimoError = "respuesta vacía";
                        console.warn(`⚠️ OpenRouter/${model} no devolvió contenido ejecutable.`);
                        break;
                    }

                    const resolvedModel = data?.model || model;
                    console.log(`✅ OpenRouter respondió con ${resolvedModel}.`);

                    if (OPENROUTER_MODELS.length > 1) {
                        const successfulIndex = OPENROUTER_MODELS.indexOf(model);
                        if (successfulIndex >= 0) openRouterStartIndex = successfulIndex;
                    }

                    return new Response(text, {
                        status: 200,
                        statusText: "OK",
                        headers: {
                            "Content-Type": "application/json"
                        }
                    });
                } catch (error) {
                    ultimoError = error instanceof Error ? error.message : String(error);
                    console.warn(`⚠️ Error en OpenRouter/${model}:`, ultimoError);
                    break;
                }
            }
        }

        if (ultimoError) {
            console.warn(`❌ Todos los modelos de OpenRouter fallaron. Último error: ${ultimoError}`);
        }

        return null;
    } finally {
        openRouterBusy = false;
    }
}

function esFalloTemporalGroq(status) {
    return [408, 409, 413, 425, 429, 500, 502, 503, 504].includes(Number(status));
}

globalThis.fetch = async function providerAwareFetch(url, options = {}) {
    if (!esGroq(url) || !HANDOFF_ENABLED || !tieneClaveOpenRouter()) {
        return realFetch(url, options);
    }

    const body = leerJsonBody(options);
    const programming = esProgramacion(body?.messages);

    if (programming) {
        const estimatedInputTokens = estimarTokensEntrada(body);

        if (estimatedInputTokens >= GROQ_INPUT_SOFT_LIMIT) {
            const switched = await solicitarOpenRouter(
                body,
                `entrada estimada de ${estimatedInputTokens} tokens supera el umbral de ${GROQ_INPUT_SOFT_LIMIT}`
            );
            if (switched) return switched;
        }

        if (groqEstaCercaDelLimite()) {
            const switched = await solicitarOpenRouter(body, `Groq deja ${groqRemainingTokens} tokens`);
            if (switched) return switched;
        }
    }

    const response = await realFetch(url, options);
    actualizarEstadoGroq(response);

    if (!programming) return response;

    if (esFalloTemporalGroq(response.status)) {
        const switched = await solicitarOpenRouter(body, `Groq HTTP ${response.status}`);
        if (switched) return switched;
        return response;
    }

    const text = await response.text();
    let data = null;

    try {
        data = JSON.parse(text);
    } catch {
        return clonarResponse(text, response);
    }

    const content = data?.choices?.[0]?.message?.content;
    const finishReason = data?.choices?.[0]?.finish_reason;

    if (
        response.ok &&
        (!content || !String(content).trim()) &&
        String(finishReason || "").toLowerCase() === "length"
    ) {
        const switched = await solicitarOpenRouter(body, "Groq terminó por límite de longitud");
        if (switched) return switched;
    }

    return clonarResponse(text, response);
};

console.log(
    `🔀 Provider Router: input>${GROQ_INPUT_SOFT_LIMIT}t / Groq ${GROQ_SWITCH_THRESHOLD}t → OpenRouter [${OPENROUTER_MODELS.join(" → ")}] (${OPENROUTER_MAX_TOKENS}t máx.)`
);
