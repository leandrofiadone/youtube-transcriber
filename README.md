# 🎥 Transcriptor de Videos de YouTube

Aplicación simple para transcribir videos de YouTube usando Node.js, Express y @xenova/transformers.

## 📋 Requisitos

- Node.js (versión 16 o superior)
- npm o yarn

## 🚀 Instalación y Ejecución

### Backend

1. Navega a la carpeta del backend:
```bash
cd backend
```

2. Instala las dependencias:
```bash
npm install
```

3. Inicia el servidor de desarrollo:
```bash
npm run dev
```

El servidor estará corriendo en `http://localhost:3001`

### Frontend

1. Navega a la carpeta del frontend:
```bash
cd frontend
```

2. Abre el archivo `index.html` en tu navegador:
   - Puedes hacer doble clic en el archivo
   - O usar un servidor local como Live Server de VS Code
   - O usar Python: `python -m http.server 8000`

## 📖 Uso

1. Asegúrate de que el backend esté corriendo en el puerto 3001
2. Abre el frontend en tu navegador
3. Pega la URL de un video de YouTube
4. Haz clic en "Transcribir Video"
5. Espera a que se descargue el audio y se transcriba
6. La transcripción aparecerá en pantalla

## 🛠️ Scripts Disponibles

### Backend

- `npm run dev` - Ejecuta el servidor en modo desarrollo con ts-node
- `npm run build` - Compila TypeScript a JavaScript
- `npm start` - Ejecuta el servidor compilado

## 📁 Estructura del Proyecto

```
youtube-transcriber/
├── backend/
│   ├── src/
│   │   └── index.ts          # Servidor Express
│   ├── package.json
│   └── tsconfig.json
├── frontend/
│   └── index.html            # Interfaz web con JS inline
└── README.md
```

## 🔧 Tecnologías Utilizadas

### Backend
- **Express**: Servidor web
- **TypeScript**: Tipado estático
- **ytdl-core**: Descarga de audio de YouTube
- **CORS**: Habilitación de peticiones cross-origin

### Frontend
- **HTML5**: Estructura
- **JavaScript Vanilla**: Lógica
- **@xenova/transformers**: Transcripción de audio en el navegador
- **Whisper Tiny**: Modelo de ML para transcripción

## ⚠️ Notas Importantes

- La primera vez que uses la aplicación, el modelo de transcripción se descargará automáticamente (puede tardar unos minutos)
- El modelo Whisper Tiny es pequeño y rápido, pero puede no ser tan preciso como versiones más grandes
- Algunos videos de YouTube pueden no estar disponibles para descarga
- La transcripción se realiza completamente en tu navegador

## 🐛 Solución de Problemas

**Error de CORS:**
- Verifica que el backend esté corriendo en el puerto 3001
- Asegúrate de que CORS esté habilitado en el backend

**Error al descargar video:**
- Verifica que la URL sea válida
- Algunos videos pueden tener restricciones de descarga

**La transcripción es lenta:**
- Es normal la primera vez (descarga del modelo)
- Videos más largos tardan más en transcribirse
- Puedes usar un modelo más grande para mejor precisión (edita el código frontend)

## 📝 Licencia

MIT
