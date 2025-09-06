import React from 'react'
import { createRoot } from 'react-dom/client'
import App from './App'
import Overlay from './Overlay'

const params = new URLSearchParams(window.location.search)
const isOverlay = params.get('overlay') === '1'

createRoot(document.getElementById('root')).render(
  isOverlay ? <Overlay /> : <App />
)
