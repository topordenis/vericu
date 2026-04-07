import { StrictMode, useState, useCallback } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.jsx'
import LoadingScreen from './LoadingScreen.jsx'

function Root() {
  const [loading, setLoading] = useState(true)
  const handleFinish = useCallback(() => setLoading(false), [])

  return (
    <StrictMode>
      {loading ? <LoadingScreen onFinish={handleFinish} /> : <App />}
    </StrictMode>
  )
}

createRoot(document.getElementById('root')).render(<Root />)
