// Compatibility adapter for older server imports.
// The implementation is now entirely handled by OmniRoute.
import {
    OMNIROUTE_CONFIG,
    OMNIROUTE_MODEL_ID,
    preguntarOmniRoute,
    parsearRespuestaJson
} from "./omniRoute.js";

export const GROQ_CONFIG = OMNIROUTE_CONFIG;
export const GROQ_MODEL_ID = OMNIROUTE_MODEL_ID;
export const preguntarGroq = preguntarOmniRoute;
export { parsearRespuestaJson };
