import fs from "fs/promises";
import path from "path";

import {
ANIMATION_MODELS,
MEMORY_FILE_PARTS,
R6_PARTS,
R6_JOINTS,
R6_RIG_NAME,
R6_RIG_TYPE,
R6_RIG_PATH,
ANIMATION_SYSTEM,
ANIMATION_SCHEMA
} from "./animationConfig.js";

const MEMORY_FILE = path.join(
process.cwd(),
...MEMORY_FILE_PARTS
);

async function cargarMemoria() {
try {
await fs.mkdir(
path.dirname(MEMORY_FILE),
{
recursive: true
}
);


    try {
        await fs.access(
            MEMORY_FILE
        );
    } catch {
        await fs.writeFile(
            MEMORY_FILE,
            JSON.stringify(
                {
                    references: []
                },
                null,
                4
            ),
            "utf8"
        );
    }

    const contenido =
        await fs.readFile(
            MEMORY_FILE,
            "utf8"
        );

    const memoria =
        JSON.parse(
            contenido
        );

    if (
        !memoria ||
        !Array.isArray(
            memoria.references
        )
    ) {
        return {
            references: []
        };
    }

    return memoria;

} catch (error) {

    console.error(
        "❌ No se pudo cargar la memoria de animaciones:"
    );

    console.error(
        error instanceof Error
            ? error.message
            : String(error)
    );

    return {
        references: []
    };
}


}

function limitarNumero(
valor,
minimo,
maximo
) {
return Math.min(
maximo,
Math.max(
minimo,
valor
)
);
}

function resumirReferencia(
referencia
) {
let resultado =
"REFERENCIA DE APRENDIZAJE:\n";


resultado +=
    "Nombre: " +
    String(
        referencia.name ||
        "Sin nombre"
    ) +
    "\n";

resultado +=
    "Tipo de rig: R6\n";

resultado +=
    "Duración aproximada: " +
    Number(
        referencia.duration ||
        0
    ).toFixed(2) +
    " segundos\n";

resultado +=
    "Cantidad de keyframes: " +
    Number(
        referencia.keyframeCount ||
        0
    ) +
    "\n";

if (referencia.note) {
    resultado +=
        "Observación:\n" +
        String(
            referencia.note
        ) +
        "\n";
}

if (referencia.parts) {

    resultado +=
        "Características por parte:\n";

    for (
        const parte
        of Object.keys(
            referencia.parts
        )
    ) {

        const datos =
            referencia.parts[
                parte
            ];

        resultado +=
            "- " +
            parte +
            ": " +
            "rotX=" +
            Number(
                datos.rotacionX ||
                0
            ).toFixed(1) +
            "°, " +
            "rotY=" +
            Number(
                datos.rotacionY ||
                0
            ).toFixed(1) +
            "°, " +
            "rotZ=" +
            Number(
                datos.rotacionZ ||
                0
            ).toFixed(1) +
            "°\n";

        resultado +=
            "  desplazamientoX=" +
            Number(
                datos.desplazamientoX ||
                0
            ).toFixed(2) +
            ", " +
            "desplazamientoY=" +
            Number(
                datos.desplazamientoY ||
                0
            ).toFixed(2) +
            ", " +
            "desplazamientoZ=" +
            Number(
                datos.desplazamientoZ ||
                0
            ).toFixed(2) +
            "\n";
    }
}

return resultado;


}

async function crearContextoAprendido() {
const memoria =
await cargarMemoria();


if (
    !memoria.references ||
    memoria.references.length === 0
) {
    return "";
}

const referencias =
    memoria.references.slice(
        -8
    );

let contexto =
    "MEMORIA DE ANIMACIÓN:\n\n";

contexto +=
    "Las siguientes animaciones son únicamente REFERENCIAS DE ESTILO.\n" +
    "No copies sus keyframes.\n" +
    "No copies sus poses.\n" +
    "No las combines literalmente.\n" +
    "Extrae solamente patrones generales de movimiento, coordinación y calidad.\n\n";

for (
    const referencia
    of referencias
) {

    contexto +=
        resumirReferencia(
            referencia
        );

    contexto +=
        "\n";
}

return contexto;


}

function crearContextoConversacion(
historial
) {
if (
!Array.isArray(
historial
)
) {
return "";
}


return historial
    .slice(-8)
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


}

async function crearPrompt(
mensajeUsuario,
historial
) {
const memoria =
await crearContextoAprendido();


const conversacion =
    crearContextoConversacion(
        historial
    );

let prompt =
    ANIMATION_SYSTEM +
    "\n\n";

prompt +=
    "RIG OBJETIVO:\n" +
    R6_RIG_PATH +
    "\n\n";

prompt +=
    "PARTES R6 PERMITIDAS:\n" +
    R6_PARTS.join(", ") +
    "\n\n";

prompt +=
    "JOINTS R6 DE REFERENCIA:\n" +
    R6_JOINTS.join(", ") +
    "\n\n";

if (memoria) {
    prompt +=
        memoria +
        "\n";
}

if (conversacion) {
    prompt +=
        "CONTEXTO RECIENTE:\n" +
        conversacion +
        "\n\n";
}

prompt +=
    "PETICIÓN DEL USUARIO:\n" +
    mensajeUsuario +
    "\n\n";

prompt +=
    "PROCESO OBLIGATORIO:\n" +
    "1. Comprende la acción solicitada.\n" +
    "2. Determina las fases necesarias.\n" +
    "3. Diseña la coordinación corporal.\n" +
    "4. Crea keyframes completamente nuevos.\n" +
    "5. Revisa continuidad y naturalidad.\n" +
    "6. Comprueba que todas las partes usadas pertenecen al R6.\n\n";

prompt +=
    "REQUISITOS:\n" +
    "- rigName = " +
    R6_RIG_NAME +
    "\n" +
    "- rigType = " +
    R6_RIG_TYPE +
    "\n" +
    "- path = " +
    R6_RIG_PATH +
    "\n" +
    "- si el usuario proporciona una duración, respétala exactamente\n" +
    "- utiliza suficientes keyframes para representar el movimiento\n" +
    "- no generes una copia de ninguna referencia\n";

return prompt;


}

function esErrorTemporal(error) {
const mensaje =
error instanceof Error
? error.message
: String(error);


return (
    mensaje.includes("429") ||
    mensaje.includes("500") ||
    mensaje.includes("502") ||
    mensaje.includes("503") ||
    mensaje.includes("504") ||
    mensaje.includes(
        "UNAVAILABLE"
    ) ||
    mensaje.includes(
        "RESOURCE_EXHAUSTED"
    ) ||
    mensaje.includes(
        "high demand"
    ) ||
    mensaje.includes(
        "temporarily unavailable"
    )
);


}

function validarNumerosPose(
pose
) {
const valores = [
pose.x,
pose.y,
pose.z,
pose.rx,
pose.ry,
pose.rz
];


return valores.every(
    function(valor) {
        return (
            typeof valor ===
                "number" &&
            Number.isFinite(
                valor
            )
        );
    }
);


}

function validarAnimacion(
animation
) {
if (
!animation ||
typeof animation.name !==
"string" ||
animation.name.trim() === ""
) {
return false;
}


if (
    animation.rigType !==
    R6_RIG_TYPE
) {
    return false;
}

if (
    animation.rigName !==
    R6_RIG_NAME
) {
    return false;
}

if (
    animation.path !==
    R6_RIG_PATH
) {
    return false;
}

if (
    !Array.isArray(
        animation.keyframes
    ) ||
    animation.keyframes.length <
        2
) {
    return false;
}

const duracion =
    Number(
        animation.duration
    );

if (
    !Number.isFinite(
        duracion
    ) ||
    duracion <= 0
) {
    return false;
}

let tiempoAnterior =
    -1;

for (
    const keyframe
    of animation.keyframes
) {

    if (
        !keyframe ||
        typeof keyframe.time !==
            "number" ||
        !Number.isFinite(
            keyframe.time
        )
    ) {
        return false;
    }

    if (
        keyframe.time <
        tiempoAnterior
    ) {
        return false;
    }

    if (
        keyframe.time < 0 ||
        keyframe.time >
            duracion + 0.05
    ) {
        return false;
    }

    tiempoAnterior =
        keyframe.time;

    if (
        !Array.isArray(
            keyframe.poses
        )
    ) {
        return false;
    }

    for (
        const pose
        of keyframe.poses
    ) {

        if (
            !pose ||
            !R6_PARTS.includes(
                pose.part
            )
        ) {
            return false;
        }

        if (
            !validarNumerosPose(
                pose
            )
        ) {
            return false;
        }
    }
}

return true;


}

function normalizarPose(
pose
) {
return {
part:
pose.part,


    x:
        limitarNumero(
            Number(pose.x) || 0,
            -5,
            5
        ),

    y:
        limitarNumero(
            Number(pose.y) || 0,
            -5,
            5
        ),

    z:
        limitarNumero(
            Number(pose.z) || 0,
            -5,
            5
        ),

    rx:
        limitarNumero(
            Number(pose.rx) || 0,
            -180,
            180
        ),

    ry:
        limitarNumero(
            Number(pose.ry) || 0,
            -180,
            180
        ),

    rz:
        limitarNumero(
            Number(pose.rz) || 0,
            -180,
            180
        )
};


}

function convertirResultado(
resultado
) {
if (
!resultado ||
!Array.isArray(
resultado.animations
)
) {
return null;
}


const actions = [];

for (
    const animation
    of resultado.animations
) {

    if (
        !validarAnimacion(
            animation
        )
    ) {
        console.warn(
            "⚠️ Animación rechazada por validación:",
            animation?.name ||
            "sin nombre"
        );

        continue;
    }

    const keyframes = [];

    for (
        const keyframe
        of animation.keyframes
    ) {

        const poses = [];

        for (
            const pose
            of keyframe.poses ||
            []
        ) {

            poses.push(
                normalizarPose(
                    pose
                )
            );
        }

        keyframes.push({
            time:
                keyframe.time,

            poses:
                poses
        });
    }

    keyframes.sort(
        function(a, b) {
            return (
                a.time -
                b.time
            );
        }
    );

    if (
        keyframes.length <
        2
    ) {
        continue;
    }

    const ultimo =
        keyframes[
            keyframes.length - 1
        ];

    actions.push({
        type:
            "create_animation",

        name:
            animation.name,

        path:
            R6_RIG_PATH,

        rigName:
            R6_RIG_NAME,

        rigType:
            R6_RIG_TYPE,

        looped:
            Boolean(
                animation.looped
            ),

        priority:
            animation.priority ||
            "Action",

        duration:
            Number(
                animation.duration
            ) ||
            ultimo.time,

        phases:
            Array.isArray(
                animation.phases
            )
                ? animation.phases
                : [],

        keyframes:
            keyframes
    });
}

if (
    actions.length === 0
) {
    return null;
}

return {
    reply:
        resultado.reply ||
        "Animación R6 generada correctamente.",

    actions:
        actions
};


}

export async function generarAnimacion(
ai,
mensajeUsuario,
historial
) {
const prompt =
await crearPrompt(
mensajeUsuario,
historial
);


for (
    let indice = 0;
    indice <
    ANIMATION_MODELS.length;
    indice++
) {

    const modelo =
        ANIMATION_MODELS[
            indice
        ];

    console.log(
        "\n🎞️ Probando modelo " +
        (indice + 1) +
        "/" +
        ANIMATION_MODELS.length +
        ": " +
        modelo
    );

    try {

        const response =
            await ai.models.generateContent(
                {
                    model:
                        modelo,

                    contents: [
                        {
                            role:
                                "user",

                            parts: [
                                {
                                    text:
                                        prompt
                                }
                            ]
                        }
                    ],

                    config: {

                        thinkingConfig: {
                            thinkingLevel:
                                "medium"
                        },

                        responseMimeType:
                            "application/json",

                        responseSchema:
                            ANIMATION_SCHEMA,

                        maxOutputTokens:
                            18000
                    }
                }
            );

        const texto =
            response.text;

        if (!texto) {
            throw new Error(
                "El modelo no devolvió datos."
            );
        }

        let resultado;

        try {

            resultado =
                JSON.parse(
                    texto
                );

        } catch {

            console.error(
                "❌ JSON inválido recibido de " +
                modelo
            );

            continue;
        }

        const convertido =
            convertirResultado(
                resultado
            );

        if (!convertido) {

            console.error(
                "❌ " +
                modelo +
                " generó una animación inválida."
            );

            continue;
        }

        console.log(
            "\n✅ Animación generada con " +
            modelo
        );

        console.log(
            "🎯 Rig:",
            R6_RIG_PATH
        );

        console.log(
            "🎞️ Animaciones:",
            convertido.actions.length
        );

        for (
            const action
            of convertido.actions
        ) {

            console.log(
                "🎬 " +
                action.name +
                " | Keyframes: " +
                action.keyframes.length +
                " | Duración: " +
                action.duration
            );
        }

        return convertido;

    } catch (error) {

        const mensajeError =
            error instanceof Error
                ? error.message
                : String(error);

        console.error(
            "\n❌ Error con " +
            modelo +
            ":"
        );

        console.error(
            mensajeError
        );

        if (
            !esErrorTemporal(
                error
            )
        ) {

            console.error(
                "❌ El error no es temporal."
            );

            return null;
        }

        console.log(
            "⚠️ " +
            modelo +
            " no disponible. Probando el siguiente modelo..."
        );
    }
}

console.error(
    "\n❌ Ninguno de los 4 modelos pudo generar la animación."
);

return null;


}
