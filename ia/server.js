import "dotenv/config";
import express from "express";
import readline from "readline/promises";
import { GoogleGenAI } from "@google/genai";
import { procesarAnimacion } from "./animation.js";
import { preguntarDeepSeek, DEEPSEEK_MODEL } from "./deepseek.js";

const app = express();
app.use(express.json({ limit: "2mb" }));

const PORT = Number(process.env.PORT || 3000);
const CHAT_MODEL = process.env.GEMINI_CHAT_MODEL || "gemini-3.6-flash";
const GEMINI_API_KEY = process.env.GEMINI_API_KEY;

if (!GEMINI_API_KEY) {
    console.error("❌ No se encontró GEMINI_API_KEY en el archivo .env");
    process.exit(1);
}

const ai = new GoogleGenAI({
    apiKey: GEMINI_API_KEY
});

let pendingActions = [];
let r6Calibration = null;
const historial = [];
let contextoScriptSeleccionado = null;

const CHAT_SYSTEM =
    "Eres un asistente experto en Roblox Studio y Luau.\n\n" +
    "Puedes conversar normalmente con el usuario.\n\n" +
    "Cuando el usuario pregunte algo que no requiere cambios de código, responde de forma clara y útil.\n\n" +
    "Cuando el usuario quiera programar, crear, corregir o modificar Roblox, otra IA llamada DeepSeek V4 Pro será el programador.\n" +
    "No intentes sustituir al programador en esa tarea.\n";

const PROGRAMMER_SYSTEM =
    "Eres el programador principal de Roblox Studio y Luau.\n\n" +
    "Tu trabajo es producir cambios de código completos, coherentes y listos para aplicar en Roblox Studio.\n\n" +
    "Debes analizar la petición antes de escribir código.\n" +
    "Respeta la arquitectura cliente-servidor de Roblox.\n" +
    "Usa Script, LocalScript y ModuleScript correctamente.\n" +
    "Usa APIs actuales de Roblox y evita APIs obsoletas cuando exista una alternativa actual.\n" +
    "No uses pseudocódigo.\n" +
    "No inventes servicios, clases, propiedades, eventos ni métodos que no existan.\n\n" +
    "CUANDO MODIFIQUES UN SISTEMA EXISTENTE:\n" +
    "- Devuelve el archivo completo afectado, no un parche parcial.\n" +
    "- Conserva la funcionalidad existente que el usuario no pidió cambiar.\n" +
    "- Si un cambio requiere varios archivos, devuelve TODOS los archivos necesarios.\n" +
    "- Usa la misma RUTA y NOMBRE del archivo para que el bridge pueda reemplazarlo.\n" +
    "- Si necesitas crear una carpeta, puedes representarla dentro de RUTA.\n\n" +
    "UBICACIONES VALIDAS:\n" +
    "ServerScriptService\n" +
    "ReplicatedStorage\n" +
    "StarterPlayer/StarterPlayerScripts\n" +
    "StarterPlayer/StarterCharacterScripts\n" +
    "StarterGui\n" +
    "Workspace\n" +
    "ServerStorage\n" +
    "StarterPack\n\n" +
    "REGLAS DE ROBLOX:\n" +
    "- La lógica de servidor va en Script o ModuleScript del servidor.\n" +
    "- La lógica de cliente va en LocalScript o módulos accesibles por el cliente.\n" +
    "- Usa RemoteEvent/RemoteFunction para comunicación cliente-servidor cuando corresponda.\n" +
    "- Valida en el servidor cualquier acción importante iniciada por el cliente.\n" +
    "- No pongas secretos ni claves de API dentro de Luau.\n\n" +
    "FORMATO OBLIGATORIO DE RESPUESTA:\n" +
    "Devuelve UN SOLO objeto JSON válido. No escribas texto fuera del JSON. No uses markdown ni bloques ``` .\n\n" +
    "Estructura exacta:\n" +
    "{\n" +
    "  \"reply\": \"explicación breve\",\n" +
    "  \"actions\": [\n" +
    "    {\n" +
    "      \"type\": \"create_script\",\n" +
    "      \"path\": \"ServerScriptService\",\n" +
    "      \"name\": \"Nombre\",\n" +
    "      \"code\": \"codigo Luau completo\"\n" +
    "    }\n" +
    "  ]\n" +
    "}\n\n" +
    "TIPOS PERMITIDOS:\n" +
    "create_script\n" +
    "create_local_script\n" +
    "create_module_script\n\n" +
    "IMPORTANTE:\n" +
    "- El valor de code debe ser una cadena JSON válida con el código Luau completo.\n" +
    "- Si no hace falta cambiar código, actions debe ser [].\n" +
    "- No devuelvas archivos que no sean necesarios.\n" +
    "- No ocultes errores. Si la petición es imposible con la información disponible, explica exactamente qué falta en reply y usa actions=[].\n";

const ROUTER_SYSTEM =
    "Eres el analista de una IA de programación para Roblox Studio y Luau.\n\n" +
    "El usuario habla contigo en español. Tu función es convertir su petición en un brief técnico muy claro para DeepSeek V4 Pro, que será quien escribirá el código.\n\n" +
    "Debes determinar qué quiere lograr realmente el usuario, qué comportamiento espera, qué partes de Roblox están implicadas, si es una modificación o un sistema nuevo y qué restricciones ya existen.\n\n" +
    "No escribas el código final. No uses markdown. No inventes información que el usuario no haya dado. Si falta un dato, dilo como incertidumbre y deja que el programador tome una decisión razonable.\n\n" +
    "Incluye:\n" +
    "- objetivo exacto\n" +
    "- comportamiento esperado\n" +
    "- contexto relevante de la conversación\n" +
    "- restricciones y nombres/rutas conocidas\n" +
    "- riesgos o errores que el programador debería evitar\n" +
    "- criterio de terminado\n";

function esTareaDeAnimacion(mensaje) {
    const patrones = [
        "animacion",
        "animación",
        "animaciones",
        "animar",
        "anima",
        "keyframe",
        "keyframes",
        "pose",
        "poses",
        "r6",
        "movimiento"
    ];

    const texto = mensaje.toLowerCase();
    return patrones.some(function(palabra) {
        return texto.includes(palabra);
    });
}

function esTareaDeCodigo(mensaje) {
    const patrones = [
        "codigo",
        "código",
        "script",
        "scripts",
        "luau",
        "lua",
        "roblox",
        "studio",
        "crea",
        "crear",
        "haz",
        "hacer",
        "programa",
        "programar",
        "sistema",
        "funcion",
        "función",
        "corrige",
        "corregir",
        "modifica",
        "modificar",
        "arregla",
        "arreglar",
        "error",
        "bug",
        "localscript",
        "local script",
        "modulescript",
        "module script",
        "remoteevent",
        "remotefunction",
        "gui",
        "tool",
        "remote"
    ];

    const texto = mensaje.toLowerCase();
    return patrones.some(function(palabra) {
        return texto.includes(palabra);
    });
}

function agregarHistorial(role, text) {
    if (!text) {
        return;
    }

    historial.push({
        role,
        parts: [
            {
                text: String(text)
            }
        ]
    });

    if (historial.length > 30) {
        historial.splice(0, historial.length - 30);
    }
}

function obtenerTextoMensaje(mensaje) {
    return mensaje?.parts
        ?.map(function(parte) {
            return parte?.text || "";
        })
        .join(" ") || "";
}

function crearContextoReciente(limite = 8) {
    return historial
        .slice(-limite)
        .map(function(mensaje) {
            const rol = mensaje.role === "user" ? "Usuario" : "Asistente";
            const texto = obtenerTextoMensaje(mensaje);
            return `${rol}: ${texto}`;
        })
        .join("\n");
}

async function hablarConGemini(mensajeUsuario) {
    agregarHistorial("user", mensajeUsuario);

    for (let intento = 1; intento <= 2; intento++) {
        try {
            console.log(`\n⏳ Gemini respondiendo... intento ${intento}/3`);

            const response = await ai.models.generateContent({
                model: CHAT_MODEL,
                contents: historial,
                config: {
                    systemInstruction: CHAT_SYSTEM,
                    thinkingConfig: {
                        thinkingLevel: "low"
                    },
                    maxOutputTokens: 4096
                }
            });

            const texto = response.text;

            if (!texto) {
                throw new Error("Gemini no devolvió texto.");
            }

            agregarHistorial("model", texto);
            console.log(`\n${texto}`);
            return texto;
        } catch (error) {
            const mensajeError = error instanceof Error
                ? error.message
                : String(error);

            console.error("\n❌ Error de Gemini:");
            console.error(mensajeError);

            const temporal =
                mensajeError.includes("429") ||
                mensajeError.includes("500") ||
                mensajeError.includes("502") ||
                mensajeError.includes("503") ||
                mensajeError.includes("504") ||
                mensajeError.includes("UNAVAILABLE") ||
                mensajeError.includes("RESOURCE_EXHAUSTED");

            if (!temporal || intento === 3) {
                return null;
            }

            const espera = intento * 2000;
            await new Promise(function(resolve) {
                setTimeout(resolve, espera);
            });
        }
    }

    return null;
}

async function prepararTareaConGemini(mensajeUsuario) {
    agregarHistorial("user", mensajeUsuario);

    const contexto = crearContextoReciente(10);
    const entrada =
        "CONTEXTO DE CONVERSACIÓN:\n" +
        contexto +
        "\n\nPETICIÓN EXACTA DEL USUARIO:\n" +
        mensajeUsuario;

    try {
        const response = await ai.models.generateContent({
            model: CHAT_MODEL,
            contents: [
                {
                    role: "user",
                    parts: [
                        {
                            text: entrada
                        }
                    ]
                }
            ],
            config: {
                systemInstruction: ROUTER_SYSTEM,
                thinkingConfig: {
                    thinkingLevel: "medium"
                },
                maxOutputTokens: 4096
            }
        });

        const brief = response.text?.trim();

        if (!brief) {
            throw new Error("Gemini no generó el brief técnico.");
        }

        agregarHistorial("model", `Brief técnico enviado al programador:\n${brief}`);

        console.log("\n🧠 Gemini preparó la tarea.");

        return brief;
    } catch (error) {
        const mensajeError = error instanceof Error
            ? error.message
            : String(error);

        console.warn("⚠️ Gemini no pudo preparar el brief:", mensajeError);
        console.warn("↪️ DeepSeek recibirá directamente la petición del usuario.");
        return mensajeUsuario;
    }
}

function limpiarJsonMarkdown(texto) {
    return String(texto || "")
        .trim()
        .replace(/^```json\s*/i, "")
        .replace(/^```\s*/i, "")
        .replace(/\s*```$/i, "")
        .trim();
}

function parsearObjetoJson(texto) {
    const limpio = limpiarJsonMarkdown(texto);

    try {
        return JSON.parse(limpio);
    } catch {
        // Continúa con extracción tolerante.
    }

    const primerInicio = limpio.indexOf("{");
    const ultimoFin = limpio.lastIndexOf("}");

    if (primerInicio === -1 || ultimoFin <= primerInicio) {
        return null;
    }

    try {
        return JSON.parse(
            limpio.substring(primerInicio, ultimoFin + 1)
        );
    } catch {
        return null;
    }
}

function normalizarAccion(action) {
    if (!action || typeof action !== "object") {
        return null;
    }

    let type = String(action.type || "").trim();

    if (type === "Script") {
        type = "create_script";
    }

    if (type === "LocalScript") {
        type = "create_local_script";
    }

    if (type === "ModuleScript") {
        type = "create_module_script";
    }

    const tiposPermitidos = new Set([
        "create_script",
        "create_local_script",
        "create_module_script"
    ]);

    if (!tiposPermitidos.has(type)) {
        return null;
    }

    const name = String(action.name || "").trim();
    const path = String(action.path || "").trim();
    const code = String(action.code || "").trim();

    const rutasPermitidas = [
        "ServerScriptService",
        "ReplicatedStorage",
        "StarterPlayer/StarterPlayerScripts",
        "StarterPlayer/StarterCharacterScripts",
        "StarterGui",
        "Workspace",
        "ServerStorage",
        "StarterPack"
    ];

    const rutaValida = rutasPermitidas.some(function(base) {
        return path === base || path.startsWith(`${base}/`);
    });

    if (!name || !code || !rutaValida || path.includes("..")) {
        return null;
    }

    if (name.includes("/") || name.includes("\\")) {
        return null;
    }

    return {
        type,
        name,
        path,
        code
    };
}

function extraerAccionesDesdeObjeto(objeto) {
    if (!objeto || typeof objeto !== "object") {
        return null;
    }

    if (!Array.isArray(objeto.actions)) {
        return null;
    }

    const actions = [];

    for (const action of objeto.actions) {
        const normalizada = normalizarAccion(action);

        if (normalizada) {
            actions.push(normalizada);
        } else if (action && Object.keys(action).length > 0) {
            console.warn("⚠️ Acción rechazada durante validación:", action.name || "sin nombre");
        }
    }

    const unicas = new Map();

    for (const action of actions) {
        unicas.set(`${action.path}/${action.name}`, action);
    }

    return {
        reply: String(objeto.reply || "Sistema procesado por DeepSeek.").trim(),
        actions: Array.from(unicas.values())
    };
}

function extraerFormatoLegacy(texto) {
    const normalizado = String(texto || "")
        .replace(/\r\n/g, "\n")
        .replace(/\r/g, "\n");

    const respuestaInicio = normalizado.indexOf("RESPUESTA:");
    const archivosInicio = normalizado.indexOf("ARCHIVOS_START");
    const archivosFin = normalizado.lastIndexOf("ARCHIVOS_END");

    if (
        respuestaInicio === -1 ||
        archivosInicio === -1 ||
        archivosFin === -1 ||
        archivosFin <= archivosInicio
    ) {
        return null;
    }

    const respuesta = normalizado
        .substring(
            respuestaInicio + "RESPUESTA:".length,
            archivosInicio
        )
        .trim();

    const contenidoArchivos = normalizado
        .substring(
            archivosInicio + "ARCHIVOS_START".length,
            archivosFin
        )
        .trim();

    const bloques = contenidoArchivos
        .split("ARCHIVO_START")
        .slice(1);

    const actions = [];

    for (const bloqueCompleto of bloques) {
        const posicionFin = bloqueCompleto.indexOf("ARCHIVO_END");

        if (posicionFin === -1) {
            continue;
        }

        const bloque = bloqueCompleto
            .substring(0, posicionFin)
            .trim();

        function valorLinea(etiqueta) {
            const indice = bloque.indexOf(`${etiqueta}:`);

            if (indice === -1) {
                return "";
            }

            const inicio = indice + etiqueta.length + 1;
            const fin = etiqueta === "NOMBRE"
                ? bloque.indexOf("CODIGO_START", inicio)
                : etiqueta === "RUTA"
                    ? bloque.indexOf("NOMBRE:", inicio)
                    : bloque.indexOf("RUTA:", inicio);

            return bloque
                .substring(inicio, fin === -1 ? bloque.length : fin)
                .trim();
        }

        const tipo = valorLinea("TIPO");
        const path = valorLinea("RUTA");
        const name = valorLinea("NOMBRE");
        const codigoInicio = bloque.indexOf("CODIGO_START");
        const codigoFin = bloque.lastIndexOf("CODIGO_END");

        if (codigoInicio === -1 || codigoFin <= codigoInicio) {
            continue;
        }

        const code = bloque
            .substring(codigoInicio + "CODIGO_START".length, codigoFin)
            .trim();

        const action = normalizarAccion({
            type,
            path,
            name,
            code
        });

        if (action) {
            actions.push(action);
        }
    }

    if (actions.length === 0) {
        return null;
    }

    return {
        reply: respuesta || "Sistema generado por DeepSeek.",
        actions
    };
}

function interpretarRespuestaDeepSeek(texto) {
    const objeto = parsearObjetoJson(texto);
    const resultadoJson = extraerAccionesDesdeObjeto(objeto);

    if (resultadoJson) {
        return resultadoJson;
    }

    return extraerFormatoLegacy(texto);
}


function formatearRespuestaFinal(reply) {
    const texto = String(reply || "")
        .replace(/\r/g, "")
        .trim();

    if (!texto) {
        return "La solicitud fue procesada correctamente.";
    }

    let lineas = texto
        .split("\n")
        .map((linea) => linea.trim())
        .filter(Boolean);

    if (lineas.length >= 3) {
        return lineas.slice(0, 4).join("\n");
    }

    const frases = texto
        .split(/(?<=[.!?])\s+/)
        .map((frase) => frase.trim())
        .filter(Boolean);

    if (frases.length >= 3) {
        return frases.slice(0, 4).join("\n");
    }

    return lineas.join("\n");
}


function respuestaFinalBreve(texto) {
    const limpio = String(texto || "")
        .replace(/\r/g, " ")
        .replace(/\n+/g, " ")
        .replace(/\s+/g, " ")
        .trim();

    if (!limpio) {
        return "La solicitud fue procesada correctamente.";
    }

    const frases =
        limpio.match(/[^.!?]+[.!?]+/g)
        ?.map((frase) => frase.trim())
        .filter(Boolean) || [limpio];

    return frases.slice(0, 4).join("\n");
}

async function programarConDeepSeek(mensajeUsuario) {
    const brief = await prepararTareaConGemini(mensajeUsuario);
    const contexto = crearContextoReciente(8);

    let contextoScript = "";

    if (contextoScriptSeleccionado) {
        contextoScript =
            "\n\nSCRIPT ACTUAL SELECCIONADO EN ROBLOX STUDIO:\n" +
            `TIPO: ${contextoScriptSeleccionado.className}\n` +
            `RUTA: ${contextoScriptSeleccionado.path}\n` +
            `NOMBRE: ${contextoScriptSeleccionado.name}\n` +
            "SOURCE ACTUAL:\n" +
            "----- INICIO SOURCE -----\n" +
            contextoScriptSeleccionado.source +
            "\n----- FIN SOURCE -----\n\n" +
            "IMPORTANTE: Este es el código REAL del script seleccionado. " +
            "Si el usuario pide modificarlo, trabaja sobre este código existente. " +
            "Conserva la funcionalidad que no se pidió cambiar y devuelve el archivo completo. " +
            `Usa exactamente el mismo tipo, ruta y nombre: ${contextoScriptSeleccionado.className}, ` +
            `${contextoScriptSeleccionado.path}/${contextoScriptSeleccionado.name}.\n`;
    }

    let instruccion =
        "PETICIÓN ORIGINAL DEL USUARIO:\n" +
        mensajeUsuario +
        "\n\n" +
        "BRIEF PREPARADO POR GEMINI:\n" +
        brief +
        "\n\n" +
        "CONTEXTO RECIENTE ADICIONAL:\n" +
        contexto +
        contextoScript +
        "\n\n" +
        "Ahora implementa la solución. Respeta exactamente el formato JSON solicitado. Si modificas un archivo existente, devuelve su contenido completo.\n";

    for (let intento = 1; intento <= 3; intento++) {
        try {
            console.log(`\n🤖 DeepSeek programando... intento ${intento}/3`);

            const texto = await preguntarDeepSeek([
                {
                    role: "system",
                    content: PROGRAMMER_SYSTEM
                },
                {
                    role: "user",
                    content: instruccion
                }
            ], {
                reasoningEffort: process.env.DEEPSEEK_REASONING || "high",
                maxTokens: 8000,
                temperature: 0.2,
                maxReintentos: 2
            });


            const resultado = interpretarRespuestaDeepSeek(texto);

            if (!resultado) {
                console.warn("⚠️ DeepSeek no devolvió un resultado interpretable.");

                instruccion =
                    "La respuesta anterior no pudo ser interpretada.\n" +
                    "Devuelve ÚNICAMENTE un objeto JSON válido con las propiedades reply y actions.\n" +
                    "No uses markdown. Cada action debe tener type, path, name y code.\n\n" +
                    "PETICIÓN ORIGINAL:\n" +
                    mensajeUsuario +
                    "\n\nBRIEF:\n" +
                    brief;

                continue;
            }

            pendingActions = resultado.actions;

            agregarHistorial(
                "model",
                resultado.reply || "Sistema programado con DeepSeek."
            );

            console.log("\n✅ DeepSeek terminó.");
            console.log(`📦 ${pendingActions.length} cambios preparados para Roblox Studio.`);


            return resultado;
        } catch (error) {
            const mensajeError = error instanceof Error
                ? error.message
                : String(error);

            console.error("\n❌ Error de DeepSeek:");
            console.error(mensajeError);

            if (mensajeError.includes("OpenRouter 402")) {
                console.error("💳 Crédito insuficiente para esta petición. No se reintentará.");
                return null;
            }

            if (intento === 2) {
                return null;
            }

            await new Promise(function(resolve) {
                setTimeout(resolve, intento * 2000);
            });
        }
    }

    return null;
}

async function preguntar(mensajeUsuario) {
    const texto = mensajeUsuario.trim();

    if (!texto) {
        return;
    }

    if (esTareaDeAnimacion(texto)) {
        try {
            console.log("\n🎞️ Enviando tarea a animation.js...");

            const resultado = await procesarAnimacion(
                texto,
                ai,
                historial,
                r6Calibration
            );

            if (!resultado) {
                console.error("❌ animation.js no devolvió ningún resultado.");
                return;
            }

            if (resultado.reply) {
                console.log(`\n${resultado.reply}`);
            }

            if (
                Array.isArray(resultado.actions) &&
                resultado.actions.length > 0
            ) {
                pendingActions = resultado.actions;

                console.log(
                    `\n[ACCIONES DE ANIMACIÓN PARA ROBLOX]\nAcciones preparadas: ${pendingActions.length}`
                );
            }

            agregarHistorial(
                "user",
                texto
            );

            agregarHistorial(
                "model",
                resultado.reply || "Animación generada correctamente."
            );
        } catch (error) {
            const mensajeError = error instanceof Error
                ? error.message
                : String(error);

            console.error("❌ Error en animation.js:", mensajeError);
        }

        return;
    }

    if (esTareaDeCodigo(texto)) {
        await programarConDeepSeek(texto);
        return;
    }

    await hablarConGemini(texto);
}

app.get("/", function(_req, res) {
    res.json({
        ok: true,
        service: "Roblox AI Bridge",
        chatModel: CHAT_MODEL,
        programmerModel: DEEPSEEK_MODEL,
        animationSystem: "Gemini animation pipeline",
        pendingActions: pendingActions.length
    });
});

app.get("/health", function(_req, res) {
    res.json({
        ok: true,
        geminiConfigured: Boolean(GEMINI_API_KEY),
        openrouterConfigured: Boolean(process.env.OPENROUTER_API_KEY),
                chatModel: CHAT_MODEL,
        programmerModel: DEEPSEEK_MODEL,
        r6Calibrated: Boolean(r6Calibration),
        pendingActions: pendingActions.length
    });
});

app.post("/r6-calibration", function(req, res) {
    try {
        if (!req.body || typeof req.body !== "object") {
            return res.status(400).json({
                ok: false,
                error: "Calibración inválida."
            });
        }

        if (req.body.rig !== "R6") {
            return res.status(400).json({
                ok: false,
                error: "La calibración no corresponde a R6."
            });
        }

        if (!req.body.rigName) {
            return res.status(400).json({
                ok: false,
                error: "Falta el nombre del rig."
            });
        }

        if (
            !req.body.joints ||
            typeof req.body.joints !== "object"
        ) {
            return res.status(400).json({
                ok: false,
                error: "No se recibieron los joints calibrados."
            });
        }

        r6Calibration = req.body;

        console.log("\n🧭 CALIBRACIÓN R6 RECIBIDA");
        console.log("🎯 Rig:", r6Calibration.rigName);
        console.log(
            "🦴 Joints:",
            Object.keys(r6Calibration.joints).length
        );
        console.log(
            "➡️ Frente:",
            JSON.stringify(r6Calibration.forwardWorld)
        );
        console.log(
            "↔️ Derecha:",
            JSON.stringify(r6Calibration.rightWorld)
        );
        console.log(
            "⬆️ Arriba:",
            JSON.stringify(r6Calibration.upWorld)
        );

        return res.json({
            ok: true,
            message: "Calibración R6 recibida correctamente."
        });
    } catch (error) {
        console.error("❌ Error procesando calibración R6:", error);

        return res.status(500).json({
            ok: false,
            error: "Error interno procesando la calibración."
        });
    }
});

app.get("/r6-calibration", function(_req, res) {
    if (!r6Calibration) {
        return res.json({
            calibrated: false,
            calibration: null
        });
    }

    return res.json({
        calibrated: true,
        calibration: r6Calibration
    });
});

app.post("/selected-script", function(req, res) {
    try {
        const body = req.body;

        if (!body || body.selected !== true) {
            contextoScriptSeleccionado = null;

            return res.json({
                ok: true,
                message: "Contexto de script limpiado."
            });
        }

        const tiposPermitidos = new Set([
            "Script",
            "LocalScript",
            "ModuleScript"
        ]);

        if (
            !tiposPermitidos.has(body.className) ||
            typeof body.name !== "string" ||
            typeof body.path !== "string" ||
            typeof body.source !== "string"
        ) {
            return res.status(400).json({
                ok: false,
                error: "Datos del script seleccionado inválidos."
            });
        }

        contextoScriptSeleccionado = {
            className: body.className,
            name: body.name.trim(),
            path: body.path.trim(),
            source: body.source
        };

        console.log(
            "📄 Script seleccionado:",
            `${contextoScriptSeleccionado.path}/${contextoScriptSeleccionado.name}`
        );

        console.log(
            "📦 Source recibido:",
            `${contextoScriptSeleccionado.source.length} caracteres`
        );

        return res.json({
            ok: true,
            message: "Script seleccionado recibido correctamente."
        });
    } catch (error) {
        console.error(
            "❌ Error recibiendo script seleccionado:",
            error
        );

        return res.status(500).json({
            ok: false,
            error: "Error interno recibiendo el script."
        });
    }
});

app.get("/next", function(_req, res) {
    const acciones = pendingActions;
    pendingActions = [];

    return res.json({
        actions: acciones
    });
});

app.listen(PORT, function() {
    console.log("=================================");
    console.log("🤖 GEMINI + DEEPSEEK ROBLOX BRIDGE");
    console.log("=================================");
    console.log(`Servidor: http://127.0.0.1:${PORT}`);
    console.log(`Chat: ${CHAT_MODEL}`);
    console.log(`Programador: ${DEEPSEEK_MODEL}`);
    console.log("Animaciones: pipeline Gemini existente");
    console.log("Calibración: R6 automática");
    console.log("=================================\n");
});

const rl = readline.createInterface({
    input: process.stdin,
    output: process.stdout
});

console.log("Escribe algo para hablar con el asistente.");
console.log("Las tareas de programación pasan por Gemini → OpenRouter → DeepSeek.");
console.log("Las tareas de animación usan el pipeline R6 existente.");
console.log("Escribe 'salir' para cerrar.\n");

while (true) {
    const mensaje = await rl.question("Tú: ");

    if (!mensaje.trim()) {
        continue;
    }

    if (mensaje.toLowerCase().trim() === "salir") {
        console.log("Cerrando...");
        break;
    }

    await preguntar(mensaje);
}

rl.close();
process.exit(0);
