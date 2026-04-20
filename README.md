# MoesConverterMp4-Mp3

Convertidor **MP4 → MP3** profesional. Rápido, privado, con UI premium.

- **Frontend:** Astro 5 + Tailwind CSS
- **Backend:** Node.js + Express + TypeScript
- **Motor de conversión:** FFmpeg (`fluent-ffmpeg` + `libmp3lame`)
- **Progreso real:** Server-Sent Events (SSE)
- **Docker:** listo para levantar con un solo comando

---

## ✨ Funcionalidad

- Dropzone con drag & drop y selector.
- Validación de tipo de archivo (solo video) y tamaño (1 GB por defecto).
- Upload real con progreso de subida (`XMLHttpRequest`).
- Análisis del video con `ffprobe` (nombre, tamaño, duración).
- Conversión real con FFmpeg a MP3 192 kbps.
- Progreso en vivo mediante SSE emitidos por FFmpeg.
- Renombrar el archivo antes de descargar.
- Descarga directa y borrado automático del archivo temporal.
- Limpieza periódica de archivos caducados (TTL 15 min por defecto).

---

## 📁 Estructura

```
MoesConverterMp4-Mp3/
├── backend/                 # Express + FFmpeg (TypeScript)
│   ├── src/
│   │   ├── config.ts
│   │   ├── server.ts
│   │   ├── routes/convert.ts
│   │   ├── services/ffmpeg.ts
│   │   ├── services/jobs.ts
│   │   └── utils/cleanup.ts
│   ├── Dockerfile
│   ├── package.json
│   ├── tsconfig.json
│   └── .env.example
├── frontend/                # Astro + Tailwind
│   ├── src/
│   │   ├── components/Converter.astro
│   │   ├── layouts/Layout.astro
│   │   ├── pages/index.astro
│   │   ├── scripts/converter.ts
│   │   └── styles/global.css
│   ├── public/favicon.svg
│   ├── astro.config.mjs
│   ├── tailwind.config.mjs
│   ├── Dockerfile
│   ├── package.json
│   └── .env.example
├── docker-compose.yml
├── package.json             # Scripts raíz (concurrently)
└── README.md
```

---

## 🚀 Requisitos

- **Node.js ≥ 20**
- **FFmpeg** instalado en el sistema y disponible en el PATH.
  Comprobar: `ffmpeg -version`.
  - Windows: https://www.gyan.dev/ffmpeg/builds/
  - macOS: `brew install ffmpeg`
  - Linux: `sudo apt install ffmpeg`
  - (o usa Docker y olvídate)

---

## 🛠️ Desarrollo local (sin Docker)

```bash
# 1. Clonar / entrar al directorio
cd MoesConverterMp4-Mp3

# 2. Variables de entorno
cp backend/.env.example backend/.env
cp frontend/.env.example frontend/.env

# 3. Instalar dependencias (raíz, backend y frontend)
npm run install:all

# 4. Arrancar ambos en paralelo (backend :4000, frontend :4321)
npm run dev
```

Abre [http://localhost:4321](http://localhost:4321).

### Arrancarlos por separado

```bash
# terminal 1
cd backend && npm install && npm run dev

# terminal 2
cd frontend && npm install && npm run dev
```

---

## 🐳 Docker (recomendado)

```bash
docker compose up --build
```

- Frontend → http://localhost:4321
- Backend  → http://localhost:4000/health

La imagen del backend incluye FFmpeg, así que no necesitas instalarlo en tu máquina.

Parar:

```bash
docker compose down
```

---

## 🔌 API del backend

Base URL: `http://localhost:4000`

| Método  | Ruta                     | Descripción                                                    |
|---------|--------------------------|----------------------------------------------------------------|
| `GET`   | `/health`                | Healthcheck.                                                  |
| `POST`  | `/api/upload`            | Sube un video (`multipart/form-data`, campo `file`). Devuelve metadatos. |
| `GET`   | `/api/convert/:jobId`    | Stream SSE. Dispara la conversión y emite `progress`/`done`/`error`. |
| `GET`   | `/api/download/:jobId`   | Descarga el MP3. Soporta `?filename=nombre`.                  |
| `GET`   | `/api/jobs/:jobId`       | Estado del job.                                               |
| `DELETE`| `/api/jobs/:jobId`       | Cancela y borra archivos temporales.                          |

### Ejemplo SSE

```
event: progress
data: {"progress": 42.1}

event: done
data: {"jobId": "abc123"}
```

---

## ⚙️ Variables de entorno

### Backend (`backend/.env`)

| Variable         | Default                    | Descripción                                          |
|------------------|----------------------------|------------------------------------------------------|
| `PORT`           | `4000`                     | Puerto del servidor.                                |
| `CORS_ORIGIN`    | `http://localhost:4321`    | Orígenes permitidos (lista separada por comas o `*`). |
| `MAX_FILE_SIZE`  | `1073741824` (1 GB)        | Tamaño máximo por upload, en bytes.                 |
| `FILE_TTL_MS`    | `900000` (15 min)          | TTL de archivos temporales.                         |
| `FFMPEG_PATH`    | *(auto)*                   | Ruta al binario de `ffmpeg` si no está en PATH.     |

### Frontend (`frontend/.env`)

| Variable         | Default                    | Descripción                                          |
|------------------|----------------------------|------------------------------------------------------|
| `PUBLIC_API_URL` | `http://localhost:4000`    | URL pública del backend (se inyecta en build).      |

---

## 🚢 Deploy sugerido

### Backend → Railway / Render / Fly.io

- Railway/Render detectan `Dockerfile` automáticamente.
- Configura variables `PORT`, `CORS_ORIGIN` (dominio del frontend), `MAX_FILE_SIZE`, `FILE_TTL_MS`.
- El contenedor instala FFmpeg (`apk add ffmpeg`). No necesitas más.

### Frontend → Vercel / Netlify

- Build command: `npm install && npm run build`
- Output dir: `dist`
- Environment: `PUBLIC_API_URL=https://tu-backend.example.com`
- Root directory: `frontend/`

Con `netlify.toml` o `vercel.json` puedes afinar headers/caché.

---

## 🧠 Arquitectura resumida

1. Usuario suelta el archivo → `POST /api/upload` (multer + ffprobe).
2. Backend crea un **Job** en memoria (`Map<jobId, Job>`), responde con metadatos.
3. El frontend abre un `EventSource` a `/api/convert/:jobId`.
4. Backend ejecuta FFmpeg y emite `progress` a través de SSE.
5. Al terminar, frontend descarga con `/api/download/:jobId`.
6. Backend borra los archivos tras la descarga (o al expirar el TTL).

### Escalabilidad futura

- Sustituir el `Map` en memoria por Redis o una cola (BullMQ, SQS) para multi-instancia.
- Guardar los MP3 en S3/R2 y devolver URLs firmadas.
- Añadir autenticación, límites por usuario/IP y webhooks.
- Integrar transcodificación por lotes o formatos adicionales (WAV, FLAC, AAC).

---

## 📝 Licencia

MIT
