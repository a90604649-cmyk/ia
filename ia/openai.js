import "dotenv/config";

const OPENAI_URL = "https://api.openai.com/v1/responses";
const OPENAI_MODEL = process.env.OPENAI_MODEL || "gpt-6-astra";
const PROJECT_CONTEXT_URL =
    `http://127.0.0.1:${process.env.PROJECT_CONTEXT_PORT || 3001}/project-context`;

function sleep(ms) {
    return new Promise(function(resolve) {
        setTimeout(resolve, ms);
    });
}

function obtenerErrorTexto(data) {
    if (!data) {
        return "Error desconocido de OpenAI.";
    }

    if (typeof data === "string") {
        return data;
    }

    if (data.error?.message) {
        return String(data.error.message);
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

function esPeticionDeProgramacion(mensajes) {
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
                "⚠️ No se pudo obtener contexto del proyecto. GPT-6 Astra continuará sin él."
            );
            return null;
        }

        return resultado.data;
    } catch {
        console.warn(
            "⚠️ Project Context no disponible. GPT-6 Astra continuará sin el escaneo."
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

function extraerTexto(data) {
    if (typeof data?.output_text === "string" && data.output_text.trim()) {
        return data.output_text.trim();
    }

    const partes = [];

    for (const item of data?.output || []) {
        if (item?.type !== "message" || !Array.isArray(item.content)) {
            continue;
        }

        for (const contenido of item.content) {
            if (typeof contenido?.text === "string") {
                partes.push(contenido.text);
            }
        }
    }

    const texto = partes.join("\n").trim();

    if (!texto) {
        const razon = data?.incomplete_details?.reason;
        throw new Error(
            razon
                ? `OpenAI no terminó la respuesta. Razón: ${razon}.`
                : "OpenAI no devolvió contenido válido."
        );
    }

    return texto;
}

export async function preguntarGPT6Astra(mensajes, opciones = {}) {
    const apiKey = process.env.OPENAI_API_KEY;

    if (!apiKey) {
        throw new Error(
            "No se encontró OPENAI_API_KEY en el archivo .env"
        );
    }

    const maxReintentos = Number(opciones.maxReintentos || 3);
    const maxOutputTokens = Math.min(
        16384,
        Math.max(256, Number(opciones.maxOutputTokens || 16384))
    );

    const input = Array.isArray(mensajes)
        ? mensajes
            .filter((mensaje) => mensaje?.role !== "system")
            .map((mensaje) => ({
                role: mensaje.role === "assistant" ? "assistant" : "user",
                content: typeof mensaje.content === "string"
                    ? mensaje.content
                    : JSON.stringify(mensaje.content || "")
            }))
        : [];

    if (esPeticionDeProgramacion(mensajes)) {
        const proyecto = await obtenerContextoProyecto(mensajes);
        const contexto = construirMensajeDeContexto(proyecto);

        if (contexto) {
            input.push({
                role: "user",
                content: contexto
            });

            console.log(
                `🔎 Contexto del proyecto enviado a GPT-6 Astra: ${proyecto.selected.length} archivos relevantes de ${proyecto.totalScripts} scripts.`
            );
        } else {
            console.log(
                "🔎 No se recibió contexto del proyecto; GPT-6 Astra programará con la petición disponible."
            );
        }
    }

    const body = {
        model: opciones.model || OPENAI_MODEL,
        instructions: mensajes?.find((mensaje) => mensaje?.role === "system")?.content || "",
        input,
        reasoning: {
            effort: opciones.reasoningEffort || "high"
        },
        max_output_tokens: maxOutputTokens,
        text: {
            format: {
                type: "json_schema",
                name: "roblox_programming_response",
                strict: true,
                schema: {
                    type: "object",
                    properties: {
                        reply: {
                            type: "string"
                        },
                        actions: {
                            type: "array",
                            items: {
                                type: "object",
                                properties: {
                                    type: {
                                        type: "string",
                                        enum: [
                                            "create_script",
                                            "create_local_script",
                                            "create_module_script"
                                        ]
                                    },
                                    path: {
                                        type: "string"
                                    },
                                    name: {
                                        type: "string"
                                    },
                                    code: {
                                        type: "string"
                                    }
                                },
                                required: ["type", "path", "name", "code"],
                                additionalProperties: false
                            }
                        }
                    },
                    required: ["reply", "actions"],
                    additionalProperties: false
                }
            }
        }
    };

    const headers = {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
        Accept: "application/json"
    };

    for (let intento = 1; intento <= maxReintentos; intento++) {
        try {
            const resultado = await fetchJson(
                OPENAI_URL,
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
                        `⚠️ OpenAI ${resultado.response.status}. Reintentando en ${espera / 1000}s...`
                    );

                    await sleep(espera);
                    continue;
                }

                throw new Error(
                    `OpenAI ${resultado.response.status}: ${mensaje}`
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
                    `⚠️ Error temporal de OpenAI. Reintentando en ${espera / 1000}s...`
                );

                await sleep(espera);
                continue;
            }

            throw error;
        }
    }

    throw new Error("OpenAI agotó todos los reintentos.");
}

export const GPT6_ASTRA_MODEL = OPENAI_MODEL;
