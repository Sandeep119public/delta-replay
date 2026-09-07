# Delta Replay web client

Standalone React/Vite client for Delta Replay 2.0.

Start the API first:

```bash
cd ../backend
python -m uvicorn app.main:app --reload
```

Then:

```bash
npm install
npm run dev
```

Set `VITE_API_URL` when the API is hosted elsewhere.