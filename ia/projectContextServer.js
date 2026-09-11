import "dotenv/config";
import express from "express";

const app = express();
const PORT = Number(process.env.PROJECT_CONTEXT_PORT || 3001);
const MAX_SOURCE_CHARS = 350000;
const MAX_SCRIPTS = 1200;
const MAX_OBJECTS = 2000;

app.use(express.json({ limit: "20mb" }));

const scripts = new Map();
const objects = new Map();
let lastScanAt = 0;

function shouldIgnore(item) {
    const text = `${item?.name || ""} ${item?.path || ""}`.toLowerCase();
    return (
        text.includes("geminibridgeplugin") ||
        text.includes("roblox ai bridge") ||
        text.includes("projectcontext") ||
        text.includes("project context")
    );
}

function normalizeScript(raw) {
    if (!raw || typeof raw !== "object") return null;

    const className = String(raw.className || "").trim();
    if (!["Script", "LocalScript", "ModuleScript"].includes(className)) return null;

    const name = String(raw.name || "").trim();
    const path = String(raw.path || "").trim();
    const source = String(raw.source || "");

    if (!name || !path || source.length > MAX_SOURCE_CHARS || path.includes("..")) return null;
    if (shouldIgnore({ name, path })) return null;

    return { className, name, path, source, size: source.length };
}

function normalizeObject(raw) {
    if (!raw || typeof raw !== "object") return null;
    const className = String(raw.className || "").trim();
    if (!["RemoteEvent", "RemoteFunction"].includes(className)) return null;

    const name = String(raw.name || "").trim();
    const path = String(raw.path || "").trim();
    if (!name || !path || path.includes("..") || shouldIgnore({ name, path })) return null;

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
        ["remote", "remoteevent", "remotefunction", "event", "function"]
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
    return [...scripts.values()].map((script) => ({
        className: script.className,
        name: script.name,
        path: script.path,
        size: script.size
    }));
}

function buildObjects() {
    return [...objects.values()];
}

function selectRelevantScripts(query) {
    const queryTerms = expandTerms(tokenize(query));
    const ranked = [...scripts.values()].map((script) => {
        const scored = scoreScript(script, queryTerms);
        return { script, score: scored.score, signals: scored.signals };
    });

    ranked.sort((a, b) => b.score - a.score || `${a.script.path}/${a.script.name}`.localeCompare(`${b.script.path}/${b.script.name}`));

    const selected = ranked.filter((item) => item.score > 0).slice(0, 16);
    const selectedKeys = new Set(selected.map((item) => `${item.script.path}/${item.script.name}`));

    for (const candidate of ranked) {
        if (selected.length >= 20) break;
        if (candidate.score > 0) continue;

        const referenced = selected.some((item) => {
            const source = item.script.source.toLowerCase();
            return source.includes(candidate.script.name.toLowerCase());
        });

        const key = `${candidate.script.path}/${candidate.script.name}`;
        if (referenced && !selectedKeys.has(key)) {
            selected.push(candidate);
            selectedKeys.add(key);
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
            }
        }

        if (scripts.size > MAX_SCRIPTS) {
            const keys = [...scripts.keys()].sort();
            while (keys.length > MAX_SCRIPTS) scripts.delete(keys.pop());
        }

        if (objects.size > MAX_OBJECTS) {
            const keys = [...objects.keys()].sort();
            while (keys.length > MAX_OBJECTS) objects.delete(keys.pop());
        }

        lastScanAt = Date.now();
        console.log(`🔎 Escaneo: +${accepted} scripts | ${scripts.size} scripts | ${objects.size} remotes.`);

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

app.listen(PORT, () => {
    console.log("=================================");
    console.log("🔎 ROBLOX PROJECT CONTEXT SERVER");
    console.log("=================================");
    console.log(`Contexto: http://127.0.0.1:${PORT}`);
    console.log("Scripts + RemoteEvent + RemoteFunction detectados.");
    console.log("=================================\n");
});
