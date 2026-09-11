import { generarAnimacion } from "./animationCore.js";

export async function procesarAnimacion(mensajeUsuario, historial, r6Calibration) {
    return await generarAnimacion(mensajeUsuario, historial, r6Calibration);
}
