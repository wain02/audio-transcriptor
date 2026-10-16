"use client";
import { useEffect, useRef, useState } from "react";
import {
  AudioLines,
  LayoutDashboard,
  FileText,
  Settings2,
  ShieldCheck,
  ChevronRight,
  CircleHelp,
  ArrowUpRight,
  Upload,
  FileAudio,
  Check,
  Sparkles,
  ArrowRight,
  LockKeyhole,
  GitCompareArrows,
  Headphones,
  Download,
  Play,
  X,
  LoaderCircle,
  Lightbulb,
  CircleCheck,
  RotateCcw,
} from "lucide-react";
import type { Job, Resolution, Difference } from "@/lib/types";
import { timestamp } from "@/lib/compare";
import { consolidate, txtExporter } from "@/lib/exporters";
import {
  parseProject,
  serializeProject,
  MAX_PROJECT_BYTES,
} from "@/lib/project";
import { fingerprint } from "@/lib/browser-audio";
import { transcribeLocal } from "@/lib/browser-transcribe";
import type { WhisperLanguage } from "@/lib/local-whisper";
type LocalAudio = { name: string; size: number; duration: number; url: string };
function download(text: string, name: string) {
  const url = URL.createObjectURL(
    new Blob([text], {
      type: name.endsWith(".json")
        ? "application/json"
        : "text/plain;charset=utf-8",
    }),
  );
  const a = document.createElement("a");
  a.href = url;
  a.download = name;
  a.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
export default function Home() {
  const [file, setFile] = useState<File | null>(null);
  const [audio, setAudio] = useState<LocalAudio | null>(null);
  const [job, setJob] = useState<Job | null>(null);
  const [error, setError] = useState("");
  const [uploading, setUploading] = useState(false);
  const [drag, setDrag] = useState(false);
  const [help, setHelp] = useState(false);
  const [tab, setTab] = useState<"all" | "differences" | "final">(
    "differences",
  );
  const [active, setActive] = useState<string | null>(null);
  const [resolutions, setResolutions] = useState<Record<string, Resolution>>(
    {},
  );
  const [password, setPassword] = useState("");
  const [language, setLanguage] = useState<WhisperLanguage>("spanish");
  const [unsaved, setUnsaved] = useState(false);
  const [stage, setStage] = useState("");
  const projectInput = useRef<HTMLInputElement>(null);
  const controller = useRef<AbortController | null>(null);
  const input = useRef<HTMLInputElement>(null);
  const player = useRef<HTMLAudioElement>(null);
  const stopAt = useRef<number | null>(null);
  const selection = useRef(0);
  useEffect(() => () => controller.current?.abort(), []);
  useEffect(() => {
    const warn = (event: BeforeUnloadEvent) => {
      if (unsaved || uploading) {
        event.preventDefault();
        event.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, [unsaved, uploading]);
  useEffect(
    () => () => {
      if (audio) URL.revokeObjectURL(audio.url);
    },
    [audio],
  );
  const processing = uploading || job?.status === "processing";
  const complete = job?.status === "complete";
  const whisperLabel =
    job?.openai?.provider === "openai"
      ? "OpenAI (proyecto anterior)"
      : "Whisper local";
  const differences = job?.differences || [];
  const pending = differences.filter(
    (d) => d.different && !resolutions[d.id],
  ).length;
  const audioUrl = audio?.url || "";
  async function selectFile(f?: File) {
    if (!f || processing) return;
    const ticket = ++selection.current;
    setError("");
    if (!/\.(m4a|mp3|wav)$/i.test(f.name)) {
      setError("Elige un archivo M4A, MP3 o WAV.");
      return;
    }
    if (f.size > 1024 ** 3) {
      setError("El archivo supera el límite de 1 GB.");
      return;
    }
    const url = URL.createObjectURL(f);
    try {
      const duration = await new Promise<number>((resolve, reject) => {
        const media = document.createElement("audio");
        const timer = setTimeout(() => {
          media.removeAttribute("src");
          reject(new Error("No se pudo leer la duración del audio."));
        }, 15000);
        media.preload = "metadata";
        media.onloadedmetadata = () => {
          clearTimeout(timer);
          resolve(media.duration);
          media.removeAttribute("src");
        };
        media.onerror = () => {
          clearTimeout(timer);
          reject(
            new Error("El navegador no pudo leer el audio. Prueba MP3 o WAV."),
          );
        };
        media.src = url;
      });
      if (!Number.isFinite(duration) || duration <= 0 || duration > 7200)
        throw new Error("El audio debe durar como máximo 2 horas.");
      if (job?.status === "complete") {
        if (f.size !== job.size || Math.abs(duration - job.duration) > 0.2)
          throw new Error(
            "Este archivo no coincide con el audio del proyecto. Selecciona el original.",
          );
        setStage("Comprobando que sea el mismo audio…");
        setUploading(true);
        if ((await fingerprint(f)) !== job.audioSha256)
          throw new Error(
            "El contenido del audio no coincide con el proyecto.",
          );
      }
      if (ticket !== selection.current) {
        URL.revokeObjectURL(url);
        return;
      }
      setFile(f);
      setAudio({ name: f.name, size: f.size, duration, url });
      setActive(null);
      if (job?.status !== "complete") {
        setJob(null);
        setResolutions({});
      }
    } catch (e) {
      URL.revokeObjectURL(url);
      if (ticket === selection.current)
        setError(e instanceof Error ? e.message : "No se pudo abrir el audio.");
    } finally {
      setUploading(false);
      setStage("");
    }
  }
  async function transcribe() {
    if (!file || !audio) return;
    if (!password) {
      setError("Introduce tu contraseña de acceso antes de transcribir.");
      return;
    }
    setUploading(true);
    setError("");
    setStage("Verificando acceso…");
    setResolutions({});
    const abort = new AbortController();
    controller.current = abort;
    try {
      await transcribeLocal(
        file,
        audio.duration,
        password,
        abort.signal,
        (j) => {
          setJob(j);
          setStage(j.stage);
        },
        language,
      );
      setUnsaved(true);
    } catch (e) {
      const message = abort.signal.aborted
        ? "Transcripción cancelada. Los fragmentos no se guardan en el servidor."
        : e instanceof Error
          ? e.message
          : "Error de conexión.";
      setError(message);
      setJob((j) => (j ? { ...j, status: "failed", error: message } : null));
    } finally {
      controller.current = null;
      setUploading(false);
      setStage("");
    }
  }
  function newProject() {
    if (processing) return;
    if (
      unsaved &&
      !window.confirm(
        "Tienes cambios sin guardar. ¿Quieres iniciar una nueva transcripción?",
      )
    )
      return;
    selection.current++;
    setJob(null);
    setFile(null);
    setAudio(null);
    setResolutions({});
    setUnsaved(false);
    setError("");
    setActive(null);
    setTab("differences");
  }
  async function openProject(f?: File) {
    if (!f || processing) return;
    setError("");
    try {
      if (f.size > MAX_PROJECT_BYTES)
        throw new Error("El proyecto supera los 10 MB.");
      const project = parseProject(await f.text());
      if (
        unsaved &&
        !window.confirm(
          "Tienes cambios sin guardar. ¿Quieres abrir otro proyecto?",
        )
      )
        return;
      selection.current++;
      setJob(project.job);
      setResolutions(project.resolutions);
      setAudio(null);
      setFile(null);
      setUnsaved(false);
      setActive(null);
      setTab("differences");
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "No se pudo abrir el proyecto.",
      );
    }
  }
  function saveProject() {
    if (!job) return;
    try {
      download(
        serializeProject(job, resolutions),
        `${job.name.replace(/\.[^.]+$/, "")}.audio-transcriptor.json`,
      );
      setUnsaved(false);
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo guardar.");
    }
  }
  async function exportFinal() {
    if (!job) return;
    try {
      const document = consolidate(job.name, differences, resolutions);
      const blob = await txtExporter.render(document);
      download(
        await blob.text(),
        `${job.name.replace(/\.[^.]+$/, "")}-transcripcion.${txtExporter.extension}`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : "No se pudo exportar.");
    }
  }
  function listen(d: Difference) {
    if (!audio) {
      setError(
        "Selecciona el audio original de tu disco para escuchar este segmento.",
      );
      return;
    }
    setActive(d.id);
    stopAt.current = d.end + 1;
    const element = player.current;
    if (element) {
      element.currentTime = Math.max(0, d.start - 3);
      void element
        .play()
        .catch(() => setError("Pulsa reproducir para escuchar el fragmento."));
    }
  }
  function resolve(d: Difference, choice: Resolution["choice"]) {
    setUnsaved(true);
    setResolutions((previous) => ({
      ...previous,
      [d.id]: {
        choice,
        text:
          choice === "openai"
            ? d.openai
            : choice === "gemini"
              ? d.gemini
              : previous[d.id]?.text || d.openai,
      },
    }));
  }
  const final =
    job?.differences
      ?.map((d) => (d.different ? (resolutions[d.id]?.text ?? "") : d.openai))
      .filter(Boolean)
      .join("\n\n") || "";
  const current = audio || job;
  const rows =
    tab === "all" ? differences : differences.filter((d) => d.different);
  return (
    <div>
      <aside className="sidebar">
        <div className="brand">
          <span className="brand-icon">
            <AudioLines size={21} />
          </span>
          <span className="brand-text">
            audio<span style={{ color: "#8b71d9" }}>transcriptor</span>
            <small>ESCUCHA CADA PALABRA</small>
          </span>
        </div>
        <div className="nav-label">ESPACIO DE TRABAJO</div>
        <button
          className="nav-item active"
          onClick={() => {
            setTab("differences");
            window.scrollTo({ top: 0, behavior: "smooth" });
          }}
        >
          <LayoutDashboard size={17} />
          <span className="nav-text">Transcriptor</span>
          <span className="badge">IA</span>
        </button>
        <button
          className="nav-item"
          onClick={() => {
            setHelp(true);
          }}
        >
          <FileText size={17} />
          <span className="nav-text">Guía de revisión</span>
        </button>
        <button className="nav-item" onClick={() => setHelp((h) => !h)}>
          <Settings2 size={17} />
          <span className="nav-text">Conexiones IA</span>
        </button>
        <div className="sidebar-bottom">
          <div className="secure-card">
            <ShieldCheck size={18} style={{ color: "#a292c7" }} />
            <strong>Tu audio, bajo tu control</strong>Las claves permanecen en
            el servidor. Revisa la política de Google antes de subir datos
            sensibles.
          </div>
          <div className="profile">
            <div className="avatar">AT</div>
            <div>
              Mi espacio<small>Almacenamiento local</small>
            </div>
          </div>
        </div>
      </aside>
      <main className="main">
        <header className="topbar">
          <div>
            Mi espacio{" "}
            <ChevronRight
              size={11}
              style={{ display: "inline", margin: "0 10px" }}
            />
            <strong>Transcriptor</strong>
          </div>
          <div className="top-actions">
            <span className="pill">
              <span className="dot" />
              Dos perspectivas, más claridad
            </span>
            <button
              aria-label="Ayuda"
              onClick={() => setHelp((h) => !h)}
              style={{
                background: "none",
                border: 0,
                color: "#939baa",
                display: "flex",
              }}
            >
              <CircleHelp size={18} />
            </button>
          </div>
        </header>
        <div className="content">
          <div className="eyebrow">
            <Sparkles size={12} /> TRANSCRIPCIÓN CON DOBLE IA
          </div>
          <div className="heading">
            <div>
              <h1>Cada palabra cuenta.</h1>
              <p className="subtitle">
                Dos inteligencias artificiales. Una transcripción en la que
                puedes confiar.
              </p>
            </div>
            <button className="outline-btn" onClick={() => setHelp((h) => !h)}>
              Cómo funciona <ArrowUpRight size={13} />
            </button>
          </div>
          {help && (
            <div className="card help">
              <strong>Tu espacio de revisión</strong>
              <button
                aria-label="Cerrar ayuda"
                onClick={() => setHelp(false)}
                style={{ float: "right", border: 0, background: "none" }}
              >
                <X size={16} />
              </button>
              <p>
                Sube un audio y ambas IA lo transcribirán de forma
                independiente. Escucha cada diferencia, elige una versión o
                escribe tu corrección. Ningún modelo tiene prioridad. El TXT
                final se habilita cuando todas las discrepancias están
                resueltas.
              </p>
              <p>
                El audio permanece en tu equipo. Se envían fragmentos temporales
                a Gemini a través del servidor, sin guardarlos allí. Whisper se
                ejecuta en tu computadora sin llamar a la API de OpenAI. Guarda
                el proyecto JSON en tu disco para conservar ambas
                transcripciones y las correcciones. Al reabrirlo, selecciona el
                audio original para escuchar. No hay guardado automático:
                descarga el proyecto antes de cerrar esta página.
              </p>
              <p>
                Whisper tiny se ejecuta localmente con tiempos de segmento y
                puede ser menos preciso que modelos grandes. Los tiempos de
                Gemini son estimaciones del modelo: los bloques pueden agruparse
                cuando sus límites no coinciden. Comprueba siempre el audio.
              </p>
            </div>
          )}
          <div className="project-bar card">
            <div className="project-actions">
              <button
                className="outline-btn"
                disabled={processing}
                onClick={newProject}
              >
                Nueva transcripción
              </button>
              <button
                className="outline-btn"
                disabled={processing}
                onClick={() => projectInput.current?.click()}
              >
                <Upload size={13} />
                Abrir proyecto JSON
              </button>
              <button
                className="outline-btn"
                disabled={!complete || processing}
                onClick={saveProject}
              >
                <Download size={13} />
                Guardar proyecto JSON
              </button>
              <span className="project-status">
                {unsaved
                  ? "Cambios sin guardar en disco"
                  : "Sin base de datos · Archivos en tu disco"}
              </span>
            </div>
            <input
              ref={projectInput}
              type="file"
              accept=".json,application/json"
              className="hidden-input"
              onChange={(e) => {
                void openProject(e.target.files?.[0]);
                e.target.value = "";
              }}
            />
            <label className="access-label">
              Contraseña de acceso{" "}
              <input
                type="password"
                value={password}
                autoComplete="off"
                disabled={processing}
                onChange={(e) => setPassword(e.target.value)}
                placeholder="La que configuraste al desplegar"
              />
            </label>
            <div className="notice">
              Solo se necesita para transcribir. Abrir, revisar y exportar un
              proyecto funciona sin contraseña.
            </div>
          </div>
          <div className="card local-model-note">
            <strong>Whisper local · Sin clave ni cargos de OpenAI</strong>
            <p>
              La primera vez se descarga el modelo desde Hugging Face (decenas
              de MB). Se procesa en tu computadora y puede tardar más que una
              API. El navegador puede conservar el modelo en caché; Gemini sigue
              usando su propia cuota.
            </p>
            <label className="access-label">
              Idioma del audio{" "}
              <select
                value={language}
                disabled={processing}
                onChange={(e) => setLanguage(e.target.value as WhisperLanguage)}
              >
                <option value="spanish">Español</option>
                <option value="english">Inglés</option>
              </select>
            </label>
          </div>
          <div className="steps">
            {[
              "Sube tu audio",
              "Transcripción con IA",
              "Compara y revisa",
              "Exporta",
            ].map((label, i) => (
              <div key={label} style={{ display: "contents" }}>
                {i > 0 && <div className="step-line" />}
                <div
                  className={`step ${(i === 0 && !job) || (i === 1 && processing) || (i === 2 && complete && pending > 0) || (i === 3 && complete && pending === 0) ? "on" : ""}`}
                >
                  <span className="step-circle">{i + 1}</span>
                  {label}
                </div>
              </div>
            ))}
          </div>
          <div className="workspace">
            <section className="card upload-card">
              <div className="section-title">
                <span className="section-number">01</span> Empecemos por tu
                audio
              </div>
              <p className="section-sub">
                Selecciona tu grabación. El original permanece en tu disco.
              </p>
              {!current ? (
                <div
                  className={`dropzone ${drag ? "drag" : ""}`}
                  onDragOver={(e) => {
                    e.preventDefault();
                    setDrag(true);
                  }}
                  onDragLeave={() => setDrag(false)}
                  onDrop={(e) => {
                    e.preventDefault();
                    setDrag(false);
                    void selectFile(e.dataTransfer.files[0]);
                  }}
                >
                  <div>
                    <div className="upload-icon">
                      <Upload size={25} strokeWidth={1.5} />
                    </div>
                    <h3>Arrastra tu archivo de audio aquí</h3>
                    <p>o selecciónalo desde tu equipo</p>
                    <button
                      className="primary"
                      onClick={() => input.current?.click()}
                    >
                      <Upload size={13} />
                      Seleccionar archivo
                    </button>
                  </div>
                </div>
              ) : (
                <div>
                  <div className="audio-details">
                    <FileAudio size={25} color="#9c84d2" />
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <strong>{current.name}</strong>
                      <small>
                        {timestamp(current.duration)} de duración ·{" "}
                        {(current.size / 1024 ** 2).toFixed(1)} MB
                      </small>
                    </div>
                    <button
                      className="outline-btn"
                      disabled={processing}
                      onClick={() => input.current?.click()}
                    >
                      <RotateCcw size={13} />
                      {complete ? "Vincular audio" : "Cambiar"}
                    </button>
                  </div>
                  {audioUrl ? (
                    <audio
                      ref={player}
                      className="audio-player"
                      controls
                      src={audioUrl}
                      onTimeUpdate={() => {
                        if (
                          player.current &&
                          stopAt.current !== null &&
                          player.current.currentTime >= stopAt.current
                        ) {
                          player.current.pause();
                          stopAt.current = null;
                        }
                      }}
                    />
                  ) : (
                    <div className="notice">
                      Proyecto abierto. Selecciona el audio original para
                      escuchar los segmentos; puedes revisar y exportar texto
                      sin él.
                    </div>
                  )}
                  {processing && (
                    <>
                      <div className="notice">
                        <LoaderCircle size={14} className="spin" />
                        {stage || job?.stage}
                      </div>
                      <div className="progress">
                        <div
                          style={{
                            width: `${job?.progress || 3}%`,
                          }}
                        />
                      </div>
                      <div className="notice">
                        Las grabaciones largas pueden tardar varios minutos.
                        Mantén esta pestaña abierta. Puedes cancelar sin guardar
                        audio en el servidor.
                      </div>
                      <button
                        className="outline-btn"
                        onClick={() => controller.current?.abort()}
                        disabled={!controller.current}
                      >
                        Cancelar transcripción
                      </button>
                    </>
                  )}
                </div>
              )}
              <input
                ref={input}
                className="hidden-input"
                type="file"
                accept=".m4a,.mp3,.wav,audio/mp4,audio/mpeg,audio/wav"
                onChange={(e) => {
                  void selectFile(e.target.files?.[0]);
                  e.target.value = "";
                }}
              />
              <div className="formats">
                <div className="format-tags">
                  <span>M4A</span>
                  <span>MP3</span>
                  <span>WAV</span>
                </div>
                <span>Hasta 2 horas de audio · Máx. 1 GB</span>
              </div>
              <div className="section-title" style={{ fontSize: 11 }}>
                <GitCompareArrows size={15} /> Dos modelos, trabajando de forma
                independiente
              </div>
              <div className="models">
                <div className="model">
                  <div className="model-icon">
                    <AudioLines size={20} />
                  </div>
                  <div>
                    <strong>{whisperLabel}</strong>
                    <small>
                      {job?.openai?.provider === "openai"
                        ? "Transcripción importada · API anterior"
                        : "En tu equipo · Sin cargos de OpenAI"}
                    </small>
                  </div>
                  <Check className="check" size={14} />
                </div>
                <div className="model">
                  <div className="model-icon blue">
                    <Sparkles size={19} />
                  </div>
                  <div>
                    <strong>Google Gemini</strong>
                    <small>Una segunda perspectiva</small>
                  </div>
                  <Check className="check" size={14} />
                </div>
              </div>
              <div className="notice">
                <ShieldCheck size={13} style={{ flexShrink: 0 }} />
                Conservamos ambas versiones originales. Tú decides qué se queda
                en la versión final.
              </div>
              {(error || job?.error) && (
                <div className="error" role="alert">
                  {error || job?.error}
                </div>
              )}
              <div className="upload-footer">
                <span>
                  <LockKeyhole
                    size={11}
                    style={{ display: "inline", marginRight: 5 }}
                  />
                  Credenciales protegidas en el servidor
                </span>
                <button
                  className="primary"
                  disabled={!file || processing || complete}
                  onClick={() => void transcribe()}
                >
                  {processing ? (
                    <LoaderCircle size={13} className="spin" />
                  ) : null}
                  {complete ? "Transcripción completada" : "Transcribir audio"}
                  <ArrowRight size={13} />
                </button>
              </div>
            </section>
            <aside className="aside">
              <div className="card how-card">
                <h2>De audio a claridad</h2>
                <div className="how-step">
                  <div className="how-icon">
                    <AudioLines size={16} />
                  </div>
                  <div>
                    <strong>Dos escuchas independientes</strong>
                    <p>
                      Whisper local y Gemini transcriben tu audio sin conocer la
                      versión del otro.
                    </p>
                  </div>
                </div>
                <div className="how-step">
                  <div className="how-icon">
                    <GitCompareArrows size={16} />
                  </div>
                  <div>
                    <strong>Las diferencias, a la vista</strong>
                    <p>
                      Comparamos palabras, nombres y cifras. Ignoramos
                      puntuación y formato.
                    </p>
                  </div>
                </div>
                <div className="how-step">
                  <div className="how-icon">
                    <Headphones size={16} />
                  </div>
                  <div>
                    <strong>La última palabra es tuya</strong>
                    <p>
                      Escucha el fragmento, revisa ambas versiones y elige lo
                      que se dijo.
                    </p>
                  </div>
                </div>
                <div className="how-bottom">
                  <Sparkles size={13} />
                  Más contexto. Menos suposiciones.
                </div>
              </div>
              <div className="tip">
                <strong>
                  <Lightbulb size={14} /> Un consejo antes de empezar
                </strong>
                <p>
                  Un audio claro hace la diferencia. Si puedes, evita el ruido
                  de fondo y las voces superpuestas.
                </p>
              </div>
            </aside>
          </div>
          {complete && (
            <section className="review">
              <div className="review-top">
                <div>
                  <div className="section-title">
                    Compara y revisa{" "}
                    <span className="section-number">{pending} pendientes</span>
                  </div>
                  <p className="section-sub" style={{ marginBottom: 0 }}>
                    Escucha desde 3 segundos antes de cada diferencia. Ninguna
                    IA tiene prioridad.
                  </p>
                </div>
                <button
                  className="primary"
                  disabled={pending > 0}
                  onClick={() => void exportFinal()}
                >
                  <Download size={14} />
                  Exportar TXT
                </button>
              </div>
              <div className="review-top">
                <div className="tabs">
                  <button
                    className={tab === "differences" ? "selected" : ""}
                    onClick={() => setTab("differences")}
                  >
                    Diferencias ({differences.filter((d) => d.different).length}
                    )
                  </button>
                  <button
                    className={tab === "all" ? "selected" : ""}
                    onClick={() => setTab("all")}
                  >
                    Todos los segmentos
                  </button>
                  <button
                    className={tab === "final" ? "selected" : ""}
                    onClick={() => setTab("final")}
                  >
                    Versión final
                  </button>
                </div>
                <button
                  className="outline-btn"
                  onClick={() =>
                    download(
                      JSON.stringify(
                        {
                          responses: job.originals || [],
                          openai: job.openai,
                          gemini: job.gemini,
                        },
                        null,
                        2,
                      ),
                      "transcripciones-originales.json",
                    )
                  }
                >
                  Descargar originales
                </button>
              </div>
              {tab === "final" ? (
                <div className="card">
                  <div className="notice" style={{ padding: "0 24px" }}>
                    {pending > 0
                      ? `Faltan ${pending} decisiones. Esta vista incluye únicamente los segmentos coincidentes y los ya revisados.`
                      : "Todas las diferencias están resueltas. Tu transcripción está lista para descargar."}
                  </div>
                  <div className="final-text">
                    {final ||
                      "Resuelve las diferencias para construir tu versión final."}
                  </div>
                </div>
              ) : rows.length === 0 ? (
                <div className="card empty-state">
                  <CircleCheck
                    size={24}
                    style={{ margin: "0 auto 12px", color: "#8ba48e" }}
                  />
                  No se detectaron diferencias de contenido entre ambas
                  versiones.
                </div>
              ) : (
                rows.map((d) => (
                  <article
                    key={d.id}
                    className={`diff ${active === d.id ? "focus" : ""}`}
                  >
                    <div className="diff-head">
                      <button
                        className="time-btn"
                        disabled={!audio}
                        title={
                          audio
                            ? "Escuchar segmento"
                            : "Vincula el audio original para escuchar"
                        }
                        onClick={() => listen(d)}
                      >
                        <Play size={11} />
                        {timestamp(d.start)} – {timestamp(d.end)}
                      </button>
                      <span>
                        {!d.different
                          ? "Coinciden"
                          : resolutions[d.id]
                            ? "✓ Revisado"
                            : "Por revisar"}
                      </span>
                    </div>
                    <div className="transcripts">
                      <div
                        className={`transcript ${resolutions[d.id]?.choice === "openai" ? "chosen" : ""}`}
                      >
                        <strong>{whisperLabel.toUpperCase()}</strong>
                        {d.openai || <em>Sin contenido en este intervalo</em>}
                      </div>
                      <div
                        className={`transcript ${resolutions[d.id]?.choice === "gemini" ? "chosen" : ""}`}
                      >
                        <strong>GOOGLE GEMINI</strong>
                        {d.gemini || <em>Sin contenido en este intervalo</em>}
                      </div>
                    </div>
                    {d.different && (
                      <>
                        <div className="choices">
                          <button
                            className={
                              resolutions[d.id]?.choice === "openai"
                                ? "selected"
                                : ""
                            }
                            onClick={() => resolve(d, "openai")}
                          >
                            Aceptar {whisperLabel}
                          </button>
                          <button
                            className={
                              resolutions[d.id]?.choice === "gemini"
                                ? "selected"
                                : ""
                            }
                            onClick={() => resolve(d, "gemini")}
                          >
                            Aceptar Gemini
                          </button>
                          <button
                            className={
                              resolutions[d.id]?.choice === "manual"
                                ? "selected"
                                : ""
                            }
                            onClick={() => resolve(d, "manual")}
                          >
                            Corrección manual
                          </button>
                          {resolutions[d.id] && (
                            <button
                              onClick={() => {
                                setUnsaved(true);
                                setResolutions((p) => {
                                  const n = { ...p };
                                  delete n[d.id];
                                  return n;
                                });
                              }}
                            >
                              Deshacer
                            </button>
                          )}
                        </div>
                        {resolutions[d.id]?.choice === "manual" && (
                          <textarea
                            aria-label={`Corrección del segmento ${timestamp(d.start)}`}
                            className="manual"
                            value={resolutions[d.id].text}
                            onChange={(e) => {
                              setUnsaved(true);
                              setResolutions((p) => ({
                                ...p,
                                [d.id]: {
                                  choice: "manual",
                                  text: e.target.value,
                                },
                              }));
                            }}
                          />
                        )}
                      </>
                    )}
                  </article>
                ))
              )}
            </section>
          )}
          <div className="features">
            <div className="feature">
              <ShieldCheck size={17} />
              <div>
                <strong>Sin perder el original</strong>
                <p>
                  Ambas transcripciones se conservan
                  <br />
                  tal como las genera cada modelo.
                </p>
              </div>
            </div>
            <div className="feature">
              <Headphones size={17} />
              <div>
                <strong>Escucha en contexto</strong>
                <p>
                  Vuelve al momento exacto
                  <br />
                  de cada discrepancia.
                </p>
              </div>
            </div>
            <div className="feature">
              <FileText size={17} />
              <div>
                <strong>Lista para compartir</strong>
                <p>
                  Exporta tu versión revisada
                  <br />
                  en un archivo de texto.
                </p>
              </div>
            </div>
          </div>
          <footer className="bottom">
            <span>Audio Transcriptor · Menos dudas, mejores reuniones.</span>
            <span>
              <AudioLines size={11} />
              Hecho para escuchar mejor
            </span>
          </footer>
        </div>
      </main>
    </div>
  );
}
