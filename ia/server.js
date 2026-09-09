import "dotenv/config";
import express from "express";
import readline from "readline/promises";
import { GoogleGenAI } from "@google/genai";
import { procesarAnimacion } from "./animation.js";

const app = express();
app.use(express.json());

const PORT = 3000;

const CHAT_MODEL = "gemini-3.6-flash";
const ANTIGRAVITY_AGENT = "antigravity-preview-05-2026";

const API_KEY = process.env.GEMINI_API_KEY;

if (!API_KEY) {
console.error("❌ No se encontró GEMINI_API_KEY en el archivo .env");
process.exit(1);
}

const ai = new GoogleGenAI({
apiKey: API_KEY
});

let pendingActions = [];

let r6Calibration = null;

const historial = [];

let antigravityInteractionId = null;
let antigravityEnvironmentId = null;

const CHAT_SYSTEM =
"Eres un asistente experto en Roblox Studio y Luau.\n\n" +
"Puedes conversar normalmente con el usuario.\n\n" +
"Cuando el usuario haga una pregunta normal, responde normalmente.\n\n" +
"Cuando el usuario pida programar, crear, corregir o modificar algo de Roblox, la tarea será enviada a Antigravity, que es el programador.\n";

const ANTIGRAVITY_SYSTEM =
"Eres el programador principal de Roblox Studio y Luau.\n\n" +

"Tu trabajo es crear sistemas completos para Roblox Studio.\n\n" +

"No debes limitarte a un solo Script.\n" +
"Si el sistema necesita varios Scripts, LocalScripts o ModuleScripts, debes crear TODOS los archivos necesarios.\n\n" +

"Debes decidir correctamente dónde colocar cada archivo.\n\n" +

"Ejemplos de ubicaciones válidas:\n" +
"ServerScriptService\n" +
"ReplicatedStorage\n" +
"StarterPlayer/StarterPlayerScripts\n" +
"StarterPlayer/StarterCharacterScripts\n" +
"StarterGui\n" +
"Workspace\n\n" +

"Puedes usar carpetas dentro de esas ubicaciones.\n" +
"Debes respetar la arquitectura cliente-servidor de Roblox.\n\n" +

"Antes de generar código:\n" +
"1. Comprende exactamente lo que pide el usuario.\n" +
"2. Divide el sistema en todos los archivos necesarios.\n" +
"3. Decide qué archivos son Script, LocalScript o ModuleScript.\n" +
"4. Decide la ubicación correcta de cada archivo.\n" +
"5. Usa APIs actuales de Roblox.\n" +
"6. Revisa sintaxis, referencias, eventos, propiedades y lógica.\n" +
"7. Comprueba que los scripts puedan comunicarse correctamente.\n" +
"8. No uses pseudocódigo.\n" +
"9. Entrega código completo y funcional.\n\n" +

"IMPORTANTE:\n" +
"Tu respuesta DEBE usar exactamente este formato.\n\n" +

"RESPUESTA:\n" +
"Explicación breve de lo que hiciste.\n\n" +

"ARCHIVOS_START\n\n" +

"ARCHIVO_START\n" +
"TIPO: Script\n" +
"RUTA: ServerScriptService\n" +
"NOMBRE: NombreDelScript\n" +
"CODIGO_START\n" +
"Codigo Luau completo\n" +
"CODIGO_END\n" +
"ARCHIVO_END\n\n" +

"ARCHIVO_START\n" +
"TIPO: LocalScript\n" +
"RUTA: StarterPlayer/StarterPlayerScripts\n" +
"NOMBRE: NombreDelLocalScript\n" +
"CODIGO_START\n" +
"Codigo Luau completo\n" +
"CODIGO_END\n" +
"ARCHIVO_END\n\n" +

"ARCHIVO_START\n" +
"TIPO: ModuleScript\n" +
"RUTA: ReplicatedStorage/Sistema\n" +
"NOMBRE: NombreDelModuleScript\n" +
"CODIGO_START\n" +
"Codigo Luau completo\n" +
"CODIGO_END\n" +
"ARCHIVO_END\n\n" +

"ARCHIVOS_END\n\n" +

"Reglas:\n" +
"- No uses markdown.\n" +
"- No uses bloques de código.\n" +
"- No pongas caracteres de formato alrededor del código.\n" +
"- Cada archivo debe tener exactamente un bloque ARCHIVO_START y ARCHIVO_END.\n" +
"- TIPO solo puede ser Script, LocalScript o ModuleScript.\n" +
"- RUTA debe comenzar con una ubicación válida de Roblox Studio.\n" +
"- CODIGO_START y CODIGO_END deben estar presentes siempre.\n";

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
"remotefunction"
];

const texto = mensaje.toLowerCase();

return patrones.some(function(palabra) {
    return texto.includes(palabra);
});

}

function limpiarCodigo(codigo) {
let resultado = String(codigo || "").trim();

resultado = resultado.replace(/^lua\s*/i, "");
resultado = resultado.replace(/^luau\s*/i, "");
resultado = resultado.replace(/^```lua\s*/i, "");
resultado = resultado.replace(/^```luau\s*/i, "");
resultado = resultado.replace(/^```\s*/i, "");
resultado = resultado.replace(/\s*```$/i, "");

return resultado.trim();

}

function extraerAntigravity(texto) {
if (typeof texto !== "string") {
console.error("❌ La respuesta de Antigravity no es texto.");
return null;
}

texto = texto
    .replace(/\r\n/g, "\n")
    .replace(/\r/g, "\n");

const respuestaInicio = texto.indexOf("RESPUESTA:");
const archivosInicio = texto.indexOf("ARCHIVOS_START");
const archivosFin = texto.lastIndexOf("ARCHIVOS_END");

if (respuestaInicio === -1) {
    console.error("❌ No se encontró RESPUESTA:.");
    return null;
}

if (archivosInicio === -1) {
    console.error("❌ No se encontró ARCHIVOS_START.");
    return null;
}

if (archivosFin === -1) {
    console.error("❌ No se encontró ARCHIVOS_END.");
    return null;
}

const respuesta = texto
    .substring(
        respuestaInicio + "RESPUESTA:".length,
        archivosInicio
    )
    .trim();

const contenidoArchivos = texto
    .substring(
        archivosInicio + "ARCHIVOS_START".length,
        archivosFin
    )
    .trim();

const bloques = contenidoArchivos
    .split("ARCHIVO_START")
    .slice(1);

if (bloques.length === 0) {
    console.error("❌ No se encontraron archivos.");
    return null;
}

const acciones = [];

for (const bloqueCompleto of bloques) {
    const posicionFin =
        bloqueCompleto.indexOf("ARCHIVO_END");

    if (posicionFin === -1) {
        console.warn(
            "⚠️ Se encontró un archivo sin ARCHIVO_END."
        );
        continue;
    }

    const bloque =
        bloqueCompleto
            .substring(0, posicionFin)
            .trim();

    const tipoInicio =
        bloque.indexOf("TIPO:");

    const rutaInicio =
        bloque.indexOf("RUTA:");

    const nombreInicio =
        bloque.indexOf("NOMBRE:");

    const codigoInicio =
        bloque.indexOf("CODIGO_START");

    const codigoFin =
        bloque.lastIndexOf("CODIGO_END");

    if (tipoInicio === -1) {
        console.warn("⚠️ Falta TIPO.");
        continue;
    }

    if (rutaInicio === -1) {
        console.warn("⚠️ Falta RUTA.");
        continue;
    }

    if (nombreInicio === -1) {
        console.warn("⚠️ Falta NOMBRE.");
        continue;
    }

    if (codigoInicio === -1) {
        console.warn("⚠️ Falta CODIGO_START.");
        continue;
    }

    if (codigoFin === -1) {
        console.warn("⚠️ Falta CODIGO_END.");
        continue;
    }

    if (codigoFin <= codigoInicio) {
        console.warn(
            "⚠️ CODIGO_END aparece antes de CODIGO_START."
        );
        continue;
    }

    const obtenerValorLinea =
        function(inicio, siguiente) {

            const valorFin =
                siguiente === -1
                    ? bloque.length
                    : siguiente;

            return bloque
                .substring(
                    inicio,
                    valorFin
                )
                .replace(
                    /^[^:]+:/,
                    ""
                )
                .trim();
        };

    const posiciones = [
        {
            nombre: "tipo",
            posicion: tipoInicio
        },
        {
            nombre: "ruta",
            posicion: rutaInicio
        },
        {
            nombre: "nombre",
            posicion: nombreInicio
        }
    ].sort(
        function(a, b) {
            return a.posicion - b.posicion;
        }
    );

    const valores = {};

    for (
        let i = 0;
        i < posiciones.length;
        i++
    ) {
        const actual =
            posiciones[i];

        const siguiente =
            posiciones[i + 1];

        valores[actual.nombre] =
            obtenerValorLinea(
                actual.posicion,
                siguiente
                    ? siguiente.posicion
                    : codigoInicio
            );
    }

    const tipo =
        valores.tipo;

    const ruta =
        valores.ruta;

    const nombre =
        valores.nombre;

    const codigo =
        limpiarCodigo(
            bloque.substring(
                codigoInicio +
                "CODIGO_START".length,
                codigoFin
            )
        );

    if (!tipo) {
        console.warn("⚠️ TIPO vacío.");
        continue;
    }

    if (!ruta) {
        console.warn(
            "⚠️ RUTA vacía para:",
            nombre
        );
        continue;
    }

    if (!nombre) {
        console.warn("⚠️ NOMBRE vacío.");
        continue;
    }

    if (!codigo) {
        console.warn(
            "⚠️ El archivo " +
            nombre +
            " no tiene código."
        );
        continue;
    }

    let actionType = null;

    if (tipo === "Script") {
        actionType = "create_script";
    }

    if (tipo === "LocalScript") {
        actionType = "create_local_script";
    }

    if (tipo === "ModuleScript") {
        actionType = "create_module_script";
    }

    if (!actionType) {
        console.warn(
            "⚠️ Tipo no permitido:",
            tipo
        );
        continue;
    }

    acciones.push({
        type: actionType,
        name: nombre,
        path: ruta,
        code: codigo
    });
}

if (acciones.length === 0) {
    console.error(
        "❌ Antigravity no devolvió archivos válidos."
    );

    return null;
}

return {
    reply:
        respuesta ||
        "Sistema generado correctamente.",

    actions:
        acciones
};

}

async function hablarConGemini(mensajeUsuario) {
historial.push({
role: "user",
parts: [
{
text: mensajeUsuario
}
]
});

if (historial.length > 20) {
    historial.splice(
        0,
        historial.length - 20
    );
}

for (
    let intento = 1;
    intento <= 3;
    intento++
) {
    try {
        console.log(
            "\n⏳ Procesando conversación... intento " +
            intento +
            "/3"
        );

        const response =
            await ai.models.generateContent({
                model: CHAT_MODEL,
                contents: historial,

                config: {
                    systemInstruction: CHAT_SYSTEM,

                    thinkingConfig: {
                        thinkingLevel: "low"
                    },

                    maxOutputTokens: 2048
                }
            });

        const texto =
            response.text;

        if (!texto) {
            throw new Error(
                "Gemini no devolvió texto."
            );
        }

        historial.push({
            role: "model",
            parts: [
                {
                    text: texto
                }
            ]
        });

        console.log(
            "\n" + texto
        );

        return;

    } catch (error) {
        const mensajeError =
            error instanceof Error
                ? error.message
                : String(error);

        console.error(
            "\n❌ Error de Gemini:"
        );

        console.error(
            mensajeError
        );

        const temporal =
            mensajeError.includes("429") ||
            mensajeError.includes("500") ||
            mensajeError.includes("503") ||
            mensajeError.includes("UNAVAILABLE") ||
            mensajeError.includes("RESOURCE_EXHAUSTED");

        if (!temporal) {
            return;
        }

        if (intento < 3) {
            const espera =
                intento * 2000;

            console.log(
                "⏳ Reintentando en " +
                espera / 1000 +
                " segundos..."
            );

            await new Promise(
                function(resolve) {
                    setTimeout(
                        resolve,
                        espera
                    );
                }
            );
        }
    }
}

}

async function programarConAntigravity(
mensajeUsuario
) {
const contextoReciente =
historial
.slice(-10)
.map(
function(mensaje) {
const texto =
mensaje.parts
?.map(
function(parte) {
return (
parte.text ||
""
);
}
)
.join(" ");

                const rol =
                    mensaje.role === "user"
                        ? "Usuario"
                        : "Asistente";

                return (
                    rol +
                    ": " +
                    texto
                );
            }
        )
        .join("\n");

let entrada =
    ANTIGRAVITY_SYSTEM +
    "\n\n";

if (contextoReciente) {
    entrada +=
        "CONTEXTO RECIENTE:\n" +
        contextoReciente +
        "\n\n";
}

entrada +=
    "PETICIÓN ACTUAL:\n" +
    mensajeUsuario;

for (
    let intento = 1;
    intento <= 3;
    intento++
) {
    try {
        console.log(
            "\n🤖 Antigravity programando... intento " +
            intento +
            "/3"
        );

        let opciones;

        if (
            antigravityInteractionId &&
            antigravityEnvironmentId
        ) {
            opciones = {
                agent:
                    ANTIGRAVITY_AGENT,

                previous_interaction_id:
                    antigravityInteractionId,

                environment:
                    antigravityEnvironmentId,

                input:
                    mensajeUsuario,

                system_instruction:
                    ANTIGRAVITY_SYSTEM,

                agent_config: {
                    type:
                        "antigravity",

                    max_total_tokens:
                        50000
                },

                store:
                    true
            };

        } else {
            opciones = {
                agent:
                    ANTIGRAVITY_AGENT,

                input:
                    entrada,

                environment:
                    "remote",

                system_instruction:
                    ANTIGRAVITY_SYSTEM,

                agent_config: {
                    type:
                        "antigravity",

                    max_total_tokens:
                        50000
                },

                store:
                    true
            };
        }

        const interaction =
            await ai.interactions.create(
                opciones,
                {
                    timeout:
                        300000
                }
            );

        antigravityInteractionId =
            interaction.id;

        if (
            interaction.environment_id
        ) {
            antigravityEnvironmentId =
                interaction.environment_id;
        }

        const texto =
            interaction.output_text;

        if (!texto) {
            throw new Error(
                "Antigravity no devolvió texto."
            );
        }

        console.log(
            "\n[RESPUESTA DE ANTIGRAVITY]"
        );

        const resultado =
            extraerAntigravity(
                texto
            );

        if (!resultado) {
            console.error(
                "\n❌ No pude interpretar los archivos."
            );

            console.error(
                "\nRespuesta recibida:"
            );

            console.error(
                texto
            );

            return;
        }

        console.log(
            "\n" +
            resultado.reply
        );

        pendingActions =
            resultado.actions;

        console.log(
            "\n[ACCIONES PARA ROBLOX]"
        );

        console.log(
            "Archivos preparados:",
            pendingActions.length
        );

        pendingActions.forEach(
            function(action, indice) {
                console.log(
                    (
                        indice + 1
                    ) +
                    ". " +
                    action.type +
                    " → " +
                    action.path +
                    "/" +
                    action.name
                );
            }
        );

        return;

    } catch (error) {
        const mensajeError =
            error instanceof Error
                ? error.message
                : String(error);

        console.error(
            "\n❌ Error de Antigravity:"
        );

        console.error(
            mensajeError
        );

        const temporal =
            mensajeError.includes("429") ||
            mensajeError.includes("500") ||
            mensajeError.includes("502") ||
            mensajeError.includes("503") ||
            mensajeError.includes("504") ||
            mensajeError.includes("UNAVAILABLE");

        if (!temporal) {
            return;
        }

        if (intento < 3) {
            const espera =
                intento * 3000;

            console.log(
                "⏳ Reintentando en " +
                espera / 1000 +
                " segundos..."
            );

            await new Promise(
                function(resolve) {
                    setTimeout(
                        resolve,
                        espera
                    );
                }
            );
        }
    }
}

}

async function preguntar(
mensajeUsuario
) {
const texto =
mensajeUsuario.trim();

if (!texto) {
    return;
}

if (esTareaDeAnimacion(texto)) {
    try {
        console.log(
            "\n🎞️ Enviando tarea a animation.js..."
        );

        const resultado =
            await procesarAnimacion(
                texto,
                ai,
                historial,
                r6Calibration
            );

        if (!resultado) {
            console.error(
                "❌ animation.js no devolvió ningún resultado."
            );

            return;
        }

        if (resultado.reply) {
            console.log(
                "\n" +
                resultado.reply
            );
        }

        if (
            Array.isArray(
                resultado.actions
            ) &&
            resultado.actions.length > 0
        ) {
            pendingActions =
                resultado.actions;

            console.log(
                "\n[ACCIONES DE ANIMACIÓN PARA ROBLOX]"
            );

            console.log(
                "Acciones preparadas:",
                pendingActions.length
            );
        }

    } catch (error) {
        const mensajeError =
            error instanceof Error
                ? error.message
                : String(error);

        console.error(
            "\n❌ Error en animation.js:"
        );

        console.error(
            mensajeError
        );
    }

    return;
}

if (esTareaDeCodigo(texto)) {
    await programarConAntigravity(
        texto
    );
} else {
    await hablarConGemini(
        texto
    );
}

}

app.get(
"/",
function(req, res) {
res.send(
"✅ Gemini + Antigravity Bridge funcionando."
);
}
);

app.post(
"/r6-calibration",
function(req, res) {
try {
if (
!req.body ||
typeof req.body !==
"object"
) {
return res.status(400).json({
ok: false,
error:
"Calibración inválida."
});
}

        if (
            req.body.rig !== "R6"
        ) {
            return res.status(400).json({
                ok: false,
                error:
                    "La calibración no corresponde a R6."
            });
        }

        if (
            !req.body.rigName
        ) {
            return res.status(400).json({
                ok: false,
                error:
                    "Falta el nombre del rig."
            });
        }

        if (
            !req.body.joints ||
            typeof req.body.joints !==
                "object"
        ) {
            return res.status(400).json({
                ok: false,
                error:
                    "No se recibieron los joints calibrados."
            });
        }

        r6Calibration =
            req.body;

        console.log(
            "\n🧭 CALIBRACIÓN R6 RECIBIDA"
        );

        console.log(
            "🎯 Rig:",
            r6Calibration.rigName
        );

        console.log(
            "🦴 Joints:",
            Object.keys(
                r6Calibration.joints
            ).length
        );

        console.log(
            "➡️ Frente:",
            JSON.stringify(
                r6Calibration.forwardWorld
            )
        );

        console.log(
            "↔️ Derecha:",
            JSON.stringify(
                r6Calibration.rightWorld
            )
        );

        console.log(
            "⬆️ Arriba:",
            JSON.stringify(
                r6Calibration.upWorld
            )
        );

        console.log(
            "✅ Calibración R6 guardada en memoria."
        );

        return res.json({
            ok: true,
            message:
                "Calibración R6 recibida correctamente."
        });

    } catch (error) {
        console.error(
            "❌ Error procesando calibración R6:",
            error
        );

        return res.status(500).json({
            ok: false,
            error:
                "Error interno procesando la calibración."
        });
    }
}

);

app.get(
"/r6-calibration",
function(req, res) {
if (!r6Calibration) {
return res.json({
calibrated: false,
calibration: null
});
}

    return res.json({
        calibrated: true,
        calibration:
            r6Calibration
    });
}

);

app.get(
"/next",
function(req, res) {
const acciones =
pendingActions;

    pendingActions = [];

    res.json({
        actions:
            acciones
    });
}

);

app.listen(
PORT,
function() {
console.log(
"================================="
);

    console.log(
        "🤖 GEMINI + ANTIGRAVITY BRIDGE"
    );

    console.log(
        "================================="
    );

    console.log(
        "Servidor: http://127.0.0.1:" +
        PORT
    );

    console.log(
        "Chat: " +
        CHAT_MODEL
    );

    console.log(
        "Programador: " +
        ANTIGRAVITY_AGENT
    );

    console.log(
        "Animaciones: animation.js"
    );

    console.log(
        "Calibración: R6 automática"
    );

    console.log(
        "Chat listo."
    );

    console.log(
        "=================================\n"
    );
}

);

const rl =
readline.createInterface({
input:
process.stdin,

    output:
        process.stdout
});

console.log(
"Escribe algo para hablar con el asistente."
);

console.log(
"Las tareas de programación serán enviadas a Antigravity."
);

console.log(
"Las tareas de animación serán enviadas a animation.js."
);

console.log(
"La calibración R6 será recibida desde Roblox Studio."
);

console.log(
"Escribe 'salir' para cerrar.\n"
);

while (true) {
const mensaje =
await rl.question(
"Tú: "
);

if (!mensaje.trim()) {
    continue;
}

if (
    mensaje
        .toLowerCase()
        .trim() ===
    "salir"
) {
    console.log(
        "Cerrando..."
    );

    break;
}

await preguntar(
    mensaje
);

}

rl.close();

process.exit(0);