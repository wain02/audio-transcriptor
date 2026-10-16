# Audio Transcriptor

Next.js App Router, TypeScript y Tailwind CSS. Dos transcripciones independientes (Whisper tiny local y Google Gemini), comparación temporal, reproducción local, revisión y exportación TXT/proyecto JSON. **Sin Supabase, base de datos, almacenamiento de audio ni worker externo.**

## Cómo se usa

1. Abre la web, introduce tu contraseña de acceso, selecciona el idioma (español o inglés) y un M4A, MP3 o WAV de tu disco. La primera ejecución descarga el modelo `Xenova/whisper-tiny` desde Hugging Face, de decenas de MB, además del motor WASM. La descarga requiere conexión y puede conservarse en la caché del navegador; no incluye audio ni transcripciones. Si se borra la caché, habrá que descargarlo nuevamente.
2. Pulsa **Transcribir audio**. El navegador divide el archivo en WAV mono de 16 kHz, de hasta 90 segundos (~2,88 MB), con FFmpeg WebAssembly. Whisper tiny (multilingüe, cuantizado q8) se ejecuta en un worker del navegador con Transformers.js/ONNX Runtime. Solo Gemini recibe cada fragmento a través de Vercel. No hay llamadas a la API de OpenAI ni se necesita saldo o clave de OpenAI. El archivo completo nunca se sube.
3. Revisa las discrepancias, escucha tu audio desde 3 segundos antes y elige una versión o una corrección manual. Ninguna IA tiene prioridad.
4. **Guardar proyecto JSON** descarga ambas transcripciones, respuestas originales, decisiones y una huella SHA-256 del audio. No incluye audio, contraseñas ni claves. Puedes guardar antes de completar la revisión.
5. Para retomar otro día, usa **Abrir proyecto JSON**. Puedes seguir editando y exportando sin audio. Para escuchar, pulsa **Vincular audio** y selecciona el original; se verifica su SHA-256, tamaño y duración sin subirlo ni volver a transcribirlo. El nombre puede cambiar si el contenido sigue siendo el mismo.
6. **Exportar TXT** descarga el texto consolidado cuando todas las discrepancias están resueltas. La interfaz de exportadores permite agregar DOCX/PDF.

No hay guardado automático, localStorage ni historial en servidor. **Guarda el JSON antes de cerrar la pestaña.** Se avisa al cerrar si hay cambios o una transcripción activa. La descarga TXT no sustituye al proyecto JSON para continuar editando.

## Desplegar desde GitHub en Vercel

1. Sube todos los archivos fuente de este proyecto y `package-lock.json` al repositorio de GitHub. Publicar el entorno de Codex **no** sube estos cambios a GitHub ni despliega la web. No subas `.env.local`, `.next`, `node_modules`, audios ni `public/ffmpeg` ni `public/whisper` (se genera automáticamente).
2. En [Vercel](https://vercel.com), selecciona **Add New → Project → Import Git Repository** e importa el repositorio. Si se sube en la raíz, deja Root Directory vacío/predeterminado; si se sube en una subcarpeta, selecciónala.
3. Framework: **Next.js**. Node.js: **22.x o 24.x**. Install Command: `npm ci`. Build Command: `npm run build`. Output Directory: predeterminado. El script `postinstall` prepara los assets FFmpeg, Transformers.js y ONNX Runtime desde paquetes fijados en el lockfile; no hace falta instalar FFmpeg nativo, un bucket, un volumen ni un worker de procesamiento.
4. En **Settings → Environment Variables**, añade las dos variables server-only siguientes para Production (y Preview si lo usarás):

   | Variable              | Contenido                                                                      |
   | --------------------- | ------------------------------------------------------------------------------ |
   | `GEMINI_API_KEY`      | Tu clave de Gemini con cuota disponible                                        |
   | `APP_ACCESS_PASSWORD` | Contraseña privada larga, de al menos 16 caracteres; la introducirás en la web |

   Opcional: `GEMINI_MODEL`, por defecto `gemini-2.5-flash`. No uses el prefijo `NEXT_PUBLIC_` para estos valores. Las claves configuradas en Codex no se transfieren a Vercel.

5. Pulsa **Deploy**. Vercel proporciona el dominio `*.vercel.app`. Cada push posterior a la rama de producción activa un nuevo despliegue. Si modificas variables después de desplegar, haz **Redeploy**.
6. Prueba primero una grabación corta conocida: comprueba ambas transcripciones, revisa una diferencia, guarda el proyecto, recarga y reabre el JSON con el audio local. Comprueba el TXT.

Cada petición procesa únicamente Gemini y un fragmento; no inicia trabajos en segundo plano ni depende de que la instancia sobreviva a la respuesta. El endpoint limita cada cuerpo a 3 MB, por debajo del límite habitual de 4,5 MB de Vercel Functions. Declara `maxDuration = 300` y limita las llamadas al proveedor a 240 segundos. Comprueba en tu plan/configuración de Vercel el tiempo máximo permitido y activa Fluid Compute cuando corresponda; si el límite es menor, un proveedor lento puede agotar el tiempo. El procesamiento de toda la grabación se coordina en el navegador. `AUDIO_OPENAI_API_KEY` y `OPENAI_API_KEY` ya no se usan; puedes eliminarlas de Vercel y volver a desplegar. Los proyectos anteriores de la API de OpenAI se siguen abriendo y se identifican como tales; no se vuelven a transcribir al abrirlos.

## Desarrollo y pruebas

Requiere Node.js 20.9+; se recomienda Node 22/24 y Chrome/Edge/Firefox de escritorio reciente con WebAssembly, workers, WORKERFS y AbortSignal.any. La preparación no requiere FFmpeg nativo.

```sh
npm ci --cache /tmp/audio-transcriptor-npm-cache
cp .env.example .env.local
# Completar las dos variables en .env.local, nunca en archivos versionados
npm run dev
```

```sh
npm test
npm run typecheck
npm run build
npm start
```

Para repetir la prueba de navegador (usa proveedores simulados, sin gastar cuota ni descargar el modelo), ejecuta `npm start -- --port 3100` en otra terminal y luego:

```sh
npx playwright install chromium
npm run test:browser
# Si ya tienes Chromium instalado:
# PLAYWRIGHT_CHROMIUM_EXECUTABLE=/usr/bin/chromium npm run test:browser
```

`BASE_URL` permite apuntar a otra instancia; usa únicamente un despliegue de prueba sin datos personales. La prueba crea un audio WAV sintético de 91 segundos, ejecuta FFmpeg WASM real, simula el worker de Whisper local e intercepta únicamente las peticiones a Gemini y comprueba proyecto JSON, identificación del archivo, reproducción, correcciones y TXT. Las capturas quedan en `.test-artifacts/` y no se versionan.

Las pruebas cubren alineación/normalización, omisiones, consolidación TXT, archivos de proyecto, límites WAV, autorización y el adaptador oficial de Gemini con respuestas simuladas y el contrato de Whisper local. La prueba de navegador usa un worker local simulado; no demuestra la descarga ni la inferencia del modelo real. La validación completa requiere acceso a Hugging Face, descargar los pesos, ejecutar una grabación conocida y comparar el resultado local con Gemini. Solo la llamada a Gemini consume su cuota API.

## Privacidad y límites

- El audio original solo se abre como `File`/URL local. WORKERFS lo expone como archivo de solo lectura sin copiar ni decodificar la grabación completa en memoria. Se libera el procesador al terminar, cancelar o fallar. No se modifica ni borra el original de tu disco.
- Las funciones reciben únicamente los fragmentos temporales destinados a Gemini, en memoria. No escriben archivos, no guardan trabajos, no registran contenido ni incluyen audio en las respuestas. Al terminar cada solicitud se liberan las referencias; no se promete un borrado criptográfico de memoria. No se usan las antiguas rutas `/api/jobs` ni `.data`.
- Solo Google recibe cada fragmento para transcribirlo. Su política de retención es independiente y esta aplicación no puede borrar datos que conserve Google. Revisa su política antes de enviar información sensible. Hugging Face sirve los pesos del modelo; Whisper no envía allí el audio. La API de OpenAI ya no se utiliza. Tus proyectos JSON y TXT también pueden contener información sensible: tú controlas dónde se guardan.
- `APP_ACCESS_PASSWORD` evita que visitantes usen libremente tus claves. No es un sistema multiusuario ni sustituye límites de gasto, mitigación de abuso, WAF o autenticación avanzada. La contraseña no se guarda en disco, navegador ni proyecto; viaja por HTTPS a las funciones. Usa una contraseña aleatoria y no la publiques.
- Límite de entrada: 1 GB y 2 horas; no equivale a una garantía de rendimiento. Whisper tiny local puede ser más lento y menos preciso que modelos grandes o la API anterior. Se usa WASM en un worker, sin exigir GPU, y se procesa en ventanas de 30 segundos con solapamiento interno. WebAssembly depende del navegador, memoria y CPU del equipo. Se recomienda comenzar con un archivo corto y usar escritorio para grabaciones largas. No se ha verificado una carga real de 2 horas con ambos motores.
- Mantén la pestaña abierta y el equipo despierto durante la transcripción. Si cierras, cancelas, falla una llamada o se reinicia el navegador, se interrumpe el trabajo. No hay cola durable, reanudación de transcripciones parciales ni reintentos automáticos que vuelvan a generar cargos. Una nueva transcripción vuelve a enviar todos los fragmentos; los cargos de las llamadas previas a Gemini pueden seguir aplicando. Los proyectos solo se pueden guardar al completar ambas transcripciones, aunque aún falten decisiones humanas.
- Whisper local devuelve tiempos por segmento. Gemini estima sus tiempos y puede equivocarse. Se agrupan segmentos temporalmente superpuestos; límites distintos pueden producir grupos largos. La puntuación y mayúsculas se ignoran, pero no se infieren equivalencias semánticas. Cortar el audio puede dividir palabras. Se conserva cada respuesta original en el JSON del proyecto, separada de los segmentos normalizados usados para comparar.
- Tamaño máximo del proyecto JSON: 10 MB. No incluye audio. Reabrirlo reconstruye la comparación y valida las decisiones; una versión futura con otro algoritmo deberá versionar/migrar su formato.

## Arquitectura

- `src/lib/browser-audio.ts`: huella incremental SHA-256 y fragmentación local FFmpeg WASM single-thread (sin CDN).
- `src/lib/browser-transcribe.ts`: Whisper local y solicitudes independientes a Gemini, desplazamiento de tiempos y consolidación de resultados.
- `src/app/api/transcribe/route.ts`: autorización, límites de cuerpo/formato y transcripción sin persistencia.
- `src/lib/local-whisper.ts` y `src/workers/whisper.js`: PCM local, worker, descarga/caché y pipeline Whisper de Transformers.js.
- `src/lib/providers.ts`: endpoint HTTPS oficial de Gemini. No contiene cliente ni llamadas a OpenAI.
- `src/lib/project.ts`: contrato versionado de proyecto y validación para guardar/reabrir.
- `src/lib/exporters`: consolidación y adaptadores de exportación.

No hay un despliegue publicado hasta que Vercel haya construido el código y entregado un dominio. Las pruebas locales y un build exitoso no confirman un despliegue externo.

## Instalación del motor local

Los assets de Transformers.js y ONNX Runtime se copian desde dependencias fijadas en `package-lock.json` a `public/whisper` durante `postinstall`. No se versionan. `scripts/prepare-browser-assets.mjs` prepara tanto FFmpeg como Whisper; no uses `npm ci --ignore-scripts`. `.npmrc` utiliza la opción soportada `onnxruntime-node-install=skip` para evitar descargar binarios **nativos** que no se usan (la app solo usa el runtime web). npm 11 puede mostrar un aviso por esta opción personalizada; el instalador de ONNX sí la reconoce. No se desactivan firmas, TLS ni checksums.

El modelo se descarga directamente al navegador desde `huggingface.co` y sus CDN (`*.huggingface.co` y `*.hf.co`). Si un firewall bloquea esos dominios, Whisper no podrá cargar. No se necesita una clave de Hugging Face para este modelo público. En redes restringidas permite esos destinos. Gemini y la web necesitan conexión aunque los pesos ya estén en caché.

Para comprobar el motor real, abre una grabación breve y conocida en Chrome/Edge de escritorio, observa la descarga inicial y verifica que aparezca texto de Whisper local con tiempos. La prueba automatizada de interfaz simula ese worker y se mantiene separada de la validación real. No hay garantía de velocidad o precisión en audios de dos horas.

El JSON conserva las claves históricas `openai` y las decisiones `choice: "openai"` para poder abrir proyectos de la versión 1. El campo `provider: "whisper-local"` identifica sin ambigüedad las nuevas transcripciones; las antiguas mantienen `provider: "openai"` y su etiqueta en pantalla.

Con el servidor de prueba en el puerto 3100, `npm run test:whisper` descarga los pesos reales y ejecuta un segundo de silencio en un worker (sin ninguna llamada de pago). Requiere Internet hacia Hugging Face y su CDN y puede tardar varios minutos; es una comprobación del runtime, no de precisión lingüística. Usa `PLAYWRIGHT_CHROMIUM_EXECUTABLE` y `BASE_URL` igual que en `test:browser`. Esta prueba online no forma parte de `npm test` ni del CI sin red/modelos.
