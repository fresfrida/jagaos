import { useCallback, useEffect, useRef, useState } from 'react'

// The Web Speech API is non-standard and not part of TS's DOM lib, so
// there's no built-in type for it — this is the minimal shape this hook
// actually reads/sets, not a full type definition. ArrayLike<T> already
// has the right shape (numeric index + length) for the results list, same
// as lib.es5.d.ts uses it for real arrays.
interface SpeechRecognitionAlternative {
  transcript: string
}
type SpeechRecognitionResult = ArrayLike<SpeechRecognitionAlternative>
interface SpeechRecognitionEventLike {
  results: ArrayLike<SpeechRecognitionResult>
}
interface SpeechRecognitionLike {
  lang: string
  interimResults: boolean
  continuous: boolean
  start: () => void
  stop: () => void
  onresult: ((event: SpeechRecognitionEventLike) => void) | null
  onerror: (() => void) | null
  onend: (() => void) | null
}
type SpeechRecognitionConstructor = new () => SpeechRecognitionLike

function getSpeechRecognitionConstructor(): SpeechRecognitionConstructor | null {
  const w = window as unknown as {
    SpeechRecognition?: SpeechRecognitionConstructor
    webkitSpeechRecognition?: SpeechRecognitionConstructor
  }
  return w.SpeechRecognition ?? w.webkitSpeechRecognition ?? null
}

/** Tap-to-talk captioning via the browser's built-in speech recognition
 * (Chrome/Safari, including mobile) — no backend call, no new dependency
 * (2026-09-23). `supported` is false wherever the API doesn't exist (e.g.
 * Firefox); callers just don't render a mic button in that case and fall
 * back to whatever plain text input they already have — there's no
 * separate "fallback mode" to build here. */
export function useSpeechCaption(onResult: (text: string) => void) {
  const [listening, setListening] = useState(false)
  const recognitionRef = useRef<SpeechRecognitionLike | null>(null)
  const Ctor = getSpeechRecognitionConstructor()

  useEffect(() => {
    return () => recognitionRef.current?.stop()
  }, [])

  const start = useCallback(() => {
    if (!Ctor) return
    const recognition = new Ctor()
    recognition.lang = 'en-US'
    recognition.interimResults = false
    recognition.continuous = false
    recognition.onresult = (event) => {
      const transcript = event.results[0]?.[0]?.transcript
      if (transcript) onResult(transcript)
    }
    recognition.onerror = () => setListening(false)
    recognition.onend = () => setListening(false)
    recognitionRef.current = recognition
    setListening(true)
    recognition.start()
  }, [Ctor, onResult])

  const stop = useCallback(() => {
    recognitionRef.current?.stop()
    setListening(false)
  }, [])

  return { supported: Ctor !== null, listening, start, stop }
}
