import { preguntarGPT6Astra, GPT6_ASTRA_MODEL } from "./openai.js";

// Compatibilidad con server.js existente.
// Aunque el archivo conserva su nombre, el programador real ahora es GPT-6 Astra vía OpenRouter.
export async function preguntarDeepSeek(mensajes, opciones = {}) {
    return await preguntarGPT6Astra(mensajes, {
        ...opciones,
        model: process.env.OPENROUTER_MODEL || GPT6_ASTRA_MODEL
    });
}

export const DEEPSEEK_MODEL =
    process.env.OPENROUTER_MODEL || GPT6_ASTRA_MODEL;
