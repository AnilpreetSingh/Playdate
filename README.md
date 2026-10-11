# duoplay

A two-player shared whiteboard built with React, Vite, Tailwind CSS, Express, and Socket.IO. The bottom tool row offers a speed-sensitive marker, pen, watercolor, pencil, crayon, highlighter, a closed-outline fill tool, and eraser, plus a color picker and size control. The fill tool previews a dashed outline live to both players and fills the enclosed shape when the outline is closed. "Protect my strokes" is enabled by default; turn it off to let your partner paint over or erase your strokes. Brush textures are deterministic so they replay consistently for both players.

## Run locally

Install dependencies from each application folder:

```powershell
cd backend
npm install
Copy-Item .env.example .env
```

In a second terminal:

```powershell
cd frontend
npm install
```

Start the backend and frontend in separate terminals:

```powershell
cd backend
npm run dev
```

```powershell
cd frontend
npm run dev
```

Open `http://localhost:5173`, create a room, then join its four-character code from another tab. The backend retains each room's drawing history and participant settings in memory while the server runs, so refreshing or leaving and rejoining restores the current board. Restarting the backend clears active room history. The backend listens on port `3001` by default; set `PORT` in `backend/.env` to change it. Set `VITE_BACKEND_URL` in the frontend environment to use a different backend URL.
