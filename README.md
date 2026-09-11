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

El servidor queda en `http://127.0.0.1:3000`.

## Flujo de programación

Usuario → Groq/Qwen analiza y razona → identifica los archivos reales del Project Context → genera los cambios completos → el bridge valida las acciones → Roblox Studio consulta `/next`.

Las acciones de programación usan:

- `create_script`
- `create_local_script`
- `create_module_script`
- `update_script`
- `update_local_script`
- `update_module_script`
- `delete_script`
- `delete_local_script`
- `delete_module_script`
- `create_folder`
- `delete_folder`

Cuando se modifica un sistema existente, Qwen recibe el manifest y el SOURCE real de los archivos relevantes. El bridge vuelve a comprobar `path + name + ClassName` antes de entregar las acciones para evitar crear un script que ya existe o modificar el tipo equivocado.

## Animaciones R6

Las animaciones también se generan con `qwen/qwen3.6-27b`, usando reasoning y salida JSON. El pipeline conserva la calibración R6, la memoria de referencias y la validación de partes/keyframes.

## Endpoints

- `GET /` estado general del bridge.
- `GET /health` estado de configuración de Groq.
- `POST /r6-calibration` recibe la calibración R6.
- `GET /r6-calibration` devuelve la calibración actual.
- `POST /selected-script` recibe el script seleccionado desde Roblox Studio.
- `GET /next` entrega y limpia las acciones pendientes para Roblox Studio.
