# Roblox AI Bridge

Puente Node.js para Roblox Studio con un único proveedor de IA: **Groq + Qwen 3.6 27B**.

El mismo modelo se usa para conversación, razonamiento de programación, corrección de bugs, creación de sistemas, cambios en varios scripts y generación de animaciones R6.

## Configuración

Usa Node.js 18 o superior.

Crea `ia/.env` a partir de `ia/.env.example`:

```env
GROQ_API_KEY=tu_clave_de_groq
GROQ_API_KEYS=
GROQ_MODEL=qwen/qwen3.6-27b
GROQ_REASONING_EFFORT=default
GROQ_REASONING_FORMAT=hidden
GROQ_MAX_OUTPUT_TOKENS=16384
GROQ_TIMEOUT_MS=300000
PROJECT_CONTEXT_PORT=3001
```

No subas `.env` al repositorio.

## Ejecución

Desde `ia/`:

```bash
npm install
npm start
```

El servidor queda en `http://127.0.0.1:3000` y el contexto del proyecto en `http://127.0.0.1:3001`.

## Flujo de programación

Usuario → Groq/Qwen analiza y razona → identifica los objetos y archivos reales del Project Context → genera los cambios → el bridge valida y aplica las acciones en Roblox Studio.

### Scripts

- `create_script`
- `create_local_script`
- `create_module_script`
- `update_script`
- `update_local_script`
- `update_module_script`
- `delete_script`
- `delete_local_script`
- `delete_module_script`

### Remotes y carpetas

- `create_remote_event`
- `create_remote_function`
- `delete_remote_event`
- `delete_remote_function`
- `create_folder`
- `delete_folder`

### Instancias y propiedades

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

El plugin escanea `Script`, `LocalScript`, `ModuleScript` y un catálogo limitado de objetos importantes para que Qwen conozca las rutas reales del proyecto. El escaneo inicial ocurre al conectar y el automático está limitado a una actualización cada 5 minutos.

## Animaciones R6

El pipeline de animaciones R6 conserva la calibración y memoria existentes del proyecto.

## Endpoints

- `GET /` estado general del bridge.
- `GET /health` estado de configuración de Groq.
- `POST /r6-calibration` recibe la calibración R6.
- `GET /r6-calibration` devuelve la calibración actual.
- `POST /selected-script` recibe el script seleccionado desde Roblox Studio.
- `GET /next` entrega y limpia las acciones pendientes para Roblox Studio.
- `POST /project-scan` recibe el escaneo del proyecto.
- `GET /project-context` devuelve el contexto relevante para una petición.
