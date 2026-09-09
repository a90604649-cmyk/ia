import { GoogleGenAI } from "@google/genai";
import { generarAnimacion } from "./animationCore.js";

export async function procesarAnimacion(
mensajeUsuario,
ai,
historial,
r6Calibration
) {
if (!ai) {
const apiKey = process.env.GEMINI_API_KEY;


    if (!apiKey) {
        console.error(
            "❌ No se encontró GEMINI_API_KEY."
        );

        return null;
    }

    ai = new GoogleGenAI({
        apiKey: apiKey
    });
}

return await generarAnimacion(
    ai,
    mensajeUsuario,
    historial,
    r6Calibration
);


}
