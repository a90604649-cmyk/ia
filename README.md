# Roblox AI Bridge

Puente Node.js para Roblox Studio con un único proveedor de IA: **Groq + Qwen 3.6 27B**.

El mismo modelo se usa para conversación, razonamiento, corrección de bugs y programación de sistemas Roblox/Luau.

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

El servidor principal queda en `http://127.0.0.1:3000` y el contexto del proyecto en `http://127.0.0.1:3001`.

## Plugin

El plugin actualizado está en `ia/RobloxAIBridgePlugin.lua`.

Reemplaza el código del plugin antiguo por ese archivo. Ya no usa Gemini, OpenRouter ni DeepSeek.

## Capacidades

Qwen recibe el contexto real del proyecto y puede preparar acciones para:

- crear, actualizar y eliminar `Script`, `LocalScript` y `ModuleScript`;
- crear y eliminar `RemoteEvent` y `RemoteFunction`;
- crear y eliminar carpetas;
- modificar varios scripts de un mismo sistema cuando sea necesario.

El plugin aplica `path + name + ClassName` y no pisa un script existente mediante `create_*`.

## Flujo

Usuario → Groq/Qwen razona → Project Context aporta el SOURCE real → Qwen genera acciones → bridge valida → Roblox Studio aplica los cambios.

Las respuestas programáticas incluyen `reply` para indicar qué se diagnosticó y qué se cambió, además de `actions` para ejecutar los cambios reales.
