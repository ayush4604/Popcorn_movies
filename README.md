# Popcorn

Popcorn is a MovieBox-style web app with a React/Vite frontend and a Node backend proxy.

## Local Development

```bash
npm install
npm run dev
```

Frontend: `http://localhost:5173`  
Backend: `http://localhost:3001`

## Deploy Backend To Hugging Face

1. Create a new Hugging Face Space.
2. Choose `Docker` as the Space SDK.
3. Upload/push the contents of the `backend` folder to that Space.
4. Hugging Face will run the backend on port `7860`.

The backend Docker config is in `backend/Dockerfile`, and Space metadata is in `backend/README.md`.

## Deploy Frontend To Vercel

1. Import this repo in Vercel.
2. Use these settings:
   - Build command: `npm run build -w frontend`
   - Output directory: `frontend/dist`
   - Install command: `npm install`
3. Add this Vercel environment variable:

```env
VITE_API_BASE_URL=https://your-huggingface-username-your-space-name.hf.space
```

Then deploy.
