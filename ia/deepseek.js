import { preguntarGPT6Astra, GPT6_ASTRA_MODEL } from "./openai.js";

// Compatibilidad con server.js existente.
// La capa que antes llamaba a DeepSeek ahora utiliza GPT-6 Astra.
export async function preguntarDeepSeek(mensajes, opciones = {}) {
    return await preguntarGPT6Astra(mensajes, {
        ...opciones,
        model: process.env.OPENAI_MODEL || GPT6_ASTRA_MODEL
    });
}

export const DEEPSEEK_MODEL =
    process.env.OPENAI_MODEL || GPT6_ASTRA_MODEL;
