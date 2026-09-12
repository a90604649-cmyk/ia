# Roblox AI Bridge

Puente Node.js para Roblox Studio con **OmniRoute** como gateway principal compatible con OpenAI. OmniRoute recibe las peticiones en formato OpenAI y puede seleccionar automáticamente el proveedor/modelo mediante `auto`; el bridge conserva Groq directo como respaldo cuando OmniRoute no responde.

El mismo flujo sirve para conversación, razonamiento de programación, corrección de bugs, creación de sistemas, cambios en varios scripts y generación de animaciones R6.

## Configuración

Usa Node.js 18 o superior.

Crea `ia/.env` a partir de `ia/.env.example`:

```env
OMNIROUTE_API_KEY=tu_clave_de_omniroute
OMNIROUTE_URL=http://127.0.0.1:20128/v1/chat/completions
OMNIROUTE_MODEL=auto
OMNIROUTE_ENABLED=true
OMNIROUTE_TIMEOUT_MS=300000
OMNIROUTE_PROGRESS=true
OMNIROUTE_FALLBACK_TO_GROQ=true

# Opcional: respaldo directo si OmniRoute está apagado o no responde.
GROQ_API_KEY=tu_clave_de_groq
GROQ_API_KEYS=
GROQ_MODEL=qwen/qwen3.6-27b
GROQ_REASONING_EFFORT=default
GROQ_REASONING_FORMAT=hidden
GROQ_MAX_OUTPUT_TOKENS=16384
GROQ_TIMEOUT_MS=300000
PROJECT_CONTEXT_PORT=3001
```

La `OMNIROUTE_API_KEY` es la clave que OmniRoute genera en **Dashboard → Endpoints / Claves registradas**. No se debe guardar la clave real en Git.

Por defecto OmniRoute se espera en `http://127.0.0.1:20128/v1/chat/completions`, que corresponde al API local de OmniRoute.

No subas `.env` al repositorio.

## Ejecución

Desde `ia/`:

```bash
npm install
npm start
```

El servidor queda en `http://127.0.0.1:3000` y el contexto del proyecto en `http://127.0.0.1:3001`.

## Flujo de programación

Usuario → Roblox AI Bridge → **OmniRoute (`model=auto`)** → proveedor/modelo seleccionado por OmniRoute → análisis del proyecto real → cambios → validación → Roblox Studio.

Si OmniRoute no responde y `OMNIROUTE_FALLBACK_TO_GROQ=true`, el bridge conserva el flujo anterior y envía la petición directamente a Groq.

## Scripts

- `create_script`
- `create_local_script`
- `create_module_script`
- `update_script`
- `update_local_script`
- `update_module_script`
- `delete_script`
- `delete_local_script`
- `delete_module_script`

## Remotes y carpetas

- `create_remote_event`
- `create_remote_function`
- `delete_remote_event`
- `delete_remote_function`
- `create_folder`
- `delete_folder`

## Instancias y propiedades

El bridge también acepta acciones extendidas para trabajar con objetos de Roblox sin romper el formato anterior:

- `create_instance`
- `delete_instance`
- `set_property`
- `set_properties`
- `rename_instance`
- `move_instance`

Las acciones extendidas pueden crear y configurar objetos como `Part`, `MeshPart`, `Model`, `Tool`, `RemoteEvent`, `RemoteFunction`, `Folder`, GUI, `Attachment`, `Motor6D` y otros tipos soportados por el plugin.

Para propiedades se admiten valores normales y valores tipados como `Vector2`, `Vector3`, `Color3`, `CFrame`, `UDim2`, `BrickColor` y `Enum`.

Ejemplos de tareas que la IA puede preparar:

- Deshabilitar o habilitar un `Script` o `LocalScript` usando `Enabled`.
- Cambiar `Transparency`, `Anchored`, `CanCollide`, `Position`, `Size`, `Color`, `Material` y otras propiedades públicas válidas.
- Mover un objeto a otra carpeta.
- Renombrar objetos.
- Crear una carpeta y organizar remotes dentro de ella.
- Crear un objeto y establecer sus propiedades en la misma acción.

Cuando se modifica un objeto existente se comprueba `path + name + ClassName` para evitar tocar el objeto equivocado.

## Project Context

El plugin escanea `Script`, `LocalScript`, `ModuleScript` y un catálogo limitado de objetos importantes para que la IA conozca las rutas reales del proyecto. El escaneo inicial ocurre al conectar y el automático está limitado a una actualización cada 5 minutos.

## Animaciones R6

El pipeline de animaciones R6 conserva la calibración y memoria existentes del proyecto.

## Endpoints

- `GET /` estado general del bridge.
- `GET /health` estado de configuración del proveedor.
- `POST /r6-calibration` recibe la calibración R6.
- `GET /r6-calibration` devuelve la calibración actual.
- `POST /selected-script` recibe el script seleccionado desde Roblox Studio.
- `GET /next` entrega y limpia las acciones pendientes para Roblox Studio.
- `POST /project-scan` recibe el escaneo del proyecto.
- `GET /project-context` devuelve el contexto relevante para una petición.
