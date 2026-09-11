const realFetch = globalThis.fetch.bind(globalThis);

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";

const OPENROUTER_MODEL = process.env.OPENROUTER_MODEL || "openai/gpt-5.4-mini";
const OPENROUTER_MAX_TOKENS = Math.min(
    16384,
    Math.max(512, Number(process.env.OPENROUTER_MAX_OUTPUT_TOKENS || 12000))
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

let groqRemainingTokens = null;
let groqResetAt = null;
let openRouterBusy = false;

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

    // Estimación conservadora. No reemplaza el tokenizer real de Groq,
    // pero evita enviar cargas claramente superiores al límite conocido.
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

function prepararBodyOpenRouter(originalBody, reason) {
    const body = {
        ...(originalBody || {}),
        model: OPENROUTER_MODEL,
        messages: crearHandoffMessages(originalBody?.messages, reason),
        max_tokens: OPENROUTER_MAX_TOKENS,
        stream: false
    };

    delete body.max_completion_tokens;
    delete body.reasoning_format;
    delete body.reasoning_effort;

    return body;
}

async function solicitarOpenRouter(originalBody, reason) {
    if (!tieneClaveOpenRouter()) return null;
    if (openRouterBusy) return null;

    openRouterBusy = true;

    try {
        console.log(`🔀 Handoff → OpenRouter/${OPENROUTER_MODEL} (${reason})`);

        const headers = {
            Authorization: `Bearer ${String(process.env.OPENROUTER_API_KEY).trim()}`,
            "Content-Type": "application/json",
            Accept: "application/json"
        };

        const referer = String(process.env.OPENROUTER_SITE_URL || "").trim();
        const title = String(process.env.OPENROUTER_APP_NAME || "Roblox AI Bridge").trim();
        if (referer) headers["HTTP-Referer"] = referer;
        if (title) headers["X-Title"] = title;

        const response = await realFetch(OPENROUTER_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(prepararBodyOpenRouter(originalBody, reason))
        });

        const text = await response.text();

        if (!response.ok) {
            console.warn(`⚠️ OpenRouter ${response.status}: ${text.slice(0, 1000)}`);
            return null;
        }

        let data = null;
        try {
            data = JSON.parse(text);
        } catch {
            data = null;
        }

        const content = data?.choices?.[0]?.message?.content;
        if (typeof content !== "string" || !content.trim()) {
            console.warn("⚠️ OpenRouter no devolvió contenido ejecutable.");
            return null;
        }

        console.log(`✅ OpenRouter respondió con ${data?.model || OPENROUTER_MODEL}.`);
        return new Response(text, {
            status: 200,
            statusText: "OK",
            headers: {
                "Content-Type": "application/json"
            }
        });
    } catch (error) {
        console.warn("⚠️ Error en OpenRouter:", error instanceof Error ? error.message : String(error));
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
    `🔀 Provider Router: Groq ${GROQ_SWITCH_THRESHOLD}t / entrada ${GROQ_INPUT_SOFT_LIMIT}t → OpenRouter ${OPENROUTER_MODEL}`
);
