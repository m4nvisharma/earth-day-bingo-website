# Earth Day Bingo

Full-stack Earth Day Bingo with real accounts, persistent storage, and per-item photo uploads.

## Architecture
- Frontend: static HTML/CSS/JS hosted on GitHub Pages (repo root).
- Backend: Node/Express on Render (or similar) with Postgres.
- Image storage: Supabase Storage or S3-compatible object storage with a local disk fallback for dev.

## Backend Setup
1. Create a Postgres database (Render or any provider).
2. Copy `backend/.env.example` to `backend/.env` and fill in values.
3. Install dependencies:
   ```bash
   cd backend
   npm install
   ```
4. Run the server:
   ```bash
   npm run dev
   ```

The server seeds the 25 bingo items on startup from [prompts/bingo_cards.txt](prompts/bingo_cards.txt).

## Frontend Setup
1. Update `config.js` with your backend URL.
2. Open `index.html` locally for development.

## GitHub Pages Deployment
1. Push the repo to GitHub.
2. In repository settings, enable GitHub Pages and set the source to `/` (root).
3. Use the GitHub Pages URL as the `CORS_ORIGIN` value in `backend/.env` (comma-separate multiple origins if needed).

## Notes
- The local file upload fallback uses `/uploads` and is best for development only.
- For production, configure Supabase Storage (recommended) or S3-compatible environment variables in `backend/.env`.
- Passwords are hashed with bcrypt and JWT tokens are stored in the browser.
- `MAX_UPLOAD_MB` controls image upload size; set it in `backend/.env` if you need a different limit.
 - `IMAGE_MAX_WIDTH`, `IMAGE_QUALITY`, and `IMAGE_FORMAT` control server-side compression.
