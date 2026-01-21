import { useState } from 'react'
import './App.scss'

interface ProgressData {
  step: string
  progress: number
  message: string
  text?: string
  error?: string
}

interface StageStatus {
  download: boolean
  process: boolean
  transcribe: boolean
}

function App() {
  const [url, setUrl] = useState('')
  const [isLoading, setIsLoading] = useState(false)
  const [currentStage, setCurrentStage] = useState('')
  const [stagesCompleted, setStagesCompleted] = useState<StageStatus>({
    download: false,
    process: false,
    transcribe: false
  })
  const [transcribeProgress, setTranscribeProgress] = useState('')
  const [transcription, setTranscription] = useState('')

  const handleTranscribe = async () => {
    if (!url.trim()) {
      alert('Por favor ingresa una URL')
      return
    }

    setIsLoading(true)
    setCurrentStage('Conectando...')
    setStagesCompleted({ download: false, process: false, transcribe: false })
    setTranscribeProgress('')
    setTranscription('')

    try {
      const eventSource = new EventSource(
        `http://localhost:3001/api/transcribe-stream?url=${encodeURIComponent(url)}`
      )

      eventSource.onmessage = (event) => {
        const data: ProgressData = JSON.parse(event.data)

        if (data.step === 'error') {
          setCurrentStage(`Error: ${data.error}`)
          eventSource.close()
          setIsLoading(false)
          return
        }

        if (data.step === 'complete') {
          setStagesCompleted({ download: true, process: true, transcribe: true })
          setCurrentStage('Completado')
          setTranscription(data.text || '')
          eventSource.close()
          setIsLoading(false)
          return
        }

        // Actualizar etapa actual
        setCurrentStage(data.message)

        // Marcar etapas completadas
        if (data.step === 'download' && data.progress === 30) {
          setStagesCompleted(prev => ({ ...prev, download: true }))
        } else if (data.step === 'process' && data.progress === 40) {
          setStagesCompleted(prev => ({ ...prev, process: true }))
        } else if (data.step === 'transcribe') {
          // Extraer info de chunks del mensaje
          setTranscribeProgress(data.message)
        } else if (data.step === 'save') {
          setStagesCompleted(prev => ({ ...prev, transcribe: true }))
        }

        console.log(`📊 Progreso: ${data.progress}% - ${data.message}`)
      }

      eventSource.onerror = () => {
        setProgressMessage('Error de conexión')
        eventSource.close()
        setIsLoading(false)
      }
    } catch (error) {
      console.error('Error:', error)
      alert('Error al procesar la solicitud')
      setIsLoading(false)
    }
  }

  const handleCopy = () => {
    navigator.clipboard.writeText(transcription)
    alert('Texto copiado al portapapeles')
  }

  return (
    <div className="app">
      <div className="container">
        <header className="header">
          <h1 className="title">YouTube Transcriber</h1>
          <p className="subtitle">Transcribe videos de YouTube usando Whisper AI</p>
        </header>

        <div className="card">
          <div className="form-group">
            <label htmlFor="url" className="label">
              URL del video de YouTube
            </label>
            <input
              type="text"
              id="url"
              value={url}
              onChange={(e) => setUrl(e.target.value)}
              placeholder="https://youtu.be/..."
              className="input"
              disabled={isLoading}
            />
          </div>

          <button
            onClick={handleTranscribe}
            disabled={isLoading}
            className="button"
          >
            {isLoading ? 'Transcribiendo...' : 'Transcribir'}
          </button>

          {isLoading && (
            <div className="stages-container">
              <div className="stage-item">
                <span className={`stage-icon ${stagesCompleted.download ? 'completed' : 'pending'}`}>
                  {stagesCompleted.download ? '✓' : '○'}
                </span>
                <span className="stage-label">Descarga del video</span>
              </div>

              <div className="stage-item">
                <span className={`stage-icon ${stagesCompleted.process ? 'completed' : 'pending'}`}>
                  {stagesCompleted.process ? '✓' : '○'}
                </span>
                <span className="stage-label">Procesamiento de audio</span>
              </div>

              <div className="stage-item">
                <span className={`stage-icon ${stagesCompleted.transcribe ? 'completed' : 'pending'}`}>
                  {stagesCompleted.transcribe ? '✓' : '○'}
                </span>
                <span className="stage-label">Transcripción</span>
                {transcribeProgress && !stagesCompleted.transcribe && (
                  <span className="stage-detail">{transcribeProgress}</span>
                )}
              </div>

              <div className="current-stage">
                <span className="stage-current-label">{currentStage}</span>
              </div>
            </div>
          )}
        </div>

        {transcription && (
          <div className="result-card">
            <div className="result-header">
              <h2 className="result-title">Transcripción</h2>
              <button onClick={handleCopy} className="copy-button">
                Copiar
              </button>
            </div>
            <div className="result-text">{transcription}</div>
          </div>
        )}
      </div>
    </div>
  )
}

export default App
