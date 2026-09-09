import "dotenv/config";
import express from "express";

const app = express();
const PORT = Number(process.env.PROJECT_CONTEXT_PORT || 3001);
const MAX_SOURCE_CHARS = 350000;
const MAX_SCRIPTS = 1000;

app.use(express.json({ limit: "20mb" }));

const scripts = new Map();
let lastScanAt = 0;

function shouldIgnoreScript(script) {
    const text = `${script?.name || ""} ${script?.path || ""}`.toLowerCase();

    return (
        text.includes("geminibridgeplugin") ||
        text.includes("roblox ai bridge") ||
        text.includes("projectcontext") ||
        text.includes("project context")
    );
}

function normalizeScript(script) {
    if (!script || typeof script !== "object") {
        return null;
    }

    const className = String(script.className || "").trim();
    const allowed = new Set(["Script", "LocalScript", "ModuleScript"]);

    if (!allowed.has(className)) {
        return null;
    }

    const name = String(script.name || "").trim();
    const path = String(script.path || "").trim();
    const source = String(script.source || "");

    if (!name || !path || !source || source.length > MAX_SOURCE_CHARS) {
        return null;
    }

    if (path.includes("..") || shouldIgnoreScript({ name, path })) {
        return null;
    }

    return {
        className,
        name,
        path,
        source,
        size: source.length
    };
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
        ["correr", "corre", "correr", "sprint", "run", "running", "stamina", "walkspeed", "movement", "velocidad", "shift"],
        ["combate", "combat", "ataque", "attack", "punch", "hit", "damage", "block", "fighting"],
        ["inventario", "inventory", "item", "items", "backpack", "hotbar"],
        ["salto", "jump", "jumping", "air", "doublejump"],
        ["animacion", "animation", "animate", "anim", "keyframe", "pose"],
        ["herramienta", "tool", "equip", "equipped", "handle"],
        ["energia", "energy", "stamina", "fatigue", "regen", "regeneration"]
    ];

    for (const group of groups) {
        const matched = group.some((term) => result.has(term));
        if (matched) {
            for (const term of group) {
                result.add(term);
            }
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

    if (script.className === "LocalScript") {
        score += 2;
    }

    if (script.className === "ModuleScript") {
        score += 1;
    }

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

function selectRelevantScripts(query) {
    const queryTerms = expandTerms(tokenize(query));

    const ranked = Array.from(scripts.values()).map((script) => {
        const scored = scoreScript(script, queryTerms);
        return {
            script,
            score: scored.score,
            signals: scored.signals
        };
    });

    ranked.sort((a, b) => b.score - a.score || a.script.path.localeCompare(b.script.path));

    const positive = ranked.filter((item) => item.score > 0);
    const selected = positive.slice(0, 12);

    // Include likely companion modules referenced by the selected scripts.
    const selectedNames = new Set(selected.map((item) => item.script.name.toLowerCase()));

    for (const candidate of ranked) {
        if (selected.length >= 18) {
            break;
        }

        if (candidate.score > 0) {
            continue;
        }

        const candidateName = candidate.script.name.toLowerCase();
        const referenced = selected.some((item) =>
            item.script.source.toLowerCase().includes(candidateName)
        );

        if (referenced && !selectedNames.has(candidateName)) {
            selected.push(candidate);
            selectedNames.add(candidateName);
        }
    }

    return {
        queryTerms: [...queryTerms],
        selected
    };
}

app.post("/project-scan", (req, res) => {
    try {
        const body = req.body;

        if (!body || !Array.isArray(body.scripts)) {
            return res.status(400).json({
                ok: false,
                error: "Se esperaba scripts[]."
            });
        }

        if (body.reset === true) {
            scripts.clear();
        }

        let accepted = 0;
        let rejected = 0;

        for (const rawScript of body.scripts) {
            const script = normalizeScript(rawScript);

            if (!script) {
                rejected += 1;
                continue;
            }

            scripts.set(script.path, script);
            accepted += 1;
        }

        if (scripts.size > MAX_SCRIPTS) {
            const entries = Array.from(scripts.entries());
            entries.sort((a, b) => a[0].localeCompare(b[0]));

            while (entries.length > MAX_SCRIPTS) {
                const [path] = entries.pop();
                scripts.delete(path);
            }
        }

        lastScanAt = Date.now();

        console.log(
            `🔎 Escaneo recibido: +${accepted} scripts, ${scripts.size} almacenados, ${rejected} rechazados.`
        );

        return res.json({
            ok: true,
            accepted,
            rejected,
            totalScripts: scripts.size
        });
    } catch (error) {
        console.error("❌ Error procesando escaneo:", error);

        return res.status(500).json({
            ok: false,
            error: "Error procesando el escaneo del proyecto."
        });
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
        console.error("❌ Error obteniendo contexto del proyecto:", error);

        return res.status(500).json({
            ok: false,
            error: "Error obteniendo el contexto del proyecto."
        });
    }
});

app.get("/project-summary", (_req, res) => {
    return res.json({
        ok: true,
        totalScripts: scripts.size,
        lastScanAt,
        manifest: buildManifest()
    });
});

app.listen(PORT, () => {
    console.log("=================================");
    console.log("🔎 ROBLOX PROJECT CONTEXT SERVER");
    console.log("=================================");
    console.log(`Contexto: http://127.0.0.1:${PORT}`);
    console.log("Escaneo de Script / LocalScript / ModuleScript activado.");
    console.log("=================================\n");
});
