# Roblox AI Bridge

Puente Node.js para Roblox Studio con **OmniRoute como único proveedor**. OmniRoute expone una API compatible con OpenAI y con `model=auto` se encarga de seleccionar el proveedor/modelo disponible.

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

PORT=3000
PROJECT_CONTEXT_PORT=3001
PROJECT_CONTEXT_HOST=0.0.0.0
```

La `OMNIROUTE_API_KEY` es la clave generada en OmniRoute en **Endpoints / Claves registradas**. No guardes la clave real en Git.

No subas `.env` al repositorio.

## Ejecución

Desde `ia/`:

```bash
npm install
npm start
```

El servidor queda en `http://127.0.0.1:3000` y el contexto del proyecto en `http://127.0.0.1:3001`.

## Flujo de programación

Usuario → Roblox AI Bridge → **OmniRoute (`model=auto`)** → proveedor/modelo seleccionado → análisis del proyecto real → cambios → validación → Roblox Studio.

No existe fallback directo a otro proveedor: si OmniRoute no está disponible, el Bridge informa del error en lugar de cambiar de proveedor por su cuenta.

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

El bridge acepta acciones extendidas para trabajar con objetos de Roblox:

- `create_instance`
- `delete_instance`
- `set_property`
- `set_properties`
- `rename_instance`
- `move_instance`

Las acciones extendidas pueden crear y configurar objetos como `Part`, `MeshPart`, `Model`, `Tool`, `RemoteEvent`, `RemoteFunction`, `Folder`, GUI, `Attachment`, `Motor6D` y otros tipos soportados por el plugin.

Para propiedades se admiten valores normales y valores tipados como `Vector2`, `Vector3`, `Color3`, `CFrame`, `UDim2`, `BrickColor` y `Enum`.

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
