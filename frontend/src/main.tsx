import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'
import { Analytics } from "@vercel/analytics/react"

const Maintenance = () => (
  <div style={{
    display: 'flex',
    flexDirection: 'column',
    alignItems: 'center',
    justifyContent: 'center',
    height: '100vh',
    backgroundColor: '#0f172a',
    color: 'white',
    fontFamily: 'system-ui, -apple-system, sans-serif',
    textAlign: 'center',
    padding: '2rem'
  }}>
    <h1 style={{ fontSize: '3rem', fontWeight: 'bold', marginBottom: '1rem', background: 'linear-gradient(to right, #38bdf8, #818cf8)', WebkitBackgroundClip: 'text', WebkitTextFillColor: 'transparent' }}>
      Under Maintenance
    </h1>
    <p style={{ fontSize: '1.25rem', color: '#94a3b8', maxWidth: '600px', lineHeight: '1.6' }}>
      We are currently upgrading our systems to bring you a better experience. 
      Please check back soon! We appreciate your patience.
    </p>
    <div style={{ marginTop: '2rem', padding: '1rem 2rem', backgroundColor: '#1e293b', borderRadius: '0.5rem', border: '1px solid #334155' }}>
      <p style={{ color: '#cbd5e1', margin: 0, fontWeight: '500' }}>We'll be back shortly!</p>
    </div>
  </div>
);

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <Maintenance />
    <Analytics />
  </StrictMode>,
)

if ('serviceWorker' in navigator && import.meta.env.PROD) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((error) => {
      console.warn('Service worker registration failed:', error);
    });
  });
}
