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

function obtenerClavesOpenRouter() {
    const lista = String(process.env.OPENROUTER_API_KEYS || "")
        .split(",")
        .map((clave) => clave.trim())
        .filter(Boolean);

    const claveIndividual = String(process.env.OPENROUTER_API_KEY || "").trim();

    if (claveIndividual && !lista.includes(claveIndividual)) {
        lista.unshift(claveIndividual);
    }

    return [...new Set(lista)];
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
        texto.includes("overloaded") ||
        texto.includes("in-flight requests")
    );
}

function debeProbarOtraClave(status, mensaje) {
    const texto = String(mensaje || "").toLowerCase();

    return (
        status === 401 ||
        status === 403 ||
        status === 402 ||
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
        texto.includes("overloaded") ||
        texto.includes("in-flight requests")
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
    } catch {
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
                `### ARCHIVO RELEVANTE ${index + 1}`,
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
        "- El SOURCE incluido arriba es código REAL del proyecto actual, obtenido directamente desde Roblox Studio.",
        "- No digas que no tienes acceso al código ni pidas al usuario que lo comparta si aquí se incluye SOURCE.",
        "- No asumas que un único script contiene todo el sistema.",
        "- Analiza las relaciones entre LocalScripts, Scripts y ModuleScripts.",
        "- Conserva las interfaces y dependencias existentes cuando no sea necesario cambiarlas.",
        "- Modifica SOLAMENTE los archivos necesarios para cumplir la petición.",
        "- Devuelve el contenido completo SOLO de los archivos que realmente cambien o se creen.",
        "- No recrees archivos que no necesiten cambios.",
        "- Mantén el código compacto: evita comentarios largos y explicaciones dentro del JSON.",
        "- Si un archivo relevante referencia otro archivo del manifest, considera ese archivo parte de la arquitectura antes de modificar.",
        "- Antes de cambiar código, identifica mentalmente los archivos que componen el sistema solicitado y sus relaciones.",
        "- Nunca modifiques el propio plugin GeminiBridgePlugin salvo que el usuario lo pida explícitamente."
    ].join("\n");
}

function limpiarJsonMarkdown(texto) {
    return String(texto || "")
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}

function esJsonInterpretable(texto) {
    const limpio = limpiarJsonMarkdown(texto);

    try {
        const objeto = JSON.parse(limpio);

        return (
            objeto &&
            typeof objeto === "object" &&
            Array.isArray(objeto.actions) &&
            typeof objeto.reply !== "undefined"
        );
    } catch {
        return false;
    }
}

export async function preguntarDeepSeek(mensajes, opciones = {}) {
    const claves = obtenerClavesOpenRouter();

    if (claves.length === 0) {
        throw new Error(
            "No se encontró ninguna clave. Configura OPENROUTER_API_KEY o OPENROUTER_API_KEYS en el archivo .env"
        );
    }

    const maxTokens = Math.min(
        2800,
        Math.max(256, Number(opciones.maxTokens || 2800))
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
            console.log(
                "📚 DeepSeek recibirá el SOURCE real dentro de la misma instrucción."
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
        stream: false,
        reasoning: {
            max_tokens: 400,
            exclude: true
        },
        response_format: {
            type: "json_object"
        }
    };

    let ultimoError = null;

    for (let indiceClave = 0; indiceClave < claves.length; indiceClave++) {
        const clave = claves[indiceClave];
        const numeroClave = indiceClave + 1;

        const headers = {
            Authorization: `Bearer ${clave}`,
            "Content-Type": "application/json",
            Accept: "application/json",
            "X-Title": "Roblox AI Bridge"
        };

        if (process.env.OPENROUTER_SITE_URL) {
            headers["HTTP-Referer"] = process.env.OPENROUTER_SITE_URL;
        }

        try {
            console.log(
                `\n🔑 DeepSeek usando clave OpenRouter ${numeroClave}/${claves.length}`
            );

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
                ultimoError = new Error(
                    `OpenRouter ${resultado.response.status}: ${mensaje}`
                );

                const probarOtra =
                    indiceClave < claves.length - 1 &&
                    debeProbarOtraClave(resultado.response.status, mensaje);

                if (probarOtra) {
                    console.warn(
                        `⚠️ La clave ${numeroClave} fue rechazada (${resultado.response.status}). Probando la siguiente clave...`
                    );
                    await sleep(750);
                    continue;
                }

                throw ultimoError;
            }

            const texto = extraerTexto(resultado.data);

            if (!esJsonInterpretable(texto)) {
                ultimoError = new Error(
                    "DeepSeek terminó la petición, pero la respuesta no contenía el JSON esperado."
                );

                console.warn(
                    `⚠️ La clave ${numeroClave} recibió una respuesta no interpretable.`
                );

                if (indiceClave < claves.length - 1) {
                    console.warn("↪️ Probando la siguiente clave de OpenRouter...");
                    await sleep(500);
                    continue;
                }

                throw ultimoError;
            }

            console.log(
                `✅ DeepSeek respondió correctamente usando la clave ${numeroClave}/${claves.length}.`
            );

            return texto.trim();
        } catch (error) {
            const mensaje =
                error instanceof Error
                    ? error.message
                    : String(error);

            ultimoError = error instanceof Error
                ? error
                : new Error(String(error));

            const status402 = mensaje.includes("OpenRouter 402");
            const temporal =
                status402 ||
                esReintentable(0, mensaje) ||
                mensaje.toLowerCase().includes("fetch failed") ||
                mensaje.toLowerCase().includes("aborted") ||
                mensaje.toLowerCase().includes("aborterror");

            if (indiceClave < claves.length - 1 && temporal) {
                console.warn(
                    `⚠️ Error con la clave ${numeroClave}/${claves.length}: ${mensaje}`
                );
                console.warn("↪️ Probando la siguiente clave de OpenRouter...");
                await sleep(1000);
                continue;
            }

            throw ultimoError;
        }
    }

    throw ultimoError || new Error("Todas las claves de OpenRouter fallaron.");
}

function extraerTexto(data) {
    const texto =
        data?.choices?.[0]?.message?.content ??
        data?.choices?.[0]?.text ??
        data?.output_text ??
        "";

    if (typeof texto !== "string" || !texto.trim()) {
        const finishReason = data?.choices?.[0]?.finish_reason;
        const usage = data?.usage?.completion_tokens_details;

        if (finishReason === "length") {
            throw new Error(
                "DeepSeek agotó el límite de salida antes de terminar el JSON. " +
                `Razonamiento usado: ${usage?.reasoning_tokens ?? "desconocido"} tokens.`
            );
        }

        throw new Error(
            `OpenRouter no devolvió contenido válido: ${obtenerErrorTexto(data)}`
        );
    }

    return texto.trim();
}

export const DEEPSEEK_MODEL = OPENROUTER_MODEL;
export { OPENROUTER_MODEL };