--[=[
    PARCHE CRUD PARA GeminiBridgePlugin

    Permite que el bridge ejecute:
      create_script
      create_local_script
      create_module_script
      update_script
      update_local_script
      update_module_script
      delete_script
      delete_local_script
      delete_module_script
      create_folder
      delete_folder

    Este archivo reutiliza funciones que ya existen en el plugin principal:
      obtenerServicio
      obtenerContenedor
      actualizarSource
      abrirScript
      crearAnimacion
      ChangeHistoryService

    Integración:
    1. Copia este bloque dentro de GeminiBridgePlugin.
    2. Añade las funciones nuevas antes de ejecutarAccion.
    3. Sustituye la función ejecutarAccion existente por la incluida al final.
]=]

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

local function obtenerContenedorExistente(ruta)
    if type(ruta) ~= "string" or ruta == "" then
        return nil
    end

    local partes = string.split(ruta, "/")

    if #partes == 0 then
        return nil
    end

    local actual = obtenerServicio(partes[1])

    if not actual then
        return nil
    end

    for indice = 2, #partes do
        local nombre = partes[indice]

        if nombre ~= "" then
            actual = actual:FindFirstChild(nombre)

            if not actual then
                return nil
            end
        end
    end

    return actual
end

local function claseEsperadaCRUD(tipo)
    return TIPOS_SCRIPT[tipo]
end

local function esTipoCrearCRUD(tipo)
    return tipo == "create_script"
        or tipo == "create_local_script"
        or tipo == "create_module_script"
end

local function esTipoActualizarCRUD(tipo)
    return tipo == "update_script"
        or tipo == "update_local_script"
        or tipo == "update_module_script"
end

local function esTipoEliminarCRUD(tipo)
    return tipo == "delete_script"
        or tipo == "delete_local_script"
        or tipo == "delete_module_script"
end

local function ejecutarAccionCRUD(action)
    if type(action) ~= "table" then
        return
    end

    local tipo = tostring(action.type or "")
    local nombre = tostring(action.name or "")
    local ruta = tostring(action.path or "")

    if nombre == "" or ruta == "" then
        warn("[Roblox AI Bridge] Acción CRUD sin nombre o ruta.")
        return
    end

    if string.find(ruta, "..", 1, true)
        or string.find(nombre, "/", 1, true)
        or string.find(nombre, "\\", 1, true) then
        warn("[Roblox AI Bridge] Ruta/nombre CRUD inválidos:", ruta, nombre)
        return
    end

    if esTipoCrearCRUD(tipo) or esTipoActualizarCRUD(tipo) or esTipoEliminarCRUD(tipo) then
        local clase = claseEsperadaCRUD(tipo)
        local contenedor = obtenerContenedorExistente(ruta)

        if not contenedor then
            warn(
                "[Roblox AI Bridge] No existe el contenedor:",
                ruta
            )
            return
        end

        local existente = contenedor:FindFirstChild(nombre)

        if esTipoEliminarCRUD(tipo) then
            if not existente then
                warn(
                    "[Roblox AI Bridge] No se puede eliminar; no existe:",
                    ruta .. "/" .. nombre
                )
                return
            end

            if existente.ClassName ~= clase then
                warn(
                    "[Roblox AI Bridge] ELIMINACIÓN RECHAZADA: ClassName real =",
                    existente.ClassName,
                    "esperado =",
                    clase,
                    "en",
                    existente:GetFullName()
                )
                return
            end

            if string.lower(existente.Name) == "geminibridgeplugin" then
                warn("[Roblox AI Bridge] No se permite eliminar el plugin.")
                return
            end

            existente:Destroy()

            ChangeHistoryService:SetWaypoint(
                "Eliminar " .. existente.Name
            )

            print(
                "[Roblox AI Bridge] 🗑️ ELIMINADO:",
                ruta .. "/" .. nombre,
                "(" .. clase .. ")"
            )

            return
        end

        if esTipoActualizarCRUD(tipo) then
            if not existente then
                warn(
                    "[Roblox AI Bridge] No se puede actualizar; no existe:",
                    ruta .. "/" .. nombre
                )
                return
            end

            if existente.ClassName ~= clase then
                warn(
                    "[Roblox AI Bridge] ACTUALIZACIÓN RECHAZADA: ClassName real =",
                    existente.ClassName,
                    "pero la IA solicitó =",
                    clase,
                    "en",
                    existente:GetFullName()
                )
                return
            end

            if type(action.code) ~= "string" or action.code == "" then
                warn("[Roblox AI Bridge] Actualización sin code:", existente:GetFullName())
                return
            end

            if actualizarSource(existente, action.code) then
                if existente:IsA("Script") or existente:IsA("LocalScript") then
                    existente.Enabled = true
                end

                print(
                    "[Roblox AI Bridge] ✏️ ACTUALIZADO:",
                    existente:GetFullName(),
                    "(" .. clase .. ")"
                )

                abrirScript(existente)
                ChangeHistoryService:SetWaypoint(
                    "Actualizar " .. existente.Name
                )
            end

            return
        end

        -- create_*: no pisa objetos existentes. La IA debe usar update_* si quiere modificarlos.
        if existente then
            warn(
                "[Roblox AI Bridge] CREACIÓN RECHAZADA: ya existe",
                existente:GetFullName(),
                "como",
                existente.ClassName,
                ". Usa una acción update_* para modificarlo."
            )
            return
        end

        if type(action.code) ~= "string" or action.code == "" then
            warn("[Roblox AI Bridge] Creación sin code:", ruta .. "/" .. nombre)
            return
        end

        local nuevo = Instance.new(clase)
        nuevo.Name = nombre
        nuevo.Source = action.code
        nuevo.Parent = contenedor

        if nuevo:IsA("Script") or nuevo:IsA("LocalScript") then
            nuevo.Enabled = true
        end

        print(
            "[Roblox AI Bridge] ✅ CREADO:",
            nuevo:GetFullName(),
            "(" .. clase .. ")"
        )

        abrirScript(nuevo)
        ChangeHistoryService:SetWaypoint(
            "Crear " .. nuevo.Name
        )

        return
    end

    if tipo == "create_folder" then
        local contenedor = obtenerContenedorExistente(ruta)

        if not contenedor then
            warn("[Roblox AI Bridge] No existe el contenedor para crear carpeta:", ruta)
            return
        end

        if contenedor:FindFirstChild(nombre) then
            warn("[Roblox AI Bridge] La carpeta ya existe:", ruta .. "/" .. nombre)
            return
        end

        local carpeta = Instance.new("Folder")
        carpeta.Name = nombre
        carpeta.Parent = contenedor

        print(
            "[Roblox AI Bridge] 📁 CARPETA CREADA:",
            carpeta:GetFullName()
        )

        ChangeHistoryService:SetWaypoint(
            "Crear carpeta " .. carpeta.Name
        )

        return
    end

    if tipo == "delete_folder" then
        local contenedor = obtenerContenedorExistente(ruta)

        if not contenedor then
            warn("[Roblox AI Bridge] No existe el contenedor para eliminar carpeta:", ruta)
            return
        end

        local carpeta = contenedor:FindFirstChild(nombre)

        if not carpeta then
            warn("[Roblox AI Bridge] No existe la carpeta:", ruta .. "/" .. nombre)
            return
        end

        if not carpeta:IsA("Folder") then
            warn(
                "[Roblox AI Bridge] Eliminación de carpeta rechazada; no es Folder:",
                carpeta:GetFullName(),
                carpeta.ClassName
            )
            return
        end

        if string.lower(carpeta.Name) == "geminibridgeplugin" then
            warn("[Roblox AI Bridge] No se permite eliminar el plugin.")
            return
        end

        carpeta:Destroy()

        print(
            "[Roblox AI Bridge] 🗑️ CARPETA ELIMINADA:",
            ruta .. "/" .. nombre
        )

        ChangeHistoryService:SetWaypoint(
            "Eliminar carpeta " .. nombre
        )

        return
    end

    warn("[Roblox AI Bridge] Acción CRUD desconocida:", tipo)
end

-- Sustituye la función ejecutarAccion actual del plugin por esta.
local function ejecutarAccion(action)
    if type(action) ~= "table" then
        return
    end

    if action.type == "create_animation" then
        crearAnimacion(action)
        return
    end

    ejecutarAccionCRUD(action)
end

return {
    ejecutarAccionCRUD = ejecutarAccionCRUD
}
