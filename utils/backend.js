export function getBackendUrl() {
  if (import.meta.env.DEV) {
    return "http://localhost:4000"
  }
  return "https://lol-voice.onrender.com"
}