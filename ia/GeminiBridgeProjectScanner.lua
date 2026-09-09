--[=[
    PARCHÉ DEL PLUGIN GeminiBridgePlugin

    Este archivo contiene el escaneo del proyecto que debe integrarse al
    plugin principal. Escanea Script, LocalScript y ModuleScript, excluye
    el propio plugin y envía el contenido al servicio ProjectContext en
    http://127.0.0.1:3001/project-scan.
]=]

local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")

local PROJECT_CONTEXT_URL =
    "http://127.0.0.1:3001/project-scan"

local MAX_SCRIPTS_PER_BATCH = 12
local MAX_SOURCE_CHARS = 350000

local SERVICIOS_RAIZ = {
    ServerScriptService = game:GetService("ServerScriptService"),
    ServerStorage = game:GetService("ServerStorage"),
    ReplicatedStorage = game:GetService("ReplicatedStorage"),
    StarterGui = game:GetService("StarterGui"),
    StarterPlayer = game:GetService("StarterPlayer"),
    SoundService = game:GetService("SoundService"),
    Lighting = game:GetService("Lighting"),
    Workspace = workspace
}

local function esScript(objeto)
    return objeto:IsA("Script")
        or objeto:IsA("LocalScript")
        or objeto:IsA("ModuleScript")
end

local function debeIgnorarse(objeto)
    local nombre = string.lower(objeto.Name)
    local ruta = string.lower(objeto:GetFullName())

    return nombre == "geminibridgeplugin"
        or string.find(nombre, "roblox ai bridge", 1, true) ~= nil
        or string.find(nombre, "projectcontext", 1, true) ~= nil
        or string.find(ruta, "geminibridgeplugin", 1, true) ~= nil
end

local function construirRuta(objeto)
    local partes = {}
    local actual = objeto

    while actual do
        table.insert(partes, 1, actual.Name)

        if SERVICIOS_RAIZ[actual.Name] == actual then
            break
        end

        actual = actual.Parent
    end

    if #partes == 0 then
        return nil
    end

    if not SERVICIOS_RAIZ[partes[1]] then
        return nil
    end

    table.remove(partes, #partes)
    -- Quitamos el propio nombre del script.

    return table.concat(partes, "/")
end

local function obtenerSource(objeto)
    local ok, source = pcall(function()
        return ScriptEditorService:GetEditorSource(objeto)
    end)

    if not ok or type(source) ~= "string" then
        return nil
    end

    if #source > MAX_SOURCE_CHARS then
        warn(
            "[Roblox AI Bridge] Script omitido por tamaño:",
            objeto:GetFullName(),
            #source
        )

        return nil
    end

    return source
end

local function enviarBatch(batch, reset)
    local ok, response = pcall(function()
        return HttpService:RequestAsync({
            Url = PROJECT_CONTEXT_URL,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json"
            },
            Body = HttpService:JSONEncode({
                reset = reset == true,
                scripts = batch
            })
        })
    end)

    if not ok then
        warn(
            "[Roblox AI Bridge] Error enviando batch del proyecto:",
            response
        )

        return false
    end

    if not response.Success then
        warn(
            "[Roblox AI Bridge] ProjectContext rechazó batch:",
            response.StatusCode,
            response.Body
        )

        return false
    end

    return true
end

local function escanearProyectoCompleto()
    local batch = {}
    local total = 0
    local enviados = 0
    local primerBatch = true

    print("[Roblox AI Bridge] 🔎 Escaneando scripts del proyecto...")

    for _, servicio in pairs(SERVICIOS_RAIZ) do
        for _, descendiente in ipairs(servicio:GetDescendants()) do
            if esScript(descendiente) and not debeIgnorarse(descendiente) then
                local source = obtenerSource(descendiente)
                local path = construirRuta(descendiente)

                if source and path then
                    table.insert(batch, {
                        className = descendiente.ClassName,
                        name = descendiente.Name,
                        path = path,
                        source = source
                    })

                    total += 1

                    if #batch >= MAX_SCRIPTS_PER_BATCH then
                        if not enviarBatch(batch, primerBatch) then
                            return false
                        end

                        primerBatch = false
                        enviados += #batch
                        batch = {}
                    end
                end
            end
        end
    end

    if #batch > 0 then
        if not enviarBatch(batch, primerBatch) then
            return false
        end

        enviados += #batch
    elseif primerBatch then
        -- Vacía un escaneo anterior si no encontramos scripts.
        if not enviarBatch({}, true) then
            return false
        end
    end

    print(
        "[Roblox AI Bridge] ✅ Escaneo terminado:",
        tostring(enviados),
        "scripts enviados."
    )

    return true
end

return {
    escanearProyectoCompleto = escanearProyectoCompleto
}
