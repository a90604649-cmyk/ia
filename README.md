# Roblox AI Bridge

Puente Node.js para Roblox Studio con tres rutas:

- Gemini: conversación normal y preparación de tareas.
- DeepSeek V4 Pro-0813 por NVIDIA: programación de Roblox/Luau.
- Pipeline Gemini existente: generación de animaciones R6.

## Configuración

Usa Node.js 18 o superior.

Crea `ia/.env` a partir de `ia/.env.example`:

```env
GEMINI_API_KEY=
NVIDIA_API_KEY=
GEMINI_CHAT_MODEL=gemini-3.6-flash
DEEPSEEK_REASONING=high
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

Usuario → Gemini interpreta la petición → DeepSeek V4 Pro implementa → el bridge convierte la respuesta en acciones → Roblox Studio consulta `/next`.

Las acciones de programación usan:

- `create_script`
- `create_local_script`
- `create_module_script`

Cuando se modifica un sistema, DeepSeek recibe la instrucción de devolver los archivos completos afectados usando la misma ruta y nombre.

## Endpoints

- `GET /` estado general del bridge.
- `GET /health` estado de configuración.
- `POST /r6-calibration` recibe la calibración R6.
- `GET /r6-calibration` devuelve la calibración actual.
- `GET /next` entrega y limpia las acciones pendientes para Roblox Studio.
