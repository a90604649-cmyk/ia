import "dotenv/config";

const OPENROUTER_URL = "https://openrouter.ai/api/v1/chat/completions";
const OPENROUTER_MODEL =
    process.env.OPENROUTER_MODEL || "deepseek/deepseek-v4-pro-0813";
const PROJECT_CONTEXT_URL =
    `http://127.0.0.1:${process.env.PROJECT_CONTEXT_PORT || 3001}/project-context`;

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

function obtenerUltimoMensajeUsuario(mensajes) {
    if (!Array.isArray(mensajes)) {
        return "";
    }

    for (let i = mensajes.length - 1; i >= 0; i--) {
        const mensaje = mensajes[i];

        if (mensaje?.role !== "user") {
            continue;
        }

        if (typeof mensaje.content === "string") {
            return mensaje.content;
        }

        if (Array.isArray(mensaje.content)) {
            return mensaje.content
                .map((parte) => parte?.text || "")
                .join(" ");
        }
    }

    return "";
}

function esPeticionDeProgramacion(mensajes, opciones) {
    if (opciones?.projectContext === false) {
        return false;
    }

    const sistema = Array.isArray(mensajes)
        ? mensajes.find((mensaje) => mensaje?.role === "system")
        : null;

    const contenidoSistema = String(sistema?.content || "").toLowerCase();

    return (
        contenidoSistema.includes("programador principal") ||
        contenidoSistema.includes("formato obligatorio de respuesta") ||
        contenidoSistema.includes("roblox studio y luau")
    );
}

async function obtenerContextoProyecto(mensajes) {
    const query = obtenerUltimoMensajeUsuario(mensajes).trim();

    if (!query) {
        return null;
    }

    try {
        const url = `${PROJECT_CONTEXT_URL}?query=${encodeURIComponent(query)}`;
        const resultado = await fetchJson(
            url,
            {
                method: "GET",
                headers: {
                    Accept: "application/json"
                }
            },
            15000
        );

        if (!resultado.response.ok || !resultado.data?.ok) {
            console.warn(
                "⚠️ No se pudo obtener contexto del proyecto. DeepSeek continuará sin él."
            );
            return null;
        }

        return resultado.data;
    } catch (error) {
        console.warn(
            "⚠️ Project Context no disponible. DeepSeek continuará sin el escaneo."
        );
        return null;
    }
}

function construirMensajeDeContexto(proyecto) {
    if (!proyecto || !Array.isArray(proyecto.selected)) {
        return null;
    }

    const manifest = Array.isArray(proyecto.manifest)
        ? proyecto.manifest
        : [];

    const selected = proyecto.selected;

    if (selected.length === 0 && manifest.length === 0) {
        return null;
    }

    const manifestTexto = manifest
        .map((script) =>
            `- ${script.className}: ${script.path}/${script.name} (${script.size} chars)`
        )
        .join("\n");

    const fuentes = selected
        .map((script, index) => {
            return [
                `
### ARCHIVO RELEVANTE ${index + 1}`,
                `TIPO: ${script.className}`,
                `RUTA: ${script.path}`,
                `NOMBRE: ${script.name}`,
                `PUNTUACIÓN: ${script.score}`,
                `SEÑALES: ${Array.isArray(script.signals) ? script.signals.join(", ") : ""}`,
                "SOURCE COMPLETO:",
                "----- INICIO SOURCE -----",
                script.source,
                "----- FIN SOURCE -----"
            ].join("\n");
        })
        .join("\n\n");

    return [
        "CONTEXTO REAL DEL PROYECTO ROBLOX:",
        `Se encontraron ${proyecto.totalScripts} scripts en el proyecto.`,
        "",
        "MANIFEST DE TODOS LOS SCRIPTS:",
        manifestTexto || "(sin scripts)",
        "",
        "ARCHIVOS RELEVANTES ANALIZADOS:",
        fuentes || "(no se identificaron archivos relevantes todavía)",
        "",
        "REGLAS PARA USAR ESTE CONTEXTO:",
        "- No asumas que un único script contiene todo el sistema.",
        "- Analiza las relaciones entre LocalScripts, Scripts y ModuleScripts.",
        "- Conserva las interfaces y dependencias existentes cuando no sea necesario cambiarlas.",
        "- Si el cambio requiere modificar varios archivos del contexto, devuelve TODOS los archivos necesarios.",
        "- Si un archivo relevante referencia otro archivo del manifest, considera ese archivo parte de la arquitectura antes de modificar.",
        "- Nunca modifiques el propio plugin GeminiBridgePlugin salvo que el usuario lo pida explícitamente."
    ].join("\n");
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
        10000,
        Math.max(256, Number(opciones.maxTokens || 8192))
    );

    const mensajesFinales = Array.isArray(mensajes)
        ? mensajes.map((mensaje) => ({ ...mensaje }))
        : [];

    if (esPeticionDeProgramacion(mensajesFinales, opciones)) {
        const proyecto = await obtenerContextoProyecto(mensajesFinales);
        const contexto = construirMensajeDeContexto(proyecto);

        if (contexto) {
            mensajesFinales.push({
                role: "user",
                content: contexto
            });

            console.log(
                `🔎 Contexto del proyecto enviado a DeepSeek: ${proyecto.selected.length} archivos relevantes de ${proyecto.totalScripts} scripts.`
            );
        } else {
            console.log(
                "🔎 No se recibió contexto del proyecto; DeepSeek programará con la petición disponible."
            );
        }
    }

    const body = {
        model: opciones.model || OPENROUTER_MODEL,
        messages: mensajesFinales,
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