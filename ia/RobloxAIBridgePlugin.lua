local HttpService = game:GetService("HttpService")
local ScriptEditorService = game:GetService("ScriptEditorService")
local ChangeHistoryService = game:GetService("ChangeHistoryService")

local BASE_URL = "http://127.0.0.1:3000"
local NEXT_URL = BASE_URL .. "/next"
local HEALTH_URL = BASE_URL .. "/health"
local PROJECT_SCAN_URL = "http://127.0.0.1:3001/project-scan"

local toolbar = plugin:CreateToolbar("Roblox AI")
local button = toolbar:CreateButton(
    "Roblox AI",
    "Conectar Roblox Studio con Groq + Qwen",
    ""
)
button.ClickableWhenViewportHidden = true

local conectado = false
local consultando = false
local escaneando = false
local ultimoEscaneo = 0
local INTERVALO_ESCANEO = 20
local MAX_SOURCE_CHARS = 340000
local MAX_BATCH_CHARS = 700000
local MAX_SCRIPTS_PER_BATCH = 25

local SERVICIOS = {
    ServerScriptService = game:GetService("ServerScriptService"),
    ServerStorage = game:GetService("ServerStorage"),
    ReplicatedStorage = game:GetService("ReplicatedStorage"),
    StarterGui = game:GetService("StarterGui"),
    StarterPlayer = game:GetService("StarterPlayer"),
    StarterPack = game:GetService("StarterPack"),
    Workspace = workspace,
    SoundService = game:GetService("SoundService"),
    Lighting = game:GetService("Lighting"),
    ReplicatedFirst = game:GetService("ReplicatedFirst"),
    Teams = game:GetService("Teams"),
    TextChatService = game:GetService("TextChatService"),
    Chat = game:GetService("Chat")
}

local BASES = {}
for nombre in pairs(SERVICIOS) do
    table.insert(BASES, nombre)
end

local TIPOS_SCRIPT = {
    create_script = "Script",
    create_local_script = "LocalScript",
    create_module_script = "ModuleScript",
    update_script = "Script",
    update_local_script = "LocalScript",
    update_module_script = "ModuleScript",
    delete_script = "Script",
    delete_local_script = "LocalScript",
    delete_module_script = "ModuleScript"
}

local TIPOS_REMOTOS = {
    create_remote_event = "RemoteEvent",
    create_remote_function = "RemoteFunction",
    delete_remote_event = "RemoteEvent",
    delete_remote_function = "RemoteFunction"
}

local function debeIgnorar(objeto)
    local nombre = string.lower(objeto.Name or "")
    local ruta = string.lower(objeto:GetFullName() or "")

    return nombre == "robloxaibridgeplugin"
        or string.find(nombre, "geminibridgeplugin", 1, true) ~= nil
        or string.find(ruta, "geminibridgeplugin", 1, true) ~= nil
        or string.find(ruta, "roblox ai bridge", 1, true) ~= nil
end

local function obtenerContenedor(ruta, crearCarpetas)
    if type(ruta) ~= "string" or ruta == "" or string.find(ruta, "..", 1, true) then
        return nil
    end

    local partes = string.split(ruta, "/")
    local actual = SERVICIOS[partes[1]]
    if not actual then
        return nil
    end

    for i = 2, #partes do
        local nombre = partes[i]
        if nombre ~= "" then
            local siguiente = actual:FindFirstChild(nombre)
            if not siguiente then
                if not crearCarpetas then
                    return nil
                end
                siguiente = Instance.new("Folder")
                siguiente.Name = nombre
                siguiente.Parent = actual
            end
            actual = siguiente
        end
    end

    return actual
end

local function obtenerRutaDesdeRaiz(objeto, raiz, nombreRaiz)
    local partes = {}
    local actual = objeto

    while actual and actual ~= raiz do
        table.insert(partes, 1, actual.Name)
        actual = actual.Parent
    end

    if actual ~= raiz then
        return nil
    end

    table.insert(partes, 1, nombreRaiz)
    return table.concat(partes, "/")
end

local function obtenerRuta(objeto)
    local padre = objeto.Parent
    if not padre then
        return nil
    end

    for nombreRaiz, raiz in pairs(SERVICIOS) do
        local ruta = obtenerRutaDesdeRaiz(padre, raiz, nombreRaiz)
        if ruta then
            return ruta
        end
    end

    return nil
end

local function obtenerSource(objeto)
    local ok, source = pcall(function()
        return ScriptEditorService:GetEditorSource(objeto)
    end)
    if ok and type(source) == "string" then
        return source
    end

    local okFallback, sourceFallback = pcall(function()
        return objeto.Source
    end)
    if okFallback and type(sourceFallback) == "string" then
        return sourceFallback
    end

    return nil
end

local function recolectarScripts()
    local resultado = {}

    for _, raiz in pairs(SERVICIOS) do
        for _, objeto in ipairs(raiz:GetDescendants()) do
            if not debeIgnorar(objeto)
                and (objeto:IsA("Script") or objeto:IsA("LocalScript") or objeto:IsA("ModuleScript")) then

                local ruta = obtenerRuta(objeto)
                local source = obtenerSource(objeto)

                if ruta and source and #source <= MAX_SOURCE_CHARS then
                    table.insert(resultado, {
                        className = objeto.ClassName,
                        name = objeto.Name,
                        path = ruta,
                        source = source
                    })
                end
            end
        end
    end

    table.sort(resultado, function(a, b)
        return (a.path .. "/" .. a.name) < (b.path .. "/" .. b.name)
    end)

    return resultado
end

local function recolectarObjetosImportantes()
    local resultado = {}
    local clases = {
        RemoteEvent = true,
        RemoteFunction = true
    }

    for _, raiz in pairs(SERVICIOS) do
        for _, objeto in ipairs(raiz:GetDescendants()) do
            if not debeIgnorar(objeto) and clases[objeto.ClassName] then
                local ruta = obtenerRuta(objeto)
                if ruta then
                    table.insert(resultado, {
                        className = objeto.ClassName,
                        name = objeto.Name,
                        path = ruta
                    })
                end
            end
        end
    end

    table.sort(resultado, function(a, b)
        return (a.path .. "/" .. a.name) < (b.path .. "/" .. b.name)
    end)

    return resultado
end

local function dividirLotes(scripts)
    local lotes = {}
    local actual = {}
    local caracteres = 0

    for _, scriptData in ipairs(scripts) do
        local costo = #scriptData.source + #scriptData.path + #scriptData.name + 150
        local superaTamano = #actual > 0 and caracteres + costo > MAX_BATCH_CHARS
        local superaCantidad = #actual >= MAX_SCRIPTS_PER_BATCH

        if superaTamano or superaCantidad then
            table.insert(lotes, actual)
            actual = {}
            caracteres = 0
        end

        table.insert(actual, scriptData)
        caracteres += costo
    end

    if #actual > 0 then
        table.insert(lotes, actual)
    end

    return lotes
end

local function enviarEscaneo(scripts, objects, reset)
    local ok, respuesta = pcall(function()
        return HttpService:RequestAsync({
            Url = PROJECT_SCAN_URL,
            Method = "POST",
            Headers = {
                ["Content-Type"] = "application/json",
                ["Accept"] = "application/json"
            },
            Body = HttpService:JSONEncode({
                reset = reset == true,
                scripts = scripts,
                objects = objects or {}
            })
        })
    end)

    if not ok or not respuesta.Success then
        warn("[Roblox AI] Error enviando contexto:", ok and respuesta.Body or respuesta)
        return false
    end

    return true
end

local function escanearProyecto()
    if escaneando or not conectado then
        return false
    end

    escaneando = true
    local scripts = recolectarScripts()
    local objects = recolectarObjetosImportantes()
    local lotes = dividirLotes(scripts)
    local correcto = true

    if #lotes == 0 then
        correcto = enviarEscaneo({}, objects, true)
    else
        for indice, lote in ipairs(lotes) do
            if not enviarEscaneo(lote, indice == 1 and objects or {}, indice == 1) then
                correcto = false
                break
            end
            task.wait(0.05)
        end
    end

    if correcto then
        ultimoEscaneo = os.clock()
        print("[Roblox AI] ✅ Contexto actualizado:", #scripts, "scripts |", #objects, "remotos")
    end

    escaneando = false
    return correcto
end

local function comprobarServidor()
    local ok, respuesta = pcall(function()
        return HttpService:RequestAsync({
            Url = HEALTH_URL,
            Method = "GET"
        })
    end)

    if not ok or not respuesta.Success then
        warn("[Roblox AI] No se pudo conectar al servidor Groq:", ok and respuesta.Body or respuesta)
        return false
    end

    local datosOk, datos = pcall(function()
        return HttpService:JSONDecode(respuesta.Body)
    end)

    if not datosOk or type(datos) ~= "table" then
        warn("[Roblox AI] /health devolvió datos inválidos.")
        return false
    end

    if datos.ok ~= true or datos.groqConfigured ~= true then
        warn("[Roblox AI] Groq no está configurado.")
        return false
    end

    print("[Roblox AI] ✅ Groq:", tostring(datos.model))
    print("[Roblox AI] 🧠 Reasoning:", tostring(datos.reasoningEffort))
    return true
end

local function actualizarSource(objeto, code)
    local ok, err = pcall(function()
        ScriptEditorService:UpdateSourceAsync(objeto, function()
            return code
        end)
    end)

    if not ok then
        warn("[Roblox AI] No se pudo actualizar Source:", err)
        return false
    end

    return true
end

local function ejecutarScriptAction(action)
    local tipo = TIPOS_SCRIPT[action.type]
    if not tipo then
        return false
    end

    local ruta = tostring(action.path or "")
    local nombre = tostring(action.name or "")
    local existenteContenedor = obtenerContenedor(ruta, action.type:sub(1, 7) == "create_")

    if not existenteContenedor or nombre == "" then
        warn("[Roblox AI] Ruta inválida:", ruta, nombre)
        return false
    end

    local existente = existenteContenedor:FindFirstChild(nombre)

    if action.type:sub(1, 7) == "create_" then
        if existente then
            warn("[Roblox AI] CREATE rechazado: ya existe", existente:GetFullName(), existente.ClassName)
            return false
        end

        if type(action.code) ~= "string" or action.code == "" then
            return false
        end

        local nuevo = Instance.new(tipo)
        nuevo.Name = nombre
        nuevo.Source = action.code
        nuevo.Parent = existenteContenedor
        if nuevo:IsA("Script") or nuevo:IsA("LocalScript") then
            nuevo.Enabled = true
        end
        print("[Roblox AI] ✅ CREADO:", nuevo:GetFullName())
        ChangeHistoryService:SetWaypoint("Groq crear " .. nombre)
        return true
    end

    if action.type:sub(1, 7) == "update_" then
        if not existente or existente.ClassName ~= tipo then
            warn("[Roblox AI] UPDATE rechazado:", ruta .. "/" .. nombre)
            return false
        end

        if type(action.code) ~= "string" or action.code == "" then
            return false
        end

        if actualizarSource(existente, action.code) then
            if existente:IsA("Script") or existente:IsA("LocalScript") then
                existente.Enabled = true
            end
            print("[Roblox AI] ✏️ ACTUALIZADO:", existente:GetFullName())
            ChangeHistoryService:SetWaypoint("Groq actualizar " .. nombre)
            return true
        end

        return false
    end

    if action.type:sub(1, 7) == "delete_" then
        if not existente or existente.ClassName ~= tipo then
            warn("[Roblox AI] DELETE rechazado:", ruta .. "/" .. nombre)
            return false
        end

        local fullName = existente:GetFullName()
        existente:Destroy()
        print("[Roblox AI] 🗑️ ELIMINADO:", fullName)
        ChangeHistoryService:SetWaypoint("Groq eliminar " .. nombre)
        return true
    end

    return false
end

local function ejecutarRemoteAction(action)
    local clase = TIPOS_REMOTOS[action.type]
    if not clase then
        return false
    end

    local ruta = tostring(action.path or "")
    local nombre = tostring(action.name or "")
    local contenedor = obtenerContenedor(ruta, action.type:sub(1, 7) == "create_")

    if not contenedor or nombre == "" then
        return false
    end

    local existente = contenedor:FindFirstChild(nombre)

    if action.type:sub(1, 7) == "create_" then
        if existente then
            if existente.ClassName == clase then
                print("[Roblox AI] ℹ️ Ya existe:", existente:GetFullName())
                return true
            end
            warn("[Roblox AI] CREATE REMOTE rechazado: ya existe otro objeto con ese nombre.")
            return false
        end

        local nuevo = Instance.new(clase)
        nuevo.Name = nombre
        nuevo.Parent = contenedor
        print("[Roblox AI] ✅ CREADO:", nuevo:GetFullName(), "(" .. clase .. ")")
        ChangeHistoryService:SetWaypoint("Groq crear " .. nombre)
        return true
    end

    if not existente or existente.ClassName ~= clase then
        warn("[Roblox AI] DELETE REMOTE rechazado:", ruta .. "/" .. nombre)
        return false
    end

    existente:Destroy()
    print("[Roblox AI] 🗑️ REMOTO ELIMINADO:", ruta .. "/" .. nombre)
    ChangeHistoryService:SetWaypoint("Groq eliminar " .. nombre)
    return true
end

local function ejecutarCarpeta(action)
    local ruta = tostring(action.path or "")
    local nombre = tostring(action.name or "")

    if nombre == "" or string.find(nombre, "/", 1, true) or string.find(nombre, "\\", 1, true) then
        return false
    end

    if action.type == "create_folder" then
        local contenedor = obtenerContenedor(ruta, true)
        if not contenedor then
            return false
        end
        if contenedor:FindFirstChild(nombre) then
            return true
        end
        local carpeta = Instance.new("Folder")
        carpeta.Name = nombre
        carpeta.Parent = contenedor
        print("[Roblox AI] 📁 CARPETA CREADA:", carpeta:GetFullName())
        ChangeHistoryService:SetWaypoint("Groq crear carpeta " .. nombre)
        return true
    end

    if action.type == "delete_folder" then
        local contenedor = obtenerContenedor(ruta, false)
        if not contenedor then
            return false
        end
        local carpeta = contenedor:FindFirstChild(nombre)
        if not carpeta or not carpeta:IsA("Folder") then
            return false
        end
        carpeta:Destroy()
        print("[Roblox AI] 🗑️ CARPETA ELIMINADA:", ruta .. "/" .. nombre)
        ChangeHistoryService:SetWaypoint("Groq eliminar carpeta " .. nombre)
        return true
    end

    return false
end

local function ejecutarAccion(action)
    if type(action) ~= "table" then
        return
    end

    local tipo = tostring(action.type or "")
    if TIPOS_SCRIPT[tipo] then
        ejecutarScriptAction(action)
    elseif TIPOS_REMOTOS[tipo] then
        ejecutarRemoteAction(action)
    elseif tipo == "create_folder" or tipo == "delete_folder" then
        ejecutarCarpeta(action)
    else
        warn("[Roblox AI] Acción desconocida:", tipo)
    end
end

local function consultarServidor()
    if consultando or not conectado then
        return
    end

    consultando = true
    local ok, respuesta = pcall(function()
        return HttpService:RequestAsync({
            Url = NEXT_URL,
            Method = "GET"
        })
    end)
    consultando = false

    if not ok or not respuesta.Success then
        return
    end

    local jsonOk, datos = pcall(function()
        return HttpService:JSONDecode(respuesta.Body)
    end)
    if not jsonOk or type(datos) ~= "table" or type(datos.actions) ~= "table" then
        return
    end

    if #datos.actions == 0 then
        return
    end

    print("[Roblox AI] 📥 Acciones Groq:", #datos.actions)
    ChangeHistoryService:SetWaypoint("Antes de cambios Groq")

    for _, action in ipairs(datos.actions) do
        pcall(ejecutarAccion, action)
    end

    ChangeHistoryService:SetWaypoint("Cambios Groq completados")
    escanearProyecto()
end

local function iniciarLoops()
    task.spawn(function()
        while conectado do
            consultarServidor()
            task.wait(1)
        end
    end)

    task.spawn(function()
        while conectado do
            if os.clock() - ultimoEscaneo >= INTERVALO_ESCANEO then
                escanearProyecto()
            end
            task.wait(5)
        end
    end)
end

button.Click:Connect(function()
    if conectado then
        conectado = false
        button:SetActive(false)
        print("[Roblox AI] 🔌 DESCONECTADO")
        return
    end

    if not comprobarServidor() then
        return
    end

    conectado = true
    button:SetActive(true)
    print("=================================")
    print("[Roblox AI] 🟢 CONECTADO")
    print("[Roblox AI] Proveedor: Groq")
    print("[Roblox AI] Modelo: Qwen 3.6 27B")
    print("[Roblox AI] Funciones: scripts + remotes + carpetas")
    print("=================================")

    escanearProyecto()
    iniciarLoops()
end)
