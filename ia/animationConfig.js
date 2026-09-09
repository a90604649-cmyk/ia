export const ANIMATION_MODELS = [
"gemini-3.8-flash",
"gemini-3.7-flash",
"gemini-3.6-flash",
"gemini-3.5-flash-lite"
];

export const MEMORY_FILE_PARTS = [
"animation_memory",
"memory.json"
];

export const R6_PARTS = [
"HumanoidRootPart",
"Torso",
"Head",
"Left Arm",
"Right Arm",
"Left Leg",
"Right Leg"
];

export const R6_JOINTS = [
"RootJoint",
"Neck",
"Left Shoulder",
"Right Shoulder",
"Left Hip",
"Right Hip"
];

export const R6_RIG_NAME = "dummy";
export const R6_RIG_TYPE = "R6";
export const R6_RIG_PATH = "Workspace/dummy";

export const ANIMATION_SYSTEM =
"Eres un animador profesional especializado EXCLUSIVAMENTE en Roblox R6.\n\n" +


"Tu tarea es crear animaciones nuevas a partir de la descripción del usuario.\n\n" +

"El rig objetivo es exactamente Workspace/dummy.\n" +
"El rig es R6.\n\n" +

"IMPORTANTE: no trates el personaje como R15.\n\n" +

"PARTES R6 DISPONIBLES:\n" +
R6_PARTS.join(", ") +
"\n\n" +

"JOINTS R6:\n" +
R6_JOINTS.join(", ") +
"\n\n" +

"Nunca inventes partes R15 como UpperArm, LowerArm, Hand, UpperLeg, LowerLeg o Foot.\n\n" +

"REGLA PRINCIPAL:\n" +
"No produzcas una colección de partes moviéndose independientemente.\n" +
"La animación debe representar una acción corporal completa y coherente.\n\n" +

"Antes de generar keyframes debes imaginar mentalmente la secuencia completa del movimiento.\n\n" +

"Divide las acciones complejas en fases cuando corresponda:\n" +
"anticipación, preparación, impulso, movimiento principal, punto máximo, transición, recuperación.\n\n" +

"Cada keyframe debe representar un momento significativo de la acción.\n" +
"No generes keyframes aleatorios solo para aumentar la cantidad.\n\n" +

"COORDINACIÓN CORPORAL:\n" +
"Las partes deben relacionarse entre sí.\n" +
"Cuando una pierna participa en una acción, considera cómo debería reaccionar el brazo contrario, el torso y la cabeza.\n" +
"No muevas ambos brazos y ambas piernas de forma idéntica salvo que la acción realmente lo requiera.\n\n" +

"LOCOMOCIÓN:\n" +
"Para caminar o correr, utiliza alternancia entre piernas y brazos.\n" +
"El brazo derecho y la pierna izquierda suelen coordinarse de forma opuesta al brazo izquierdo y la pierna derecha.\n" +
"Añade una pequeña participación del torso cuando corresponda.\n" +
"Evita que el personaje parezca deslizarse.\n\n" +

"SALTOS:\n" +
"Un salto debe tener preparación, impulso, fase aérea, preparación del aterrizaje y recuperación.\n" +
"No representes cualquier salto simplemente subiendo HumanoidRootPart.\n" +
"El cuerpo debe cambiar de postura durante el salto.\n" +
"Las piernas deben reaccionar al despegue y al aterrizaje.\n\n" +

"GIROS Y MIRADAS:\n" +
"Si el personaje mira hacia un lado, mueve primero la cabeza y utiliza el torso solo cuando sea necesario.\n" +
"No gires todo el cuerpo para representar una simple mirada.\n\n" +

"ATAQUES:\n" +
"Utiliza anticipación, preparación, movimiento principal, impacto y recuperación.\n" +
"El torso puede acompañar al brazo.\n" +
"Evita mover únicamente el brazo si el movimiento necesita participación corporal.\n\n" +

"DIRECCIÓN:\n" +
"Diferencia claramente un movimiento vertical de uno frontal, lateral o rotacional.\n" +
"No interpretes automáticamente cualquier salto hacia delante como un movimiento vertical.\n\n" +

"HUMANOIDROOTPART:\n" +
"Debe utilizarse con moderación.\n" +
"No la rotes ni la desplaces exageradamente sin una razón clara.\n\n" +

"ROTACIONES:\n" +
"rx, ry y rz están expresadas en grados.\n" +
"x, y y z representan desplazamientos locales.\n\n" +

"CALIDAD:\n" +
"Las transiciones deben ser naturales.\n" +
"Evita cambios bruscos sin una razón clara.\n" +
"Evita poses completamente diferentes entre dos keyframes consecutivos si no forman parte de un movimiento rápido.\n\n" +

"MEMORIA:\n" +
"Las referencias aprendidas representan características de estilo y coordinación.\n" +
"NO copies sus keyframes.\n" +
"NO copies sus poses.\n" +
"NO combines literalmente animaciones existentes.\n" +
"NO reutilices una animación aprendida como plantilla directa.\n" +
"Utiliza únicamente sus características para mejorar una animación NUEVA.\n\n" +

"La animación final debe poder editarse posteriormente en Roblox Studio.\n";


export const ANIMATION_SCHEMA = {
type: "object",


properties: {
    reply: {
        type: "string"
    },

    animations: {
        type: "array",

        items: {
            type: "object",

            properties: {
                name: {
                    type: "string"
                },

                path: {
                    type: "string"
                },

                rigName: {
                    type: "string"
                },

                rigType: {
                    type: "string",
                    enum: ["R6"]
                },

                looped: {
                    type: "boolean"
                },

                priority: {
                    type: "string",
                    enum: [
                        "Action",
                        "Action2",
                        "Action3",
                        "Action4",
                        "Idle",
                        "Movement",
                        "Core"
                    ]
                },

                duration: {
                    type: "number"
                },

                phases: {
                    type: "array",

                    items: {
                        type: "object",

                        properties: {
                            name: {
                                type: "string"
                            },

                            start: {
                                type: "number"
                            },

                            end: {
                                type: "number"
                            }
                        },

                        required: [
                            "name",
                            "start",
                            "end"
                        ]
                    }
                },

                keyframes: {
                    type: "array",

                    items: {
                        type: "object",

                        properties: {
                            time: {
                                type: "number"
                            },

                            poses: {
                                type: "array",

                                items: {
                                    type: "object",

                                    properties: {
                                        part: {
                                            type: "string",
                                            enum: R6_PARTS
                                        },

                                        x: {
                                            type: "number"
                                        },

                                        y: {
                                            type: "number"
                                        },

                                        z: {
                                            type: "number"
                                        },

                                        rx: {
                                            type: "number"
                                        },

                                        ry: {
                                            type: "number"
                                        },

                                        rz: {
                                            type: "number"
                                        }
                                    },

                                    required: [
                                        "part",
                                        "x",
                                        "y",
                                        "z",
                                        "rx",
                                        "ry",
                                        "rz"
                                    ]
                                }
                            }
                        },

                        required: [
                            "time",
                            "poses"
                        ]
                    }
                }
            },

            required: [
                "name",
                "path",
                "rigName",
                "rigType",
                "looped",
                "priority",
                "duration",
                "phases",
                "keyframes"
            ]
        }
    }
},

required: [
    "reply",
    "animations"
]


};
