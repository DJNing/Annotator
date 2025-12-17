# SegmentAI - Intelligent Image Annotation

A professional image segmentation tool featuring Foreground/Background separation, instance labeling, and AI-assisted object detection using Gemini.

## 🚀 Deployment Guide

Follow these steps to deploy this application on a remote server (e.g., AWS EC2, DigitalOcean Droplet, or a standard Linux VPS) and access it securely from your local machine.

### 1. Remote Server Setup

**Prerequisites:**
- Access to a remote server via SSH.
- **Node.js** (v18+) and **npm** installed on the server.

#### Step A: Upload Files
Transfer the project files to your remote server. You can use `scp`, `rsync`, or `git`.
```bash
# Example using scp from your local machine
scp -r /path/to/segment-ai user@remote-server-ip:~/segment-ai
```

#### Step B: Install Dependencies
SSH into your remote server and navigate to the project directory. Since this project uses React with TypeScript, we recommend using **Vite** for serving.

1. Initialize a `package.json` if one doesn't exist:
   ```bash
   npm init -y
   ```

2. Install the required dependencies:
   ```bash
   npm install vite @vitejs/plugin-react react react-dom lucide-react @google/genai
   ```

3. (Optional) Create a `vite.config.js` for better React support:
   ```javascript
   // vite.config.js
   import { defineConfig } from 'vite'
   import react from '@vitejs/plugin-react'

   export default defineConfig({
     plugins: [react()],
   })
   ```

4. Update `index.html` entry point:
   Ensure your `index.html` points to the TypeScript file. Add this inside the `<body>` tag if not present (Vite handles the rest):
   ```html
   <script type="module" src="/index.tsx"></script>
   ```

#### Step C: Start the Server
Run the development server. We use `--host` to ensure it listens on the server's network interface, which is required for port forwarding to work correctly.

```bash
npx vite --host
```
*Note the port number displayed (usually `5173`).*

---

### 2. Access via Port Forwarding (SSH Tunnel)

Instead of opening ports on your server's firewall (which can be risky), use SSH Local Port Forwarding. This maps a port on your local computer directly to the port on the remote server.

**Run this command on your LOCAL machine:**

```bash
ssh -L 5173:localhost:5173 user@remote-server-ip
```

**Breakdown:**
- `-L`: Specifies local port forwarding.
- `5173`: The port on your **local** machine.
- `localhost:5173`: The target on the **remote** machine (since Vite is running there).
- `user@remote-server-ip`: Your standard SSH login details.

### 3. Open the App

1. Keep the SSH terminal window open (closing it breaks the tunnel).
2. Open your web browser on your **local computer**.
3. Navigate to:
   ```
   http://localhost:5173
   ```

You will now see the SegmentAI app running securely from your remote server!

---

### 4. API Key Configuration

To use the AI Object Detection features (Gemini), you need to set the API key.

**Option 1: Environment Variable (Recommended)**
Start the server with the key:
```bash
API_KEY=your_google_api_key_here npx vite --host
```

**Option 2: `.env` File**
Create a `.env` file in the project root:
```env
VITE_API_KEY=your_google_api_key_here
```
*(Note: You may need to update `geminiService.ts` to read `import.meta.env.VITE_API_KEY` if using Vite's env standard).*
