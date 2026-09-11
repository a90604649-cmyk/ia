import "dotenv/config";
import express from "express";

const app = express();
const PORT = Number(process.env.PROJECT_CONTEXT_PORT || 3001);
const HOST = process.env.PROJECT_CONTEXT_HOST || "0.0.0.0";
const MAX_SOURCE_CHARS = 350000;
const MAX_SCRIPTS = 1000;

app.use(express.json({ limit: "20mb" }));

const scripts = new Map();
const objects = new Map();
let lastScanAt = 0;

function shouldIgnore(text) {
    const value = String(text || "").toLowerCase();
    return (
        value.includes("geminibridgeplugin") ||
        value.includes("roblox ai bridge") ||
        value.includes("projectcontext") ||
        value.includes("project context")
    );
}

function normalizeScript(script) {
    if (!script || typeof script !== "object") return null;

    const className = String(script.className || "").trim();
    if (!["Script", "LocalScript", "ModuleScript"].includes(className)) return null;

    const name = String(script.name || "").trim();
    const path = String(script.path || "").trim();
    const source = String(script.source || "");

    if (!name || !path || source.length > MAX_SOURCE_CHARS) return null;
    if (path.includes("..") || shouldIgnore(`${name} ${path}`)) return null;

    return {
        className,
        name,
        path,
        source,
        size: source.length
    };
}

function normalizeObject(object) {
    if (!object || typeof object !== "object") return null;

    const className = String(object.className || "").trim();
    if (!["RemoteEvent", "RemoteFunction"].includes(className)) return null;

    const name = String(object.name || "").trim();
    const path = String(object.path || "").trim();

    if (!name || !path || path.includes("..") || shouldIgnore(`${name} ${path}`)) return null;

    return { className, name, path };
}

function tokenize(text) {
    return String(text || "")
        .toLowerCase()
        .normalize("NFD")
        .replace(/[\u0300-\u036f]/g, "")
        .split(/[^a-z0-9_]+/i)
        .filter((token) => token.length >= 2);
}

function expandTerms(tokens) {
    const result = new Set(tokens);
    const groups = [
        ["correr", "corre", "sprint", "run", "running", "stamina", "walkspeed", "movement", "velocidad", "shift"],
        ["combate", "combat", "ataque", "attack", "punch", "hit", "damage", "block", "fighting"],
        ["inventario", "inventory", "item", "items", "backpack", "hotbar"],
        ["salto", "jump", "jumping", "air", "doublejump"],
        ["animacion", "animation", "animate", "anim", "keyframe", "pose"],
        ["herramienta", "tool", "equip", "equipped", "handle"],
        ["energia", "energy", "stamina", "fatigue", "regen", "regeneration"],
        ["remoto", "remote", "remoteevent", "remotefunction", "evento", "eventos"]
    ];

    for (const group of groups) {
        if (group.some((term) => result.has(term))) {
            for (const term of group) result.add(term);
        }
    }

    return result;
}

function scoreScript(script, queryTerms) {
    const nameTokens = tokenize(script.name);
    const pathTokens = tokenize(script.path);
    const sourceLower = script.source.toLowerCase();

    let score = 0;
    const signals = [];

    for (const term of queryTerms) {
        if (nameTokens.includes(term)) {
            score += 40;
            signals.push(`nombre:${term}`);
        }
        if (pathTokens.includes(term)) {
            score += 25;
            signals.push(`ruta:${term}`);
        }
        const occurrences = sourceLower.split(term).length - 1;
        if (occurrences > 0) {
            score += Math.min(occurrences * 3, 24);
            signals.push(`codigo:${term}`);
        }
    }

    if (script.className === "LocalScript") score += 2;
    if (script.className === "ModuleScript") score += 1;

    return { score, signals: [...new Set(signals)] };
}

function buildManifest() {
    return Array.from(scripts.values()).map((script) => ({
        className: script.className,
        name: script.name,
        path: script.path,
        size: script.size
    }));
}

function buildObjects() {
    return Array.from(objects.values()).map((object) => ({
        className: object.className,
        name: object.name,
        path: object.path
    }));
}

function selectRelevantScripts(query) {
    const queryTerms = expandTerms(tokenize(query));
    const ranked = Array.from(scripts.values()).map((script) => {
        const scored = scoreScript(script, queryTerms);
        return { script, score: scored.score, signals: scored.signals };
    });

    ranked.sort((a, b) => b.score - a.score || `${a.script.path}/${a.script.name}`.localeCompare(`${b.script.path}/${b.script.name}`));

    const selected = ranked.filter((item) => item.score > 0).slice(0, 18);
    const selectedKeys = new Set(selected.map((item) => `${item.script.path}/${item.script.name}`.toLowerCase()));

    for (const candidate of ranked) {
        if (selected.length >= 24) break;
        if (candidate.score > 0) continue;

        const key = `${candidate.script.path}/${candidate.script.name}`;
        const referenced = selected.some((item) => item.script.source.toLowerCase().includes(candidate.script.name.toLowerCase()));

        if (referenced && !selectedKeys.has(key.toLowerCase())) {
            selected.push(candidate);
            selectedKeys.add(key.toLowerCase());
        }
    }

    return { queryTerms: [...queryTerms], selected };
}

app.post("/project-scan", (req, res) => {
    try {
        const body = req.body;
        if (!body || !Array.isArray(body.scripts)) {
            return res.status(400).json({ ok: false, error: "Se esperaba scripts[]." });
        }

        if (body.reset === true) {
            scripts.clear();
            objects.clear();
        }

        let accepted = 0;
        let rejected = 0;
        let objectAccepted = 0;

        for (const rawScript of body.scripts) {
            const script = normalizeScript(rawScript);
            if (!script) {
                rejected += 1;
                continue;
            }

            scripts.set(`${script.path}/${script.name}`, script);
            accepted += 1;
        }

        if (Array.isArray(body.objects)) {
            for (const rawObject of body.objects) {
                const object = normalizeObject(rawObject);
                if (!object) continue;
                objects.set(`${object.path}/${object.name}`, object);
                objectAccepted += 1;
            }
        }

        if (scripts.size > MAX_SCRIPTS) {
            const entries = Array.from(scripts.entries()).sort((a, b) => a[0].localeCompare(b[0]));
            while (entries.length > MAX_SCRIPTS) {
                const [key] = entries.pop();
                scripts.delete(key);
            }
        }

        lastScanAt = Date.now();

        console.log(`🔎 Escaneo: +${accepted} scripts | ${scripts.size} scripts | +${objectAccepted} remotos | ${objects.size} objetos.`);

        return res.json({
            ok: true,
            accepted,
            rejected,
            totalScripts: scripts.size,
            totalObjects: objects.size
        });
    } catch (error) {
        console.error("❌ Error procesando escaneo:", error);
        return res.status(500).json({ ok: false, error: "Error procesando el escaneo." });
    }
});

app.get("/project-context", (req, res) => {
    try {
        const query = String(req.query.query || "").trim();
        const result = selectRelevantScripts(query);

        return res.json({
            ok: true,
            query,
            totalScripts: scripts.size,
            totalObjects: objects.size,
            lastScanAt,
            manifest: buildManifest(),
            objects: buildObjects(),
            selected: result.selected.map((item) => ({
                className: item.script.className,
                name: item.script.name,
                path: item.script.path,
                size: item.script.size,
                score: item.score,
                signals: item.signals,
                source: item.script.source
            }))
        });
    } catch (error) {
        console.error("❌ Error obteniendo contexto:", error);
        return res.status(500).json({ ok: false, error: "Error obteniendo contexto." });
    }
});

app.get("/project-summary", (_req, res) => {
    return res.json({
        ok: true,
        totalScripts: scripts.size,
        totalObjects: objects.size,
        lastScanAt,
        manifest: buildManifest(),
        objects: buildObjects()
    });
});

const server = app.listen(PORT, HOST, () => {
    console.log("=================================");
    console.log("🔎 ROBLOX PROJECT CONTEXT SERVER");
    console.log("=================================");
    console.log(`Contexto: http://${HOST}:${PORT}`);
    console.log("Scripts + RemoteEvent + RemoteFunction detectados.");
    console.log("=================================\n");
});

server.on("error", (error) => {
    console.error("❌ Project Context no pudo abrir el servidor:", error);
    console.error("   Puerto:", PORT);
    console.error("   Host:", HOST);
    process.exitCode = 1;
});

server.on("close", () => {
    console.error("⚠️ Project Context cerró el listener HTTP inesperadamente.");
});

process.on("uncaughtException", (error) => {
    console.error("❌ uncaughtException en Project Context:", error);
});

process.on("unhandledRejection", (reason) => {
    console.error("❌ unhandledRejection en Project Context:", reason);
});
