require("dotenv").config();

const realFetch = globalThis.fetch.bind(globalThis);

const GROQ_URL = "https://api.groq.com/openai/v1/chat/completions";
const OMNIROUTE_URL = String(
    process.env.OMNIROUTE_URL || "http://127.0.0.1:20128/v1/chat/completions"
).trim();
const OMNIROUTE_MODEL = String(process.env.OMNIROUTE_MODEL || "auto").trim() || "auto";
const OMNIROUTE_TIMEOUT_MS = Math.max(5000, Number(process.env.OMNIROUTE_TIMEOUT_MS || 300000));
const OMNIROUTE_ENABLED = String(process.env.OMNIROUTE_ENABLED || "true").toLowerCase() !== "false";
const OMNIROUTE_FALLBACK_TO_GROQ = String(
    process.env.OMNIROUTE_FALLBACK_TO_GROQ || "true"
).toLowerCase() !== "false";
const OMNIROUTE_PROGRESS = String(process.env.OMNIROUTE_PROGRESS || "true").toLowerCase() === "true";

function tieneClaveOmniRoute() {
    return Boolean(String(process.env.OMNIROUTE_API_KEY || "").trim());
}

function esGroq(url) {
    return String(url || "").startsWith(GROQ_URL);
}

function leerJsonBody(options) {
    if (!options || typeof options.body !== "string") return null;
    try {
        return JSON.parse(options.body);
    } catch {
        return null;
    }
}

function prepararBodyOmniRoute(originalBody) {
    const body = {
        ...(originalBody || {}),
        model: OMNIROUTE_MODEL,
        stream: false
    };

    // OmniRoute es compatible con Chat Completions y se encarga del proveedor/modelo.
    delete body.reasoning_format;
    delete body.reasoning_effort;

    return body;
}

function clonarResponse(text, response) {
    return new Response(text, {
        status: response.status,
        statusText: response.statusText,
        headers: response.headers
    });
}

async function solicitarOmniRoute(originalBody) {
    if (!OMNIROUTE_ENABLED || !tieneClaveOmniRoute()) return null;

    const requestBody = prepararBodyOmniRoute(originalBody);
    const headers = {
        Authorization: `Bearer ${String(process.env.OMNIROUTE_API_KEY).trim()}`,
        "Content-Type": "application/json",
        Accept: "application/json"
    };

    if (OMNIROUTE_PROGRESS) {
        headers["X-OmniRoute-Progress"] = "true";
    }

    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), OMNIROUTE_TIMEOUT_MS);

    try {
        console.log(`🔀 OmniRoute → model=${OMNIROUTE_MODEL}`);

        const response = await realFetch(OMNIROUTE_URL, {
            method: "POST",
            headers,
            body: JSON.stringify(requestBody),
            signal: controller.signal
        });

        const text = await response.text();

        if (!response.ok) {
            console.warn(`⚠️ OmniRoute HTTP ${response.status}: ${text.slice(0, 800)}`);
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
            console.warn("⚠️ OmniRoute devolvió una respuesta sin contenido ejecutable.");
            return null;
        }

        console.log(`✅ OmniRoute respondió con ${data?.model || OMNIROUTE_MODEL}.`);

        return new Response(text, {
            status: response.status,
            statusText: response.statusText,
            headers: {
                "Content-Type": response.headers.get("content-type") || "application/json"
            }
        });
    } catch (error) {
        console.warn(
            "⚠️ Error conectando con OmniRoute:",
            error instanceof Error ? error.message : String(error)
        );
        return null;
    } finally {
        clearTimeout(timer);
    }
}

globalThis.fetch = async function providerAwareFetch(url, options = {}) {
    if (!esGroq(url) || !OMNIROUTE_ENABLED || !tieneClaveOmniRoute()) {
        return realFetch(url, options);
    }

    const body = leerJsonBody(options);
    const switched = await solicitarOmniRoute(body);

    if (switched) return switched;

    if (!OMNIROUTE_FALLBACK_TO_GROQ) {
        return new Response(
            JSON.stringify({
                error: {
                    message: "OmniRoute no respondió y el respaldo directo a Groq está desactivado."
                }
            }),
            {
                status: 503,
                headers: { "Content-Type": "application/json" }
            }
        );
    }

    console.warn("↩️ OmniRoute no respondió; usando Groq directo como respaldo.");
    return realFetch(url, options);
};

console.log(
    `🔀 Provider Router: Groq → OmniRoute (${OMNIROUTE_MODEL}) · ${OMNIROUTE_ENABLED ? "activo" : "desactivado"}`
);
